const test = require("node:test");
const assert = require("node:assert/strict");
const {
    LibreTranslateProvider,
    TranslatorError,
    createTranslatorFromEnv
} = require("../../src/translator/libretranslate-provider");

function response(data, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => data
    };
}

const languageList = [
    { code: "en", name: "English", targets: ["id", "tl"] },
    { code: "id", name: "Indonesian", targets: ["en", "tl"] },
    { code: "tl", name: "Tagalog", targets: ["en", "id"] }
];

test("translates text and caches language metadata", async () => {
    const calls = [];
    const provider = new LibreTranslateProvider({
        baseUrl: "https://translation.example/",
        apiKey: "test-key",
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            return url.endsWith("/languages")
                ? response(languageList)
                : response({ translatedText: "Halo", detectedLanguage: { language: "en" } });
        }
    });

    const result = await provider.translate({ text: "Hello", source: "en", target: "id" });
    assert.deepEqual(result, {
        translatedText: "Halo", source: "en", target: "id",
        detectedLanguage: "en", provider: "libretranslate"
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://translation.example/languages");
    assert.equal(calls[1].url, "https://translation.example/translate");
    assert.deepEqual(JSON.parse(calls[1].options.body), {
        q: "Hello", source: "en", target: "id", format: "text", api_key: "test-key"
    });
});

test("supports automatic detection and omits an empty API key", async () => {
    let body;
    const provider = new LibreTranslateProvider({
        fetchImpl: async (url, options) => {
            if (url.endsWith("/languages")) return response(languageList);
            body = JSON.parse(options.body);
            return response({ translatedText: "Halo" });
        }
    });
    await provider.translate({ text: "Hello", target: "id" });
    assert.equal(body.source, "auto");
    assert.equal(Object.hasOwn(body, "api_key"), false);
});

test("rejects invalid text, language codes, and unsupported pairs", async () => {
    const provider = new LibreTranslateProvider({
        maxLength: 5, fetchImpl: async () => response(languageList)
    });
    await assert.rejects(provider.translate({ text: " ", target: "id" }), { code: "invalid_text" });
    await assert.rejects(provider.translate({ text: "123456", target: "id" }), { code: "text_too_long" });
    await assert.rejects(provider.translate({ text: "hi", target: "invalid_code_!" }), { code: "invalid_language" });
    await assert.rejects(provider.translate({ text: "hi", target: "xx" }), { code: "unsupported_language" });
    await assert.rejects(provider.translate({ text: "hi", source: "tl", target: "tl" }), { code: "invalid_language" });
});

test("sanitizes provider errors and does not leak credentials or response bodies", async () => {
    const provider = new LibreTranslateProvider({
        apiKey: "private-secret",
        fetchImpl: async () => response({ error: "private-secret must not leak" }, 403)
    });
    await assert.rejects(provider.getLanguages(), error => {
        assert.ok(error instanceof TranslatorError);
        assert.equal(error.code, "authentication_failed");
        assert.equal(error.message.includes("private-secret"), false);
        return true;
    });
});

test("maps network errors and timeouts to sanitized messages", async () => {
    const unavailable = new LibreTranslateProvider({
        fetchImpl: async () => { throw new Error("private-url?key=secret"); }
    });
    await assert.rejects(unavailable.getLanguages(), error => {
        assert.equal(error.code, "unavailable");
        assert.equal(error.message.includes("secret"), false);
        return true;
    });

    const timeout = new LibreTranslateProvider({
        timeoutMs: 100,
        fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
            });
        })
    });
    await assert.rejects(timeout.getLanguages(), { code: "timeout" });
});

test("loads settings from environment", () => {
    const provider = createTranslatorFromEnv({
        LIBRETRANSLATE_URL: "http://localhost:5000/",
        LIBRETRANSLATE_API_KEY: "secret",
        TRANSLATOR_TIMEOUT_MS: "5000",
        TRANSLATOR_MAX_LENGTH: "3000"
    }, { fetchImpl: async () => response([]) });
    assert.equal(provider.baseUrl, "http://localhost:5000");
    assert.equal(provider.timeoutMs, 5000);
    assert.equal(provider.maxLength, 3000);
    assert.equal(provider.apiKey, "secret");
});
