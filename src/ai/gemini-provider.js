const { AIProviderError } = require("./provider-error");

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_TOKENS = 800;
const MAX_RETRIES = 1;
const MODEL_CACHE_MS = 5 * 60_000;
const MAX_MODEL_PAGES = 3;
const MAX_DISCOVERED_MODELS = 3;

class GeminiProvider {
    constructor({
        apiKey,
        model = null,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        fetchImpl = globalThis.fetch
    } = {}) {
        if (typeof apiKey !== "string" || !apiKey.trim()) {
            throw new TypeError("Gemini apiKey must be configured.");
        }
        if (model !== null && (typeof model !== "string" ||
            !/^[A-Za-z0-9._-]{1,128}$/.test(model.trim()))) {
            throw new TypeError("Gemini model must be null or a valid model identifier.");
        }
        if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
            throw new TypeError("Gemini timeoutMs must be between 100 and 120000 ms.");
        }
        if (typeof fetchImpl !== "function") {
            throw new TypeError("This Node.js runtime must provide fetch().");
        }

        this.endpoint = null;
        this.apiKey = apiKey.trim();
        this.model = model?.trim() || null;
        this.modelDiscovery = !this.model;
        this.selectedModel = this.model;
        this.timeoutMs = timeoutMs;
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
            this.endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
            try {
                const result = await this.generateWithModel(messages, externalSignal);
                this.selectedModel = model;
                return result;
            } catch (error) {
                lastError = error;
                if (!this.modelDiscovery || error?.code !== "model_not_compatible") throw error;
            }
        }
        throw lastError || new AIProviderError("model_unavailable", "No Gemini generation model was discovered.");
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
        const models = [];
        let pageToken = null;
        for (let page = 0; page < MAX_MODEL_PAGES; page += 1) {
            if (externalSignal?.aborted) {
                throw new AIProviderError("cancelled", "AI provider request was cancelled.", {
                    operation: "model_discovery"
                });
            }
            const controller = new AbortController();
            const abortFromExternal = () => controller.abort();
            externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
            const timer = setTimeout(() => controller.abort(), this.timeoutMs);
            let response;
            let result;
            try {
                const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
                url.searchParams.set("pageSize", "100");
                if (pageToken) url.searchParams.set("pageToken", pageToken);
                response = await this.fetch(url, {
                    headers: { "x-goog-api-key": this.apiKey, Accept: "application/json" },
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
                    throw new AIProviderError("timeout", "Gemini model discovery timed out.", {
                        operation: "model_discovery"
                    });
                }
                throw new AIProviderError("unavailable", "Gemini model discovery failed.", {
                    operation: "model_discovery"
                });
            } finally {
                clearTimeout(timer);
                externalSignal?.removeEventListener("abort", abortFromExternal);
            }
            if (!response.ok) {
                const errorDetails = await readErrorDetails(response);
                const code = classifyGeminiError(response.status, errorDetails, true);
                throw new AIProviderError(code, `Gemini model discovery returned HTTP ${response.status}.`, {
                    operation: "model_discovery",
                    statusCode: response.status
                });
            }
            if (!Array.isArray(result?.models)) {
                throw new AIProviderError("invalid_response", "Gemini returned an invalid model catalogue.", {
                    operation: "model_discovery"
                });
            }
            for (const model of result.models) {
                const identifier = typeof model?.baseModelId === "string"
                    ? model.baseModelId
                    : typeof model?.name === "string"
                        ? model.name.replace(/^models\//, "")
                        : "";
                if (
                    model?.supportedGenerationMethods?.includes?.("generateContent") &&
                    /^[A-Za-z0-9._-]{1,128}$/.test(identifier)
                ) {
                    models.push(identifier);
                }
            }
            pageToken = typeof result.nextPageToken === "string" && result.nextPageToken
                ? result.nextPageToken
                : null;
            if (!pageToken) break;
        }
        const uniqueModels = [...new Set(models)].slice(0, MAX_DISCOVERED_MODELS);
        if (uniqueModels.length === 0) {
            throw new AIProviderError(
                "model_unavailable",
                "Gemini catalogue did not expose a generateContent-compatible model.",
                { operation: "model_discovery" }
            );
        }
        return uniqueModels;
    }

    async generateWithModel(messages, externalSignal) {
        const systemText = messages
            .filter(message => message.role === "system")
            .map(message => message.content)
            .join("\n");
        const contents = messages
            .filter(message => message.role !== "system")
            .map(message => ({
                role: message.role === "assistant" ? "model" : "user",
                parts: [{ text: message.content }]
            }));
        if (contents.length === 0) {
            throw new TypeError("AI messages must include user or assistant content.");
        }
        const payload = {
            contents,
            generationConfig: { maxOutputTokens: MAX_RESPONSE_TOKENS, temperature: 0.7 },
            ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {})
        };

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
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
                        "x-goog-api-key": this.apiKey,
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
                if (attempt < MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                    continue;
                }
                throw new AIProviderError("unavailable", "AI provider could not be reached.");
            } finally {
                clearTimeout(timer);
                externalSignal?.removeEventListener("abort", abortFromExternal);
            }

            if (!response.ok) {
                const errorDetails = await readErrorDetails(response);
                const code = classifyGeminiError(response.status, errorDetails);
                const retryable = code === "rate_limited" || code === "provider_unavailable";
                if (retryable && attempt < MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                    continue;
                }
                throw new AIProviderError(code, `AI provider returned HTTP ${response.status}.`, {
                    operation: "generate",
                    statusCode: response.status
                });
            }

            const parts = result?.candidates?.[0]?.content?.parts;
            const text = Array.isArray(parts)
                ? parts.map(part => part?.text).filter(value => typeof value === "string").join("")
                : "";
            if (!text.trim()) {
                throw new AIProviderError("invalid_response", "AI provider returned no response text.", {
                    operation: "generate"
                });
            }

            const usageMetadata = result.usageMetadata;
            return {
                text: text.trim(),
                usage: usageMetadata && typeof usageMetadata === "object"
                    ? {
                        promptTokens: Number.isFinite(usageMetadata.promptTokenCount)
                            ? usageMetadata.promptTokenCount
                            : null,
                        completionTokens: Number.isFinite(usageMetadata.candidatesTokenCount)
                            ? usageMetadata.candidatesTokenCount
                            : null,
                        totalTokens: Number.isFinite(usageMetadata.totalTokenCount)
                            ? usageMetadata.totalTokenCount
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

function classifyGeminiError(status, details, isDiscovery = false) {
    const error = details?.error || details || {};
    const identifiers = [error.status, error.code, error.message]
        .filter(value => typeof value === "string")
        .join(" ")
        .toLowerCase();

    if (/invalid[_ -]?api[_ -]?key|api[_ -]?key[_ -]?invalid/.test(identifiers)) {
        return "invalid_api_key";
    }
    if (status === 401 || status === 403) return "authentication_failed";
    if (status === 402 ||
        /quota|billing|insufficient[_ -]?credit/.test(identifiers) ||
        (status !== 429 && /resource[_ -]?exhausted/.test(identifiers))) {
        return "quota_exceeded";
    }
    if (status === 429) return "rate_limited";
    if (/model[_ -]?(?:not[_ -]?(?:found|supported|available)|invalid)|unsupported[_ -]?model/.test(identifiers)) {
        return "model_not_compatible";
    }
    if (status === 400) return "request_error";
    if (status === 404) return isDiscovery ? "model_discovery_failed" : "model_not_compatible";
    if (status >= 500) return "provider_unavailable";
    return isDiscovery ? "model_discovery_failed" : "provider_error";
}

module.exports = { GeminiProvider };
