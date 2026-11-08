const { AIProviderError } = require("./provider-error");

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 1;
const MAX_RESPONSE_TOKENS = 800;
const MODEL_CACHE_MS = 5 * 60_000;
const MAX_DISCOVERED_MODELS = 3;
const OPENAI_CHAT_MODEL_PREFIX = /^(?:gpt-|chatgpt-|o[134](?:-|$))/i;
const OPENAI_MODEL_EXCLUSIONS = /(?:embedding|moderation|whisper|tts|transcri|audio|realtime|image|dall-e)/i;

class OpenAICompatibleProvider {
    constructor({
        baseUrl = DEFAULT_BASE_URL,
        apiKey,
        model = null,
        modelDiscovery = null,
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
        if (model !== null && (typeof model !== "string" || !model.trim() || model.length > 128)) {
            throw new TypeError("AI model must be null or a non-empty string of at most 128 characters.");
        }
        if (modelDiscovery !== null && !["openai", "openrouter"].includes(modelDiscovery)) {
            throw new TypeError("AI modelDiscovery must be openai, openrouter, or null.");
        }
        if (!model && !modelDiscovery) {
            throw new TypeError("AI model or model discovery must be configured.");
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
        this.model = model?.trim() || null;
        this.modelDiscovery = modelDiscovery;
        this.selectedModel = this.model;
        this.timeoutMs = timeoutMs;
        this.maxRetries = maxRetries;
        this.fetch = fetchImpl;
        this.discoveredModels = null;
        this.discoveredAt = 0;
        this.discoveryRequest = null;
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

        let models = this.modelDiscovery
            ? await this.discoverModels(externalSignal)
            : [this.model];
        if (this.selectedModel && models.includes(this.selectedModel)) {
            models = [this.selectedModel, ...models.filter(model => model !== this.selectedModel)];
        }
        let lastError;
        for (const model of models) {
            this.model = model;
            try {
                const result = await this.generateWithModel(messages, externalSignal);
                this.selectedModel = model;
                return result;
            } catch (error) {
                lastError = error;
                if (!this.modelDiscovery || error?.code !== "model_not_compatible") throw error;
            }
        }
        throw lastError || new AIProviderError("model_unavailable", "No compatible chat model was discovered.");
    }

    async discoverModels(externalSignal) {
        if (this.discoveredModels && Date.now() - this.discoveredAt < MODEL_CACHE_MS) {
            return this.discoveredModels;
        }
        if (this.discoveryRequest) return this.discoveryRequest;

        this.discoveryRequest = this.fetchModelCatalog(externalSignal)
            .then(models => {
                this.discoveredModels = models;
                this.discoveredAt = Date.now();
                return models;
            })
            .finally(() => {
                this.discoveryRequest = null;
            });
        return this.discoveryRequest;
    }

    async fetchModelCatalog(externalSignal) {
        const controller = new AbortController();
        const abortFromExternal = () => controller.abort();
        externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let response;
        let result;
        try {
            const modelsUrl = `${this.endpoint.slice(0, -"/chat/completions".length)}/models`;
            response = await this.fetch(modelsUrl, {
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    Accept: "application/json"
                },
                signal: controller.signal
            });
            if (response.ok) result = await response.json();
        } catch (error) {
            if (externalSignal?.aborted) {
                throw new AIProviderError("cancelled", "AI provider request was cancelled.", {
                    operation: "model_discovery"
                });
            }
            if (controller.signal.aborted || error?.name === "AbortError") {
                throw new AIProviderError("timeout", "AI provider model discovery timed out.", {
                    operation: "model_discovery"
                });
            }
            throw new AIProviderError("unavailable", "AI provider model discovery failed.", {
                operation: "model_discovery"
            });
        } finally {
            clearTimeout(timer);
            externalSignal?.removeEventListener("abort", abortFromExternal);
        }
        if (!response.ok) {
            const errorDetails = await readErrorDetails(response);
            const code = classifyProviderError(response.status, errorDetails, true);
            throw new AIProviderError(code, `AI provider model discovery returned HTTP ${response.status}.`, {
                operation: "model_discovery",
                statusCode: response.status
            });
        }
        if (!Array.isArray(result?.data)) {
            throw new AIProviderError("invalid_response", "AI provider returned an invalid model catalogue.", {
                operation: "model_discovery"
            });
        }

        let models;
        if (this.modelDiscovery === "openrouter") {
            models = result.data
                .filter(model =>
                    typeof model?.id === "string" &&
                    model.endpoints?.includes?.("/api/v1/chat/completions") &&
                    model.architecture?.input_modalities?.includes?.("text") &&
                    model.architecture?.output_modalities?.includes?.("text") &&
                    model.supported_parameters?.includes?.("max_tokens") &&
                    model.supported_parameters?.includes?.("temperature")
                )
                .map(model => model.id);
        } else {
            models = result.data
                .filter(model =>
                    typeof model?.id === "string" &&
                    OPENAI_CHAT_MODEL_PREFIX.test(model.id) &&
                    !OPENAI_MODEL_EXCLUSIONS.test(model.id)
                )
                .map(model => model.id);
        }
        models = [...new Set(models)].slice(0, MAX_DISCOVERED_MODELS);
        if (models.length === 0) {
            throw new AIProviderError(
                "model_unavailable",
                "The provider catalogue did not expose a compatible chat model.",
                { operation: "model_discovery" }
            );
        }
        return models;
    }

    async generateWithModel(messages, externalSignal) {
        const reasoningModel = /^o[134](?:-|$)/i.test(this.model);
        const payload = reasoningModel
            ? {
                model: this.model,
                messages: messages.map(message => message.role === "system"
                    ? { ...message, role: "developer" }
                    : message),
                max_completion_tokens: MAX_RESPONSE_TOKENS
            }
            : {
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
                        throw new AIProviderError("invalid_response", "AI provider returned invalid JSON.", {
                            operation: "generate"
                        });
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
                const errorDetails = await readErrorDetails(response);
                const code = classifyProviderError(response.status, errorDetails);
                const retryable = code === "rate_limited" || code === "provider_unavailable";
                if (retryable && attempt < this.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
                    continue;
                }
                throw new AIProviderError(code, `AI provider returned HTTP ${response.status}.`, {
                    operation: "generate",
                    statusCode: response.status
                });
            }

            const text = result?.choices?.[0]?.message?.content;
            if (typeof text !== "string" || !text.trim()) {
                throw new AIProviderError("invalid_response", "AI provider returned no response text.", {
                    operation: "generate"
                });
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

async function readErrorDetails(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

function classifyProviderError(status, details, isDiscovery = false) {
    const error = details?.error || details || {};
    const identifiers = [error.code, error.type, error.status, error.message]
        .filter(value => typeof value === "string")
        .join(" ")
        .toLowerCase();

    if (/invalid[_ -]?api[_ -]?key|api[_ -]?key[_ -]?invalid/.test(identifiers)) {
        return "invalid_api_key";
    }
    if (status === 401 || status === 403) return "authentication_failed";
    if (status === 402 ||
        /quota|insufficient[_ -]?credit|billing|resource[_ -]?exhausted/.test(identifiers)) {
        return "quota_exceeded";
    }
    if (status === 429) return "rate_limited";
    if (/model[_ -]?(?:not[_ -]?(?:found|supported|available)|invalid)|unsupported[_ -]?model/.test(identifiers)) {
        return "model_not_compatible";
    }
    if (status === 404) return isDiscovery ? "model_discovery_failed" : "model_not_compatible";
    if (status >= 500) return "provider_unavailable";
    if (status === 400 || status === 422) return "provider_error";
    return isDiscovery ? "model_discovery_failed" : "provider_error";
}

function createAIProviderFromEnv(environment = process.env, options = {}) {
    const apiKey = environment.AI_API_KEY?.trim();
    const model = environment.AI_MODEL?.trim();
    if (!apiKey) return null;

    return new OpenAICompatibleProvider({
        baseUrl: environment.AI_BASE_URL || DEFAULT_BASE_URL,
        apiKey,
        model: model || null,
        modelDiscovery: model ? null : "openai",
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
