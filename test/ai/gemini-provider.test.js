const test = require("node:test");
const assert = require("node:assert/strict");
const { AIProviderError } = require("../../src/ai/openai-compatible-provider");
const { GeminiProvider } = require("../../src/ai/gemini-provider");

function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    };
}

test("Gemini adapter maps chat history and reports safe token usage", async () => {
    let request;
    const provider = new GeminiProvider({
        apiKey: "test-key",
        model: "test-model",
        fetchImpl: async (url, options) => {
            request = { url, options };
            return jsonResponse({
                candidates: [{ content: { parts: [{ text: "Halo " }, { text: "Castorice!" }] } }],
                usageMetadata: {
                    promptTokenCount: 7,
                    candidatesTokenCount: 3,
                    totalTokenCount: 10
                }
            });
        }
    });

    const result = await provider.generate([
        { role: "system", content: "Be helpful." },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
        { role: "user", content: "Continue" }
    ]);

    assert.equal(request.url, "https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent");
    assert.equal(request.options.headers["x-goog-api-key"], "test-key");
    const body = JSON.parse(request.options.body);
    assert.deepEqual(body.systemInstruction.parts, [{ text: "Be helpful." }]);
    assert.deepEqual(body.contents.map(item => item.role), ["user", "model", "user"]);
    assert.equal(result.text, "Halo Castorice!");
    assert.deepEqual(result.usage, {
        promptTokens: 7,
        completionTokens: 3,
        totalTokens: 10
    });
});

test("Gemini adapter classifies provider errors without exposing response bodies", async () => {
    const provider = new GeminiProvider({
        apiKey: "test-key",
        model: "test-model",
        fetchImpl: async () => jsonResponse({ error: { message: "private provider detail" } }, 401)
    });

    await assert.rejects(
        provider.generate([{ role: "user", content: "Hello" }]),
        error => error instanceof AIProviderError &&
            error.code === "authentication_failed" &&
            error.operation === "generate" &&
            error.statusCode === 401 &&
            !error.message.includes("private provider detail")
    );
});

test("Gemini adapter distinguishes invalid keys, quota, rate limits, invalid models, and outages", async () => {
    const cases = [
        [401, { error: { status: "INVALID_API_KEY", message: "private authentication detail" } }, "invalid_api_key"],
        [400, { error: { status: "INVALID_ARGUMENT", message: "private request detail" } }, "request_error"],
        [403, { error: { status: "PERMISSION_DENIED", message: "private access detail" } }, "authentication_failed"],
        [429, { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }, "quota_exceeded"],
        [429, { error: { status: "RESOURCE_EXHAUSTED", message: "Rate limit exceeded" } }, "rate_limited"],
        [404, { error: { status: "NOT_FOUND", message: "model not found" } }, "model_not_compatible"],
        [503, { error: { message: "private outage detail" } }, "provider_unavailable"]
    ];

    for (const [status, body, expectedCode] of cases) {
        let calls = 0;
        const provider = new GeminiProvider({
            apiKey: "test-key",
            model: "test-model",
            fetchImpl: async () => {
                calls += 1;
                return jsonResponse(body, status);
            }
        });
        await assert.rejects(
            provider.generate([{ role: "user", content: "Hello" }]),
            error => error.code === expectedCode &&
                !error.message.includes("private") &&
                !error.message.includes("Quota")
        );
        assert.equal(calls, expectedCode === "rate_limited" || expectedCode === "provider_unavailable" ? 2 : 1);
    }
});

test("Gemini adapter validates model and aborts timed-out requests", async () => {
    assert.throws(() => new GeminiProvider({
        apiKey: "test-key",
        model: "model/name"
    }), /valid model identifier/);

    const provider = new GeminiProvider({
        apiKey: "test-key",
        model: "test-model",
        timeoutMs: 100,
        fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
            }, { once: true });
        })
    });

    test("Gemini adapter rejects malformed successful responses without exposing payload details", async () => {
        const provider = new GeminiProvider({
            apiKey: "test-key",
            model: "test-model",
            fetchImpl: async () => jsonResponse({ candidates: [] })
        });

        await assert.rejects(
            provider.generate([{ role: "user", content: "Hello" }]),
            error => error.code === "invalid_response" &&
                error.operation === "generate" &&
                !error.message.includes("candidates")
        );
    });

    await assert.rejects(
        provider.generate([{ role: "user", content: "Hello" }]),
        error => error instanceof AIProviderError && error.code === "timeout"
    );
});
