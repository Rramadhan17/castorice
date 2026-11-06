const DEFAULT_BASE_URL = "https://libretranslate.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_LENGTH = 4_000;
const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

class TranslatorError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "TranslatorError";
        this.code = code;
    }
}

class LibreTranslateProvider {
    constructor({
        baseUrl = DEFAULT_BASE_URL,
        apiKey = "",
        timeoutMs = DEFAULT_TIMEOUT_MS,
        maxLength = DEFAULT_MAX_LENGTH,
        fetchImpl = globalThis.fetch
    } = {}) {
        if (typeof baseUrl !== "string" || !baseUrl.trim()) {
            throw new TypeError("Translator baseUrl must be a non-empty URL.");
        }

        let parsedBaseUrl;
        try {
            parsedBaseUrl = new URL(baseUrl);
        } catch {
            throw new TypeError("Translator baseUrl must be a valid URL.");
        }

        if (!["http:", "https:"].includes(parsedBaseUrl.protocol)) {
            throw new TypeError("Translator baseUrl must use HTTP or HTTPS.");
        }
        if (!Number.isInteger(timeoutMs) || timeoutMs < 100) {
            throw new TypeError("Translator timeoutMs must be at least 100 ms.");
        }
        if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 20_000) {
            throw new TypeError("Translator maxLength must be between 1 and 20000.");
        }
        if (typeof fetchImpl !== "function") {
            throw new TypeError("This Node.js runtime must provide fetch().");
        }

        this.baseUrl = parsedBaseUrl.toString().replace(/\/$/, "");
        this.apiKey = String(apiKey || "");
        this.timeoutMs = timeoutMs;
        this.maxLength = maxLength;
        this.fetch = fetchImpl;
        this.languagesCache = null;
        this.languagesExpiresAt = 0;
    }

    async _request(path, { method = "GET", body } = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await this.fetch(`${this.baseUrl}${path}`, {
                method,
                headers: body
                    ? { "Content-Type": "application/json", Accept: "application/json" }
                    : { Accept: "application/json" },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });

            if (!response.ok) {
                const code = response.status === 429
                    ? "rate_limited"
                    : response.status === 401 || response.status === 403
                        ? "authentication_failed"
                        : "provider_error";
                const message = response.status === 429
                    ? "Translation provider is rate limiting requests."
                    : response.status === 401 || response.status === 403
                        ? "Translation provider rejected its configured credentials."
                        : `Translation provider returned HTTP ${response.status}.`;
                throw new TranslatorError(code, message);
            }

            try {
                return await response.json();
            } catch {
                throw new TranslatorError("invalid_response", "Translation provider returned invalid JSON.");
            }
        } catch (error) {
            if (error instanceof TranslatorError) throw error;
            if (controller.signal.aborted || error?.name === "AbortError") {
                throw new TranslatorError("timeout", "Translation provider request timed out.");
            }
            throw new TranslatorError("unavailable", "Translation provider could not be reached.");
        } finally {
            clearTimeout(timer);
        }
    }

    async getLanguages({ forceRefresh = false } = {}) {
        if (!forceRefresh && this.languagesCache && Date.now() < this.languagesExpiresAt) {
            return this.languagesCache.map(language => ({ ...language, targets: [...language.targets] }));
        }

        const result = await this._request("/languages");
        if (!Array.isArray(result)) {
            throw new TranslatorError("invalid_response", "Translation provider returned an invalid language list.");
        }

        const languages = result.filter(item =>
            item &&
            typeof item.code === "string" &&
            LANGUAGE_CODE.test(item.code) &&
            typeof item.name === "string" &&
            Array.isArray(item.targets)
        ).map(item => ({
            code: item.code.toLowerCase(),
            name: item.name,
            targets: item.targets.filter(code => typeof code === "string" && LANGUAGE_CODE.test(code)).map(code => code.toLowerCase())
        }));

        if (!languages.length) {
            throw new TranslatorError("invalid_response", "Translation provider returned no usable languages.");
        }

        this.languagesCache = languages;
        this.languagesExpiresAt = Date.now() + 60 * 60 * 1000;
        return languages.map(language => ({ ...language, targets: [...language.targets] }));
    }

    async translate({ text, target, source = "auto" }) {
        if (typeof text !== "string" || !text.trim()) {
            throw new TranslatorError("invalid_text", "Translation text must not be empty.");
        }
        if ([...text].length > this.maxLength) {
            throw new TranslatorError("text_too_long", `Translation text exceeds the ${this.maxLength} character limit.`);
        }
        if (typeof source !== "string" || (source.toLowerCase() !== "auto" && !LANGUAGE_CODE.test(source))) {
            throw new TranslatorError("invalid_language", "Source language code is invalid.");
        }
        if (typeof target !== "string" || !LANGUAGE_CODE.test(target)) {
            throw new TranslatorError("invalid_language", "Target language code is invalid.");
        }

        const sourceCode = source.toLowerCase();
        const targetCode = target.toLowerCase();
        if (sourceCode !== "auto" && sourceCode === targetCode) {
            throw new TranslatorError("invalid_language", "Source and target languages must differ.");
        }

        const languages = await this.getLanguages();
        const targetLanguage = languages.find(language => language.code === targetCode);
        if (!targetLanguage) {
            throw new TranslatorError("unsupported_language", `Target language '${targetCode}' is not supported by the configured provider.`);
        }
        if (sourceCode !== "auto") {
            const sourceLanguage = languages.find(language => language.code === sourceCode);
            if (!sourceLanguage || !sourceLanguage.targets.includes(targetCode)) {
                throw new TranslatorError("unsupported_language", `Translation from '${sourceCode}' to '${targetCode}' is not supported by the configured provider.`);
            }
        }

        const payload = {
            q: text,
            source: sourceCode,
            target: targetCode,
            format: "text"
        };
        if (this.apiKey) payload.api_key = this.apiKey;

        const result = await this._request("/translate", { method: "POST", body: payload });
        if (!result || typeof result.translatedText !== "string") {
            throw new TranslatorError("invalid_response", "Translation provider returned no translated text.");
        }

        return {
            translatedText: result.translatedText,
            source: sourceCode,
            target: targetCode,
            detectedLanguage: typeof result.detectedLanguage?.language === "string"
                ? result.detectedLanguage.language
                : null,
            provider: "libretranslate"
        };
    }
}

function createTranslatorFromEnv(env = process.env, options = {}) {
    const baseUrl = env.LIBRETRANSLATE_URL || DEFAULT_BASE_URL;
    const apiKey = env.LIBRETRANSLATE_API_KEY || "";
    const timeoutValue = env.TRANSLATOR_TIMEOUT_MS;
    const maxLengthValue = env.TRANSLATOR_MAX_LENGTH;

    const timeoutMs = timeoutValue === undefined
        ? DEFAULT_TIMEOUT_MS
        : Number(timeoutValue);
    const maxLength = maxLengthValue === undefined
        ? DEFAULT_MAX_LENGTH
        : Number(maxLengthValue);

    return new LibreTranslateProvider({
        baseUrl,
        apiKey,
        timeoutMs,
        maxLength,
        ...options
    });
}

module.exports = {
    LibreTranslateProvider,
    TranslatorError,
    createTranslatorFromEnv
};
