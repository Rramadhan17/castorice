const { parseLrc } = require("./lrc-parser");
const { cleanTrackMetadata } = require("./title-cleaner");

const LRCLIB_BASE = "https://lrclib.net/api";
const LYRICS_OVH_BASE = "https://api.lyrics.ovh/v1";
const USER_AGENT = "Castorice/1.0 (Discord Music Bot)";
const REQUEST_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 30 * 60 * 1000;

const cache = new Map();

function normalize(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

function getCacheKey(track) {
    return [
        normalize(track.title || track.input),
        normalize(track.artist),
        Math.round(Number(track.duration) || 0)
    ].join("|");
}

async function fetchWithTimeout(url, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": USER_AGENT,
                "Accept": "application/json"
            },
            signal: controller.signal
        });
        return response;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Provider 1: LRCLIB (Primary - supports timestamped LRC)
 */
async function queryLrclib(title, artist, duration) {
    const hasArtist = artist && !/^unknown(?: artist)?$/i.test(artist);
    let record = null;

    if (hasArtist) {
        const params = new URLSearchParams({
            track_name: title,
            artist_name: artist
        });
        if (duration > 0) {
            params.set("duration", String(Math.round(duration)));
        }

        try {
            const res = await fetchWithTimeout(`${LRCLIB_BASE}/get?${params.toString()}`);
            if (res.ok) {
                record = await res.json();
            }
        } catch {}
    }

    if (!record) {
        const params = new URLSearchParams({ track_name: title });
        try {
            const res = await fetchWithTimeout(`${LRCLIB_BASE}/search?${params.toString()}`);
            if (res.ok) {
                const candidates = await res.json();
                if (Array.isArray(candidates) && candidates.length) {
                    const normalizedTitle = normalize(title);
                    const matches = candidates.filter(item =>
                        normalize(item.trackName) === normalizedTitle
                    );
                    const pool = matches.length ? matches : candidates;
                    pool.sort((a, b) => {
                        const diffA = duration > 0 && a.duration > 0 ? Math.abs(a.duration - duration) : 99999;
                        const diffB = duration > 0 && b.duration > 0 ? Math.abs(b.duration - duration) : 99999;
                        return diffA - diffB;
                    });
                    record = pool[0] || null;
                }
            }
        } catch {}
    }

    if (!record) return null;

    if (record.instrumental) {
        return {
            found: true,
            instrumental: true,
            synced: false,
            lyrics: [],
            plainLyrics: "",
            source: "LRCLIB"
        };
    }

    const syncedText = typeof record.syncedLyrics === "string" ? record.syncedLyrics : "";
    const plainText = typeof record.plainLyrics === "string" ? record.plainLyrics.trim() : "";
    const lyrics = parseLrc(syncedText);

    if (lyrics.length > 0 || plainText) {
        return {
            found: true,
            instrumental: false,
            synced: lyrics.length > 0,
            lyrics,
            plainLyrics: plainText,
            source: "LRCLIB"
        };
    }

    return null;
}

/**
 * Provider 2: Lyrics.ovh (Fallback - legal open API for plain lyrics)
 */
async function queryLyricsOvh(title, artist) {
    if (!artist || !title) return null;
    try {
        const encArtist = encodeURIComponent(artist);
        const encTitle = encodeURIComponent(title);
        const res = await fetchWithTimeout(`${LYRICS_OVH_BASE}/${encArtist}/${encTitle}`);
        if (!res.ok) return null;
        const data = await res.json();
        const plain = String(data?.lyrics || "").trim();
        if (plain) {
            return {
                found: true,
                instrumental: false,
                synced: false,
                lyrics: [],
                plainLyrics: plain,
                source: "LyricsOVH"
            };
        }
    } catch {}
    return null;
}

async function searchLyrics(track, runtime = {}) {
    if (!track || typeof track !== "object") {
        throw new TypeError("Track tidak valid.");
    }

    const rawTitle = String(track.title || track.input || "").trim();
    const rawArtist = String(track.artist || "").trim();
    const duration = Number(track.duration) || 0;

    if (!rawTitle) {
        return {
            found: false,
            reason: "missing_title",
            lyrics: []
        };
    }

    const cacheKey = getCacheKey(track);
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
    }

    // Clean metadata (remove video tags, extract versions)
    const metadata = cleanTrackMetadata(rawTitle, rawArtist);
    const title = metadata.cleanTitle;
    const artist = metadata.cleanArtist;

    let result = null;

    // 1. Query LRCLIB primary
    const lrclibQuery = runtime.queryLrclib || queryLrclib;
    try {
        result = await lrclibQuery(title, artist, duration);
    } catch (err) {
        if (err.name === "AbortError") {
            result = { found: false, reason: "timeout", lyrics: [] };
        }
    }

    // 2. Fallback to Lyrics.ovh if not found or no synced/plain
    if (!result || (!result.found && result.reason !== "timeout")) {
        const ovhQuery = runtime.queryLyricsOvh || queryLyricsOvh;
        try {
            const fallbackResult = await ovhQuery(title, artist);
            if (fallbackResult && fallbackResult.found) {
                result = fallbackResult;
            }
        } catch {}
    }

    if (!result) {
        result = {
            found: false,
            reason: "not_found",
            lyrics: [],
            plainLyrics: ""
        };
    }

    cache.set(cacheKey, {
        result,
        expiresAt: Date.now() + CACHE_TTL_MS
    });

    return result;
}

function clearCache() {
    cache.clear();
}

module.exports = {
    searchLyrics,
    clearCache,
    queryLrclib,
    queryLyricsOvh
};
