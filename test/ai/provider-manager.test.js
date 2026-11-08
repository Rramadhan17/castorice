const test = require("node:test");
const assert = require("node:assert/strict");
const { createGeminiProviderFromEnv } = require("../../src/ai/provider-manager");

test("runtime AI factory configures Gemini only and never calls legacy provider endpoints", async () => {
    const calls = [];
    const provider = createGeminiProviderFromEnv({
        GEMINI_API_KEY: "test-gemini-key",
        GEMINI_MODEL: "gemini-test",
        AI_API_KEY: "ignored-openai-key",
        AI_MODEL: "ignored-openai-model",
        OPENROUTER_API_KEY: "ignored-openrouter-key",
        OPENROUTER_MODEL: "ignored-openrouter-model",
        AI_PROVIDER_ORDER: "openai,openrouter",
        AI_FAILOVER_ENABLED: "true"
    }, {
        fetchImpl: async (input, options) => {
            const url = new URL(input);
            calls.push({ host: url.hostname, path: url.pathname, method: options.method });
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    candidates: [{ content: { parts: [{ text: "Gemini response" }] } }]
                })
            };
        }
    });

    assert.equal(typeof provider.generate, "function");
    assert.equal(provider.getAvailableProviders, undefined);
    assert.equal(provider.setOrder, undefined);
    assert.equal(provider.setFailoverEnabled, undefined);
    const response = await provider.generate([{ role: "user", content: "hello" }]);

    assert.equal(response.text, "Gemini response");
    assert.deepEqual(calls, [{
        host: "generativelanguage.googleapis.com",
        path: "/v1beta/models/gemini-test:generateContent",
        method: "POST"
    }]);
});

test("Gemini factory returns no provider when its required key is missing", () => {
    assert.equal(createGeminiProviderFromEnv({
        AI_API_KEY: "ignored-openai-key",
        OPENROUTER_API_KEY: "ignored-openrouter-key"
    }), null);
});

test("Gemini failure never falls through to OpenAI or OpenRouter", async () => {
    const calls = [];
    const provider = createGeminiProviderFromEnv({
        GEMINI_API_KEY: "test-gemini-key",
        GEMINI_MODEL: "gemini-test",
        AI_API_KEY: "ignored-openai-key",
        OPENROUTER_API_KEY: "ignored-openrouter-key",
        AI_PROVIDER_ORDER: "openai,openrouter"
    }, {
        fetchImpl: async input => {
            calls.push(new URL(input).hostname);
            return {
                ok: false,
                status: 503,
                json: async () => ({ error: { message: "private test failure" } })
            };
        }
    });

    await assert.rejects(
        provider.generate([{ role: "user", content: "hello" }]),
        error => error.code === "provider_unavailable" &&
            !error.message.includes("private test failure")
    );
    assert.deepEqual(calls, [
        "generativelanguage.googleapis.com",
        "generativelanguage.googleapis.com"
    ]);
});

test("Gemini factory validates model, timeout, and key configuration without exposing values", () => {
    assert.throws(
        () => createGeminiProviderFromEnv({ GEMINI_MODEL: "gemini-test" }),
        /GEMINI_MODEL requires GEMINI_API_KEY/
    );
    assert.throws(
        () => createGeminiProviderFromEnv({
            GEMINI_API_KEY: "secret-gemini-key",
            AI_TIMEOUT_MS: "invalid"
        }),
        error => error instanceof TypeError &&
            error.message.includes("AI_TIMEOUT_MS") &&
            !error.message.includes("secret-gemini-key")
    );
});
