const test = require("node:test");
const assert = require("node:assert/strict");
const {
    AIProviderError,
    OpenAICompatibleProvider,
    createAIProviderFromEnv
} = require("../../src/ai/openai-compatible-provider");

function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    };
}

test("provider sends configured model and bearer credentials, then validates usage", async () => {
    let request;
    const provider = new OpenAICompatibleProvider({
        baseUrl: "https://example.test/v1/",
        apiKey: "test-secret",
        model: "test-model",
        fetchImpl: async (url, options) => {
            request = { url, options };
            return jsonResponse({
                choices: [{ message: { content: "  Halo!  " } }],
                usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }
            });
        }
    });

    const result = await provider.generate([
        { role: "system", content: "System" },
        { role: "user", content: "Hello" }
    ]);

    assert.equal(request.url, "https://example.test/v1/chat/completions");
    assert.equal(request.options.headers.Authorization, "Bearer test-secret");
    assert.equal(JSON.parse(request.options.body).model, "test-model");
    assert.equal(result.text, "Halo!");
    assert.deepEqual(result.usage, {
        promptTokens: 4,
        completionTokens: 2,
        totalTokens: 6
    });
});

test("provider retries one transient server error", async () => {
    let calls = 0;
    const provider = new OpenAICompatibleProvider({
        apiKey: "test-secret",
        model: "test-model",
        fetchImpl: async () => {
            calls += 1;
            return calls === 1
                ? jsonResponse({}, 503)
                : jsonResponse({ choices: [{ message: { content: "Ready" } }] });
        }
    });

    assert.equal((await provider.generate([{ role: "user", content: "Hello" }])).text, "Ready");
    assert.equal(calls, 2);
});

test("provider reports safe error codes and rejects unsafe endpoint forms", async () => {
    const provider = new OpenAICompatibleProvider({
        apiKey: "test-secret",
        model: "test-model",
        maxRetries: 0,
        fetchImpl: async () => jsonResponse({}, 401)
    });

    await assert.rejects(
        provider.generate([{ role: "user", content: "Hello" }]),
        error => error instanceof AIProviderError && error.code === "authentication_failed"
    );
    assert.throws(() => new OpenAICompatibleProvider({
        baseUrl: "https://user:password@example.test/v1",
        apiKey: "test-secret",
        model: "test-model"
    }), /without credentials/);
    assert.throws(() => new OpenAICompatibleProvider({
        baseUrl: "https://example.test/v1?token=secret",
        apiKey: "test-secret",
        model: "test-model"
    }), /without credentials/);
});

test("OpenAI-compatible adapter classifies invalid keys, quota, rate limits, models, and outages", async () => {
    const cases = [
        [401, { error: { code: "invalid_api_key", message: "do not expose this detail" } }, "invalid_api_key"],
        [429, { error: { code: "insufficient_quota", message: "billing detail" } }, "quota_exceeded"],
        [429, { error: { code: "rate_limit_exceeded" } }, "rate_limited"],
        [404, { error: { code: "model_not_found" } }, "model_not_compatible"],
        [503, { error: { message: "private outage detail" } }, "provider_unavailable"]
    ];

    for (const [status, body, expectedCode] of cases) {
        let calls = 0;
        const provider = new OpenAICompatibleProvider({
            apiKey: "test-secret",
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
                !error.message.includes("billing")
        );
        assert.equal(calls, expectedCode === "rate_limited" || expectedCode === "provider_unavailable" ? 2 : 1);
    }
});

test("OpenAI-compatible adapter exposes only safe HTTP status and operation metadata", async () => {
    const provider = new OpenAICompatibleProvider({
        apiKey: "test-secret",
        model: "test-model",
        maxRetries: 0,
        fetchImpl: async () => jsonResponse({
            error: { message: "private validation detail containing a secret" }
        }, 400)
    });

    await assert.rejects(
        provider.generate([{ role: "user", content: "Hello" }]),
        error => error.code === "provider_error" &&
            error.operation === "generate" &&
            error.statusCode === 400 &&
            !error.message.includes("private")
    );
});

test("OpenAI-compatible adapter rejects malformed successful responses safely", async () => {
    const provider = new OpenAICompatibleProvider({
        apiKey: "test-secret",
        model: "test-model",
        maxRetries: 0,
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => { throw new Error("private malformed body"); }
        })
    });

    await assert.rejects(
        provider.generate([{ role: "user", content: "Hello" }]),
        error => error.code === "invalid_response" &&
            error.operation === "generate" &&
            !error.message.includes("private")
    );
});

test("provider aborts requests after its configured timeout", async () => {
    const provider = new OpenAICompatibleProvider({
        apiKey: "test-secret",
        model: "test-model",
        timeoutMs: 100,
        maxRetries: 0,
        fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
            }, { once: true });
        })
    });

    await assert.rejects(
        provider.generate([{ role: "user", content: "Hello" }]),
        error => error instanceof AIProviderError && error.code === "timeout"
    );
});

test("provider aborts an active request when its conversation is reset", async () => {
    const abortController = new AbortController();
    const provider = new OpenAICompatibleProvider({
        apiKey: "test-secret",
        model: "test-model",
        timeoutMs: 5_000,
        maxRetries: 0,
        fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
            }, { once: true });
        })
    });
    const pending = provider.generate(
        [{ role: "user", content: "private" }],
        { signal: abortController.signal }
    );
    abortController.abort();

    await assert.rejects(
        pending,
        error => error instanceof AIProviderError && error.code === "cancelled"
    );
});

test("provider factory stays unconfigured until a key is supplied", () => {
    assert.equal(createAIProviderFromEnv({}), null);
    const discovered = createAIProviderFromEnv({ AI_API_KEY: "test-secret" });
    assert.ok(discovered instanceof OpenAICompatibleProvider);
    assert.equal(discovered.model, null);
    assert.equal(discovered.modelDiscovery, "openai");
    assert.throws(() => createAIProviderFromEnv({
        AI_API_KEY: "test-secret",
        AI_MODEL: "test-model",
        AI_TIMEOUT_MS: "invalid"
    }), /AI_TIMEOUT_MS/);
});
