const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 1;
const MAX_RESPONSE_TOKENS = 800;

class AIProviderError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "AIProviderError";
        this.code = code;
    }
}

class OpenAICompatibleProvider {
    constructor({
        baseUrl = DEFAULT_BASE_URL,
        apiKey,
        model,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        maxRetries = DEFAULT_MAX_RETRIES,
        fetchImpl = globalThis.fetch
    } = {}) {
        if (typeof baseUrl !== "string" || !baseUrl.trim()) {
            throw new TypeError("AI baseUrl must be a non-empty URL.");
        }

        let parsedBaseUrl;
        try {
            parsedBaseUrl = new URL(baseUrl);
        } catch {
            throw new TypeError("AI baseUrl must be a valid URL.");
        }

        if (!["http:", "https:"].includes(parsedBaseUrl.protocol) ||
            parsedBaseUrl.username || parsedBaseUrl.password ||
            parsedBaseUrl.search || parsedBaseUrl.hash) {
            throw new TypeError("AI baseUrl must be an HTTP(S) URL without credentials, query, or fragment.");
        }
        if (typeof apiKey !== "string" || !apiKey.trim()) {
            throw new TypeError("AI apiKey must be configured.");
        }
        if (typeof model !== "string" || !model.trim() || model.length > 128) {
            throw new TypeError("AI model must be a non-empty string of at most 128 characters.");
        }
        if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
            throw new TypeError("AI timeoutMs must be between 100 and 120000 ms.");
        }
        if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 2) {
            throw new TypeError("AI maxRetries must be between 0 and 2.");
        }
        if (typeof fetchImpl !== "function") {
            throw new TypeError("This Node.js runtime must provide fetch().");
        }

        this.endpoint = `${parsedBaseUrl.toString().replace(/\/+$/, "")}/chat/completions`;
        this.apiKey = apiKey.trim();
        this.model = model.trim();
        this.timeoutMs = timeoutMs;
        this.maxRetries = maxRetries;
        this.fetch = fetchImpl;
    }

    async generate(messages, { signal: externalSignal } = {}) {
        if (!Array.isArray(messages) || messages.length < 1 ||
            messages.some(message =>
                !message ||
                !["system", "user", "assistant"].includes(message.role) ||
                typeof message.content !== "string"
            )) {
            throw new TypeError("AI messages must contain valid role/content entries.");
        }
        if (externalSignal && typeof externalSignal.addEventListener !== "function") {
            throw new TypeError("AI request signal must be an AbortSignal.");
        }

        const payload = {
            model: this.model,
            messages,
            max_tokens: MAX_RESPONSE_TOKENS,
            temperature: 0.7
        };

        for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
            if (externalSignal?.aborted) {
                throw new AIProviderError("cancelled", "AI provider request was cancelled.");
            }
            const controller = new AbortController();
            const abortFromExternal = () => controller.abort();
            externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
            const timer = setTimeout(() => controller.abort(), this.timeoutMs);
            let response;
            let result;

            try {
                response = await this.fetch(this.endpoint, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                        "Content-Type": "application/json",
                        Accept: "application/json"
                    },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });
                if (response.ok) {
                    try {
                        result = await response.json();
                    } catch (error) {
                        if (controller.signal.aborted || error?.name === "AbortError") {
                            if (externalSignal?.aborted) {
                                throw new AIProviderError("cancelled", "AI provider request was cancelled.");
                            }
                            throw new AIProviderError("timeout", "AI provider request timed out.");
                        }
                        throw new AIProviderError("invalid_response", "AI provider returned invalid JSON.");
                    }
                }
            } catch (error) {
                if (error instanceof AIProviderError) throw error;
                if (controller.signal.aborted || error?.name === "AbortError") {
                    if (externalSignal?.aborted) {
                        throw new AIProviderError("cancelled", "AI provider request was cancelled.");
                    }
                    throw new AIProviderError("timeout", "AI provider request timed out.");
                }
                if (attempt < this.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
                    continue;
                }
                throw new AIProviderError("unavailable", "AI provider could not be reached.");
            } finally {
                clearTimeout(timer);
                externalSignal?.removeEventListener("abort", abortFromExternal);
            }

            if (!response.ok) {
                const retryable = response.status === 429 || response.status >= 500;
                if (retryable && attempt < this.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
                    continue;
                }
                const code = response.status === 401 || response.status === 403
                    ? "authentication_failed"
                    : response.status === 429
                        ? "rate_limited"
                        : "provider_error";
                throw new AIProviderError(code, `AI provider returned HTTP ${response.status}.`);
            }

            const text = result?.choices?.[0]?.message?.content;
            if (typeof text !== "string" || !text.trim()) {
                throw new AIProviderError("invalid_response", "AI provider returned no response text.");
            }

            return {
                text: text.trim(),
                usage: result.usage && typeof result.usage === "object"
                    ? {
                        promptTokens: Number.isFinite(result.usage.prompt_tokens)
                            ? result.usage.prompt_tokens
                            : null,
                        completionTokens: Number.isFinite(result.usage.completion_tokens)
                            ? result.usage.completion_tokens
                            : null,
                        totalTokens: Number.isFinite(result.usage.total_tokens)
                            ? result.usage.total_tokens
                            : null
                    }
                    : null
            };
        }

        throw new AIProviderError("unavailable", "AI provider could not be reached.");
    }
}

function createAIProviderFromEnv(environment = process.env, options = {}) {
    const apiKey = environment.AI_API_KEY?.trim();
    const model = environment.AI_MODEL?.trim();
    if (!apiKey || !model) return null;

    return new OpenAICompatibleProvider({
        baseUrl: environment.AI_BASE_URL || DEFAULT_BASE_URL,
        apiKey,
        model,
        timeoutMs: parsePositiveInteger(environment.AI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
        ...options
    });
}

function parsePositiveInteger(value, fallback) {
    if (value === undefined || value === "") return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 100 || parsed > 120_000) {
        throw new TypeError("AI_TIMEOUT_MS must be between 100 and 120000.");
    }
    return parsed;
}

module.exports = {
    AIProviderError,
    OpenAICompatibleProvider,
    createAIProviderFromEnv
};
