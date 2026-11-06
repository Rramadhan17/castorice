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
    assert.equal(createAIProviderFromEnv({ AI_API_KEY: "test-secret" }), null);
    assert.throws(() => createAIProviderFromEnv({
        AI_API_KEY: "test-secret",
        AI_MODEL: "test-model",
        AI_TIMEOUT_MS: "invalid"
    }), /AI_TIMEOUT_MS/);
});
