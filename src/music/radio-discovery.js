const net = require("node:net");

const RADIO_BROWSER_BASE_URL = "https://de1.api.radio-browser.info";
const MAX_RESULTS = 8;
const MAX_QUERY_LENGTH = 100;
const REQUEST_TIMEOUT_MS = 8000;

function isPrivateIp(host) {
    const version = net.isIP(host);
    if (version === 4) {
        const [a, b] = host.split(".").map(Number);
        return a === 0 ||
            a === 10 ||
            a === 127 ||
            a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && (b === 0 || b === 168)) ||
            (a === 198 && (b === 18 || b === 19)) ||
            (a === 203 && b === 0);
    }

    if (version === 6) {
        const normalized = host.toLowerCase();
        if (normalized.startsWith("::ffff:")) {
            const mapped = normalized.slice(7);
            return net.isIP(mapped) === 4 ? isPrivateIp(mapped) : true;
        }
        return normalized === "::" ||
            normalized === "::1" ||
            normalized.startsWith("fc") ||
            normalized.startsWith("fd") ||
            /^fe[89ab]/i.test(normalized) ||
            normalized.startsWith("ff") ||
            normalized.startsWith("2001:db8:");
    }

    return false;
}

function normalizeStreamUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;

    try {
        const url = new URL(value.trim());
        const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        if (
            !["http:", "https:"].includes(url.protocol) ||
            url.username ||
            url.password ||
            !host ||
            host === "localhost" ||
            host.endsWith(".localhost") ||
            host.endsWith(".local") ||
            host.endsWith(".internal") ||
            isPrivateIp(host)
        ) return null;

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
    fetchImpl = globalThis.fetch,
    baseUrl = RADIO_BROWSER_BASE_URL,
    timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
    if (typeof fetchImpl !== "function") {
        throw new TypeError("Radio Discovery requires a fetch implementation.");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
        throw new RangeError("Radio Discovery timeout must be between 1 and 60000 ms.");
    }

    const root = new URL(baseUrl);
    if (root.protocol !== "https:" || root.username || root.password) {
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
