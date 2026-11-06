class LyricsTranslationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "LyricsTranslationError";
        this.code = code;
    }
}

function getLyricsLines(result) {
    if (result?.synced && Array.isArray(result.lyrics)) {
        return result.lyrics.map(line => String(line?.text || ""));
    }

    if (typeof result?.plainLyrics === "string") {
        return result.plainLyrics.replace(/\r\n?/g, "\n").split("\n");
    }

    return [];
}

function splitLongLine(line, limit) {
    const characters = Array.from(line);
    const parts = [];

    for (let index = 0; index < characters.length; index += limit) {
        parts.push(characters.slice(index, index + limit).join(""));
    }

    return parts.length ? parts : [""];
}

function makeSegments(lines, limit) {
    const segments = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const parts = splitLongLine(lines[lineIndex], limit);

        for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
            segments.push({
                text: parts[partIndex],
                before: segments.length === 0
                    ? ""
                    : partIndex === 0
                        ? "\n"
                        : ""
            });
        }
    }

    return segments;
}

function makeBatches(segments, limit) {
    const batches = [];
    let current = [];
    let currentLength = 0;
    let joinBefore = "";

    for (const segment of segments) {
        const additionLength = segment.text.length +
            (current.length ? segment.before.length : 0);

        if (current.length && currentLength + additionLength > limit) {
            batches.push({ segments: current, joinBefore });
            current = [];
            currentLength = 0;
            joinBefore = segment.before;
        }

        current.push(segment);
        currentLength += additionLength;
    }

    if (current.length) {
        batches.push({ segments: current, joinBefore });
    }

    return batches;
}

async function translateLyrics(result, translator, { target, source = "auto" } = {}) {
    if (!result || typeof result !== "object") {
        throw new LyricsTranslationError("invalid_lyrics", "Lyrics result is invalid.");
    }

    if (!translator || typeof translator.translate !== "function") {
        throw new LyricsTranslationError("invalid_provider", "A translation provider is required.");
    }

    const lines = getLyricsLines(result);
    if (!lines.length || lines.every(line => !line.trim())) {
        throw new LyricsTranslationError("no_lyrics", "There are no lyrics to translate.");
    }

    const limit = Number.isInteger(translator.maxLength) && translator.maxLength > 0
        ? translator.maxLength
        : 4000;
    const batches = makeBatches(makeSegments(lines, limit), limit);
    const translatedBatches = [];
    let detectedLanguage = null;

    for (const batch of batches) {
        const text = batch.segments
            .map((segment, index) => `${index === 0 ? "" : segment.before}${segment.text}`)
            .join("");
        const translated = await translator.translate({ text, source, target });

        if (!translated || typeof translated.translatedText !== "string") {
            throw new LyricsTranslationError(
                "invalid_provider_response",
                "Translation provider returned no translated lyrics."
            );
        }

        translatedBatches.push({
            text: translated.translatedText,
            joinBefore: batch.joinBefore
        });
        detectedLanguage ||= translated.detectedLanguage || null;
    }

    const translatedText = translatedBatches
            .map((batch, index) => `${index === 0 ? "" : batch.joinBefore}${batch.text}`)
            .join("");
    const translatedLines = translatedText.replace(/\r\n?/g, "\n").split("\n");
    const aligned = Boolean(
        result.synced &&
        Array.isArray(result.lyrics) &&
        batches.length === 1 &&
        lines.every(line => line.length <= limit) &&
        translatedLines.length === result.lyrics.length &&
        result.lyrics.length === lines.length
    );
    const alignedLyrics = aligned
        ? result.lyrics.map((line, index) => ({
            time: line.time,
            text: translatedLines[index]
        }))
        : null;

    return {
        translatedText,
        source: detectedLanguage || source,
        target,
        detectedLanguage,
        provider: "translator-adapter",
        synchronized: aligned,
        alignment: aligned ? "line" : "not-guaranteed",
        alignedLyrics
    };
}

module.exports = {
    LyricsTranslationError,
    translateLyrics
};
