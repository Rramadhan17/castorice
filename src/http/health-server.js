const http = require("node:http");

function parsePort(value = process.env.PORT) {
    if (value === undefined || value === "") return 3000;
    const port = Number(value);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new RangeError("PORT must be an integer between 0 and 65535.");
    }
    return port;
}

function createHealthServer({ getHealth } = {}) {
    const readHealth = typeof getHealth === "function"
        ? getHealth
        : () => ({ status: "starting", discord: "not_ready", uptime: process.uptime() });
    return http.createServer((request, response) => {
        let pathname;
        try {
            pathname = new URL(request.url, "http://localhost").pathname;
        } catch {
            pathname = "";
        }

        if (request.method === "GET" && pathname === "/health") {
            const health = readHealth();
            const statusCode = health.status === "ok" ? 200 : 503;
            response.writeHead(statusCode, {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store"
            });
            response.end(JSON.stringify(health));
            return;
        }

        response.writeHead(404, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        });
        response.end(JSON.stringify({ error: "not_found" }));
    });
}

function createRuntimeLifecycle({
    server,
    client,
    token,
    port = parsePort(),
    host = "0.0.0.0",
    cleanup = async () => {},
    logger = console,
    processRef = process
} = {}) {
    if (!server || typeof server.listen !== "function" ||
        typeof server.close !== "function" ||
        !client || typeof client.login !== "function" ||
        typeof client.destroy !== "function" ||
        typeof cleanup !== "function") {
        throw new TypeError("HTTP server and Discord client are required.");
    }
    if (typeof token !== "string" || !token) {
        throw new TypeError("Discord token is required.");
    }
    if (!Number.isInteger(port) || port < 0 || port > 65_535 ||
        typeof host !== "string" || !host) {
        throw new TypeError("HTTP listen address is invalid.");
    }

    let shutdownPromise = null;
    let started = false;
    let signalHandlers = null;
    let runtimeErrorHandler = null;

    function logError(label, error) {
        logger.error?.(label, {
            code: typeof error?.code === "string" ? error.code : null,
            name: typeof error?.name === "string" ? error.name : "Error"
        });
    }

    async function closeServer() {
        if (!server.listening) return;
        await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
            server.closeAllConnections?.();
        });
    }

    async function shutdown(signal = null) {
        if (shutdownPromise) return shutdownPromise;
        if (signalHandlers) {
            processRef.removeListener("SIGTERM", signalHandlers.sigterm);
            processRef.removeListener("SIGINT", signalHandlers.sigint);
            signalHandlers = null;
        }
        shutdownPromise = (async () => {
            if (signal) logger.info?.(`[Runtime] ${signal} received; shutting down.`);
            try {
                await closeServer();
            } catch (error) {
                logError("[HTTP Shutdown Error]", error);
                processRef.exitCode = 1;
            } finally {
                if (runtimeErrorHandler) {
                    server.removeListener("error", runtimeErrorHandler);
                    runtimeErrorHandler = null;
                }
            }
            try {
                await cleanup();
            } catch (error) {
                logError("[Runtime Cleanup Error]", error);
                processRef.exitCode = 1;
            }
            try {
                await client.destroy();
            } catch (error) {
                logError("[Discord Shutdown Error]", error);
                processRef.exitCode = 1;
            }
        })();
        return shutdownPromise;
    }

    async function start() {
        if (started) throw new Error("Runtime has already been started.");
        started = true;

        try {
            await new Promise((resolve, reject) => {
                const onListening = () => {
                    server.removeListener("error", onError);
                    const address = server.address();
                    if (address && typeof address !== "string") {
                        logger.info?.("[HTTP] Listening", {
                            address: host,
                            port: address.port
                        });
                    }
                    resolve();
                };
                const onError = error => {
                    server.removeListener("listening", onListening);
                    reject(error);
                };
                server.once("listening", onListening);
                server.once("error", onError);
                try {
                    server.listen(port, host);
                } catch (error) {
                    server.removeListener("listening", onListening);
                    server.removeListener("error", onError);
                    reject(error);
                }
            });
            runtimeErrorHandler = error => {
                logError("[HTTP Server Error]", error);
                processRef.exitCode = 1;
                void shutdown();
            };
            server.on("error", runtimeErrorHandler);

            signalHandlers = {
                sigterm: () => { void shutdown("SIGTERM"); },
                sigint: () => { void shutdown("SIGINT"); }
            };
            processRef.once("SIGTERM", signalHandlers.sigterm);
            processRef.once("SIGINT", signalHandlers.sigint);
            await client.login(token);
            if (shutdownPromise) return;
        } catch (error) {
            logError("[Runtime Startup Error]", error);
            processRef.exitCode = 1;
            await shutdown();
            throw error;
        }
    }

    return { start, shutdown };
}

module.exports = { createHealthServer, createRuntimeLifecycle, parsePort };
