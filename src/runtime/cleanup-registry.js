function createCleanupRegistry({ logger = console } = {}) {
    const cleanups = [];
    let cleanupPromise = null;

    function add(label, cleanup) {
        if (cleanupPromise) throw new Error("Runtime cleanup has already started.");
        if (typeof label !== "string" || !label || typeof cleanup !== "function") {
            throw new TypeError("A cleanup label and function are required.");
        }
        cleanups.push({ label, cleanup });
    }

    function run() {
        if (cleanupPromise) return cleanupPromise;
        cleanupPromise = (async () => {
            const errors = [];
            for (const { label, cleanup } of cleanups.reverse()) {
                try {
                    await cleanup();
                } catch (error) {
                    errors.push(error);
                    try {
                        logger.error?.(`[Runtime Cleanup Error] ${label}`, {
                            code: typeof error?.code === "string" ? error.code : null,
                            name: typeof error?.name === "string" ? error.name : "Error"
                        });
                    } catch (loggingError) {
                        errors.push(loggingError);
                    }
                }
            }
            if (errors.length) {
                throw new AggregateError(errors, "One or more runtime cleanups failed.");
            }
        })();
        return cleanupPromise;
    }

    return { add, run };
}

module.exports = { createCleanupRegistry };
