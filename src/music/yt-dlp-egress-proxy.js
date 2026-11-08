const dns = require("node:dns").promises;
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const {
    createPinnedLookup,
    normalizeHostname,
    parseExternalHttpUrl,
    resolvePublicAddresses
} = require("./url-security");

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CONNECTIONS = 24;
const MAX_REDIRECTS = 10;
const YT_DLP_EGRESS_BLOCKED_MESSAGE =
    "yt-dlp dinonaktifkan sampai isolasi egress tingkat proses/OS dapat diverifikasi.";

function assertYtDlpEgressIsolation() {
    throw new Error(YT_DLP_EGRESS_BLOCKED_MESSAGE);
}

function chooseAddress(addresses) {
    return addresses.find(record => record.family === 4) || addresses[0];
}

function safeErrorResponse(response, status, message) {
    if (response.destroyed || response.headersSent) {
        response.destroy();
        return;
    }
    response.writeHead(status, {
        "Content-Type": "text/plain; charset=utf-8",
        Connection: "close"
    });
    response.end(message);
}

function copyResponseHeaders(headers) {
    const result = {};
    for (const [name, value] of Object.entries(headers || {})) {
        if (![
            "connection",
            "keep-alive",
            "proxy-authenticate",
            "proxy-authorization",
            "proxy-connection",
            "te",
            "trailer",
            "transfer-encoding",
            "upgrade"
        ].includes(name.toLowerCase())) {
            result[name] = value;
        }
    }
    return result;
}

function parseConnectTarget(authority) {
    let url;
    try {
        url = new URL(`https://${authority}`);
    } catch {
        throw new Error("HTTPS proxy target is invalid.");
    }
    if (
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
    ) {
        throw new Error("HTTPS proxy target is invalid.");
    }

    const parsedUrl = parseExternalHttpUrl(url);
    const port = url.port ? Number(url.port) : 443;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("HTTPS proxy target port is invalid.");
    }
    return { url: parsedUrl, hostname: normalizeHostname(parsedUrl.hostname), port };
}

