class AIProviderError extends Error {
    constructor(code, message, { operation = null, statusCode = null } = {}) {
        super(message);
        this.name = "AIProviderError";
        this.code = code;
        if (operation) this.operation = operation;
        if (statusCode !== null) this.statusCode = statusCode;
    }
}

module.exports = { AIProviderError };
