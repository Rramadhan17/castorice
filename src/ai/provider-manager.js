const { GeminiProvider } = require("./gemini-provider");

const DEFAULT_TIMEOUT_MS = 15_000;

function parseTimeout(environment) {
    const value = environment.AI_TIMEOUT_MS;
    if (value === undefined || value === "") return DEFAULT_TIMEOUT_MS;
    const timeoutMs = Number(value);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
        throw new TypeError("AI_TIMEOUT_MS must be between 100 and 120000.");
    }
    return timeoutMs;
}

function createGeminiProviderFromEnv(environment = process.env, options = {}) {
    const apiKey = environment.GEMINI_API_KEY;
    const model = environment.GEMINI_MODEL;
    if ((apiKey !== undefined && typeof apiKey !== "string") ||
        (model !== undefined && typeof model !== "string")) {
        throw new TypeError("Gemini configuration values must be strings.");
    }
    if (!apiKey?.trim()) {
        if (model?.trim()) {
            throw new TypeError("GEMINI_MODEL requires GEMINI_API_KEY.");
        }
        return null;
    }

    return new GeminiProvider({
        apiKey,
        model: model?.trim() || null,
        timeoutMs: parseTimeout(environment),
        fetchImpl: options.fetchImpl
    });
}

module.exports = { createGeminiProviderFromEnv };
