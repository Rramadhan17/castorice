const { parseExternalHttpUrl } = require("./url-security");
const { createSecureFetch } = require("./secure-http");

const RADIO_BROWSER_BASE_URL = "https://de1.api.radio-browser.info";
const MAX_RESULTS = 8;
const MAX_QUERY_LENGTH = 100;
const REQUEST_TIMEOUT_MS = 8000;

function normalizeStreamUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;

    try {
        const url = parseExternalHttpUrl(value.trim());
        return url.toString();
    } catch {
        return null;
    }
}

function cleanText(value, maxLength) {
    return String(value || "")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
}

function mapStations(payload) {
    if (!Array.isArray(payload)) {
        throw new Error("Radio Browser returned an invalid station list.");
    }

    const seen = new Set();
    const stations = [];
    for (const item of payload) {
        const streamUrl = normalizeStreamUrl(item?.url_resolved || item?.url);
        const title = cleanText(item?.name, 100);
        if (!streamUrl || !title || seen.has(streamUrl)) continue;
        seen.add(streamUrl);

        stations.push({
            id: cleanText(item?.stationuuid, 80),
            title,
            streamUrl,
            country: cleanText(item.country, 60),
            language: cleanText(item.language, 60),
            codec: cleanText(item.codec, 20).toUpperCase(),
            bitrate: Number.isFinite(item.bitrate) && item.bitrate > 0
                ? Math.min(Math.floor(item.bitrate), 10000)
                : null
        });
        if (stations.length >= MAX_RESULTS) break;
    }
    return stations;
}

function createRadioDiscovery({
    fetchImpl = createSecureFetch(),
    baseUrl = RADIO_BROWSER_BASE_URL,
    timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
    if (typeof fetchImpl !== "function") {
        throw new TypeError("Radio Discovery requires a fetch implementation.");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
        throw new RangeError("Radio Discovery timeout must be between 1 and 60000 ms.");
    }

    const root = parseExternalHttpUrl(baseUrl);
    if (root.protocol !== "https:") {
        throw new TypeError("Radio Browser API must use a trusted HTTPS endpoint.");
    }

    return {
        async search(query, { signal } = {}) {
            const term = cleanText(query, MAX_QUERY_LENGTH);
            if (!term) throw new Error("Masukkan nama stasiun atau genre radio.");
            const tagMatch = term.match(/^tag:\s*(.*)$/i);
            const searchTerm = tagMatch ? cleanText(tagMatch[1], MAX_QUERY_LENGTH) : term;
            if (!searchTerm) throw new Error("Masukkan nama tag radio.");

            const requestUrl = new URL("/json/stations/search", root);
            requestUrl.search = new URLSearchParams({
                [tagMatch ? "tag" : "name"]: searchTerm,
                limit: String(MAX_RESULTS),
                hidebroken: "true",
                order: "clickcount",
                reverse: "true"
            }).toString();

            const controller = new AbortController();
            const abortListener = () => controller.abort(signal.reason);
            signal?.addEventListener("abort", abortListener, { once: true });
            const timeout = setTimeout(() => controller.abort(), timeoutMs);

            try {
                if (signal?.aborted) controller.abort(signal.reason);
                const response = await fetchImpl(requestUrl, {
                    headers: { "User-Agent": "Castorice/1.0 Radio Discovery" },
                    signal: controller.signal
                });
                if (controller.signal.aborted) {
                    throw new Error("Radio station search timed out.");
                }
                if (!response?.ok) {
                    throw new Error(`Radio Browser request failed with status ${response?.status || "unknown"}.`);
                }
                return mapStations(await response.json());
            } catch (error) {
                if (signal?.aborted) throw new Error("Radio station search was cancelled.");
                if (controller.signal.aborted) {
                    throw new Error("Radio station search timed out.");
                }
                throw new Error(`Radio station search failed: ${error.message}`);
            } finally {
                clearTimeout(timeout);
                signal?.removeEventListener("abort", abortListener);
            }
        }
    };
}

module.exports = {
    createRadioDiscovery,
    mapStations,
    normalizeStreamUrl,
    MAX_RESULTS
};