function createYtDlpEgressProxy({
    lookup = dns.lookup,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxConnections = DEFAULT_MAX_CONNECTIONS,
    logger = console,
    serverFactory = http.createServer,
    requestImpl,
    connectImpl = options => net.connect(options)
} = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
        throw new RangeError("yt-dlp proxy timeout must be between 100 and 60000 ms.");
    }
    if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 64) {
        throw new RangeError("yt-dlp proxy connection limit must be between 1 and 64.");
    }

    const activeSockets = new Set();
    const activeRequests = new Set();
    let closed = false;
    let closePromise = null;
    let clientCount = 0;

    async function resolveTarget(hostname) {
        return chooseAddress(await resolvePublicAddresses(hostname, lookup, timeoutMs));
    }

    async function proxyHttpRequest(clientRequest, clientResponse) {
        if (closed) {
            safeErrorResponse(clientResponse, 503, "Music network proxy is closed.");
            return;
        }

        let url;
        let target;
        try {
            url = parseExternalHttpUrl(clientRequest.url);
            if (url.protocol !== "http:") {
                throw new Error("Only HTTP proxy requests are accepted.");
            }
            target = await resolveTarget(url.hostname);
        } catch (error) {
            safeErrorResponse(clientResponse, 502, error.message);
            return;
        }
        if (closed || clientRequest.aborted || clientResponse.destroyed) return;

        const requestHasBody = Number(clientRequest.headers["content-length"]) > 0 ||
            clientRequest.headers["transfer-encoding"] !== undefined;
        const headers = { ...clientRequest.headers };
        for (const name of [
            "proxy-authorization",
            "proxy-connection",
            "connection",
            "keep-alive",
            "te",
            "trailer",
            "upgrade"
        ]) {
            delete headers[name];
        }
        const makeRequest = requestImpl || ((requestUrl, requestOptions, callback) =>
            (requestUrl.protocol === "https:" ? https : http).request(requestOptions, callback));

        let redirectCount = 0;
        const method = clientRequest.method;
        let currentUrl = url;
        let currentTarget = target;
        let outbound = null;
        let upstreamResponse = null;
        let aborted = false;
        let streamingResponse = false;
        const abortRequest = () => {
            aborted = true;
            outbound?.destroy();
            upstreamResponse?.destroy();
        };
        const removeRequestListeners = () => {
            clientRequest.removeListener("aborted", abortRequest);
            clientResponse.removeListener("close", abortOnResponseClose);
            clientResponse.removeListener("finish", removeRequestListeners);
        };
        const abortOnResponseClose = () => {
            if (!clientResponse.writableFinished) abortRequest();
            removeRequestListeners();
        };
        clientRequest.once("aborted", abortRequest);
        clientResponse.once("close", abortOnResponseClose);

        try {
            while (!closed && !aborted && !clientRequest.aborted && !clientResponse.destroyed) {
                const requestOptions = {
                    protocol: currentUrl.protocol,
                    hostname: currentUrl.hostname,
                    port: currentUrl.port || undefined,
                    path: `${currentUrl.pathname}${currentUrl.search}`,
                    method,
                    headers: { ...headers, host: currentUrl.host },
                    lookup: createPinnedLookup(currentUrl.hostname, currentTarget.address),
                    servername: net.isIP(normalizeHostname(currentUrl.hostname))
                        ? undefined
                        : currentUrl.hostname,
                    agent: false,
                    timeout: timeoutMs
                };
                let response;
                let requestSettled = false;
                try {
                    response = await new Promise((resolve, reject) => {
                        const currentOutbound = makeRequest(currentUrl, requestOptions, upstream => {
                            requestSettled = true;
                            resolve(upstream);
                        });
                        outbound = currentOutbound;
                        activeRequests.add(currentOutbound);
                        currentOutbound.setTimeout?.(
                            timeoutMs,
                            () => currentOutbound.destroy(new Error("Music upstream timed out."))
                        );
                        currentOutbound.once("error", error => {
                            logger?.error?.("[Music Egress Proxy Error]", error.message);
                            if (!requestSettled) {
                                requestSettled = true;
                                reject(error);
                            } else if (!clientResponse.destroyed) {
                                clientResponse.destroy();
                            }
                        });
                        currentOutbound.once("close", () => activeRequests.delete(currentOutbound));
                        if ((method === "GET" || method === "HEAD") && !requestHasBody) {
                            currentOutbound.end();
                        } else {
                            clientRequest.pipe(currentOutbound);
                        }
                    });
                } catch {
                    if (!aborted && !clientRequest.aborted && !clientResponse.destroyed) {
                        safeErrorResponse(clientResponse, 502, "Music upstream request failed.");
                    }
                    return;
                }

                if (closed || aborted || clientRequest.aborted || clientResponse.destroyed) {
                    response.destroy();
                    return;
                }

                const status = response.statusCode;
                const location = response.headers.location;
                if (![301, 302, 303, 307, 308].includes(status) || !location) {
                    upstreamResponse = response;
                    streamingResponse = true;
                    response.once("error", error => {
                        logger?.error?.("[Music Egress Proxy Error]", error.message);
                        if (!clientResponse.destroyed) clientResponse.destroy();
                    });
                    clientResponse.writeHead(
                        status || 502,
                        copyResponseHeaders(response.headers)
                    );
                    response.pipe(clientResponse);
                    clientResponse.once("finish", removeRequestListeners);
                    return;
                }

                let redirected;
                let redirectedTarget;
                try {
                    if (redirectCount >= MAX_REDIRECTS) {
                        throw new Error("Music redirect limit exceeded.");
                    }
                    redirected = parseExternalHttpUrl(new URL(location, currentUrl));
                    if (currentUrl.protocol === "https:" && redirected.protocol !== "https:") {
                        throw new Error("HTTPS downgrade redirects are not allowed.");
                    }
                    redirectedTarget = await resolveTarget(redirected.hostname);
                } catch (error) {
                    response.destroy();
                    safeErrorResponse(clientResponse, 502, error.message);
                    return;
                }
                if (closed || aborted || clientRequest.aborted || clientResponse.destroyed) {
                    response.destroy();
                    return;
                }

                if (requestHasBody || (method !== "GET" && method !== "HEAD")) {
                    response.destroy();
                    safeErrorResponse(
                        clientResponse,
                        502,
                        "Redirects with a request body are not supported."
                    );
                    return;
                }
                redirectCount += 1;
                response.destroy();
                outbound?.destroy();
                currentUrl = redirected;
                currentTarget = redirectedTarget;
            }
        } finally {
            if (!streamingResponse) removeRequestListeners();
        }
    }

    async function proxyConnect(request, clientSocket, head) {
        if (closed || activeSockets.size >= maxConnections) {
            clientSocket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
            return;
        }

        let target;
        let address;
        try {
            target = parseConnectTarget(request.url);
            address = await resolveTarget(target.hostname);
        } catch (error) {
            clientSocket.end(`HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n${error.message}`);
            return;
        }
        if (closed || clientSocket.destroyed) return;

        let remoteSocket;
        try {
            remoteSocket = connectImpl({
                host: address.address,
                family: address.family,
                port: target.port
            });
        } catch {
            clientSocket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
            return;
        }
        activeSockets.add(clientSocket);
        activeSockets.add(remoteSocket);

        let established = false;
        const connectTimer = setTimeout(() => {
            remoteSocket.destroy(new Error("HTTPS proxy connection timed out."));
        }, timeoutMs);
        connectTimer.unref?.();

        const fail = () => {
            clearTimeout(connectTimer);
            activeSockets.delete(clientSocket);
            activeSockets.delete(remoteSocket);
            if (!clientSocket.destroyed) {
                if (!established) {
                    clientSocket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
                } else {
                    clientSocket.destroy();
                }
            }
            if (!remoteSocket.destroyed) remoteSocket.destroy();
        };

        remoteSocket.once("connect", () => {
            established = true;
            clearTimeout(connectTimer);
            clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            if (head?.length) remoteSocket.write(head);
            const onIdleTimeout = () => {
                clientSocket.destroy(new Error("HTTPS proxy tunnel became idle."));
                remoteSocket.destroy();
            };
            clientSocket.setTimeout(timeoutMs * 6, onIdleTimeout);
            remoteSocket.setTimeout(timeoutMs * 6, onIdleTimeout);
            clientSocket.pipe(remoteSocket);
            remoteSocket.pipe(clientSocket);
        });
        remoteSocket.once("error", fail);
        clientSocket.once("error", fail);
        clientSocket.once("close", () => {
            activeSockets.delete(clientSocket);
            activeSockets.delete(remoteSocket);
            remoteSocket.destroy();
        });
        remoteSocket.once("close", () => {
            activeSockets.delete(clientSocket);
            activeSockets.delete(remoteSocket);
            if (!clientSocket.destroyed) clientSocket.end();
        });
    }

    const server = serverFactory((request, response) => {
        void proxyHttpRequest(request, response);
    });
    server.on("connection", socket => {
        clientCount += 1;
        socket.once("close", () => {
            clientCount = Math.max(0, clientCount - 1);
        });
        if (clientCount > maxConnections || closed) {
            socket.destroy();
            return;
        }
    });
    server.on("connect", (request, socket, head) => {
        void proxyConnect(request, socket, head);
    });
    server.on("clientError", (_error, socket) => {
        socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    });

    return new Promise((resolve, reject) => {
        const onError = error => {
            server.removeListener("listening", onListening);
            reject(error);
        };
        const onListening = () => {
            server.removeListener("error", onError);
            const address = server.address();
            if (!address || typeof address === "string") {
                server.close();
                reject(new Error("Music egress proxy failed to bind loopback."));
                return;
            }
            resolve({
                url: `http://127.0.0.1:${address.port}`,
                maxRedirects: MAX_REDIRECTS,
                async close() {
                    if (closePromise) return closePromise;
                    closed = true;
                    for (const request of activeRequests) request.destroy();
                    for (const socket of activeSockets) socket.destroy();
                    closePromise = new Promise((closeResolve, closeReject) => {
                        server.close(error => error ? closeReject(error) : closeResolve());
                        server.closeAllConnections?.();
                    });
                    await closePromise;
                }
            });
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(0, "127.0.0.1");
    });
}

async function spawnSecuredYtDlp(_binary, _args, _options = {}) {
    assertYtDlpEgressIsolation();
}

module.exports = {
    createYtDlpEgressProxy,
    spawnSecuredYtDlp,
    assertYtDlpEgressIsolation,
    YT_DLP_EGRESS_BLOCKED_MESSAGE,
    DEFAULT_MAX_CONNECTIONS,
    DEFAULT_TIMEOUT_MS,
    MAX_REDIRECTS
};
