/**
 * Title & Artist Cleaner for Lyrics Engine.
 * Extracts clean track titles, artist names, versions (live, remix, acoustic, cover),
 * and strips video noise from YouTube/web inputs.
 */

const REMOVE_PATTERNS = [
    /\((?:official\s+)?(?:music\s+)?video\)/gi,
    /\[(?:official\s+)?(?:music\s+)?video\]/gi,
    /\((?:official\s+)?audio\)/gi,
    /\[(?:official\s+)?audio\]/gi,
    /\((?:official\s+)?lyric(?:s)?\s+video\)/gi,
    /\[(?:official\s+)?lyric(?:s)?\s+video\]/gi,
    /\((?:visualizer|4k|hd|hq|audio)\)/gi,
    /\[(?:visualizer|4k|hd|hq|audio)\]/gi,
    /\((?:live(?:\s+at|\s+in|\s+version)?)[^)]*\)/gi,
    /\[(?:live(?:\s+at|\s+in|\s+version)?)[^\]]*\]/gi,
    /\((?:acoustic(?:\s+version)?|unplugged)[^)]*\)/gi,
    /\[(?:acoustic(?:\s+version)?|unplugged)[^\]]*\]/gi,
    /\((?:[^)]*remix|club mix|extended mix|vip mix)\)/gi,
    /\[(?:[^\]]*remix|club mix|extended mix|vip mix)\]/gi
];

const VERSION_PATTERNS = [
    { type: "remix", regex: /\b(?:remix|club mix|extended mix|vip mix)\b/i },
    { type: "acoustic", regex: /\b(?:acoustic(?:\s+version)?|unplugged)\b/i },
    { type: "live", regex: /\b(?:live(?:\s+at|\s+in|\s+version)?)\b/i },
    { type: "cover", regex: /\b(?:cover(?:\s+version)?)\b/i }
];

function cleanTrackMetadata(title, artist = "") {
    let rawTitle = String(title || "").trim();
    let rawArtist = String(artist || "").trim();

    if (/^unknown(?: artist)?$/i.test(rawArtist)) {
        rawArtist = "";
    }

    // If title has "Artist - Title" format and artist is not given or is channel name
    if (rawTitle.includes(" - ")) {
        const parts = rawTitle.split(" - ");
        if (parts.length >= 2) {
            const potentialArtist = parts[0].trim();
            const potentialTitle = parts.slice(1).join(" - ").trim();
            if (!rawArtist || rawArtist.toLowerCase() === potentialArtist.toLowerCase()) {
                rawArtist = potentialArtist;
                rawTitle = potentialTitle;
            }
        }
    }

    // Detect version (remix, acoustic, live, cover)
    let version = "original";
    for (const vp of VERSION_PATTERNS) {
        if (vp.regex.test(rawTitle)) {
            version = vp.type;
            break;
        }
    }

    // Detect featured artist (feat. / ft.)
    let featured = "";
    const featMatch = rawTitle.match(/\b(?:feat\.?|ft\.?)\s+([^()\[\]-]+)/i);
    if (featMatch) {
        featured = featMatch[1].trim();
    }

    // Remove video and visualizer tags
    let cleanTitle = rawTitle;
    for (const pat of REMOVE_PATTERNS) {
        cleanTitle = cleanTitle.replace(pat, " ");
    }

    // Remove feat tags from clean title for better search hits
    cleanTitle = cleanTitle.replace(/\b(?:feat\.?|ft\.?)\s+[^()\[\]-]+/gi, " ");

    // Remove extraneous brackets / parentheses
    cleanTitle = cleanTitle
        .replace(/\[\s*\]/g, "")
        .replace(/\(\s*\)/g, "")
        .replace(/\s+/g, " ")
        .trim();

    return {
        cleanTitle: cleanTitle || rawTitle,
        cleanArtist: rawArtist,
        version,
        featured,
        originalTitle: rawTitle,
        originalArtist: rawArtist
    };
}

module.exports = {
    cleanTrackMetadata,
    REMOVE_PATTERNS,
    VERSION_PATTERNS
};
