const dns = require("node:dns").promises;
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const { randomUUID } = require("node:crypto");
const {
    createPinnedLookup,
    isPublicIp,
    normalizeHostname,
    parseExternalHttpUrl,
    resolvePublicAddresses
} = require("./url-security");

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 4;
const MAX_CLIENTS = 2;

function isPublicIpv4(address) {
    return net.isIP(address) === 4 && isPublicIp(address);
}

function parseRadioUrl(value) {
    const url = parseExternalHttpUrl(value);
    const host = normalizeHostname(url.hostname);
    if (net.isIP(host) === 6) {
        throw new Error("Radio streams require a public IPv4 hostname or address.");
    }
    return url;
}

async function resolvePublicIpv4(url, lookup = dns.lookup, timeoutMs = DEFAULT_TIMEOUT_MS) {
    let addresses;
    try {
        addresses = await resolvePublicAddresses(url.hostname, lookup, timeoutMs);
    } catch (error) {
        if (error.message === "DNS lookup timed out.") {
            throw new Error("Radio stream DNS lookup timed out.");
        }
        if (/cannot be resolved|could not be resolved|resolve/i.test(error.message)) {
            throw new Error("Radio stream hostname could not be resolved.");
        }
        throw new Error("Radio stream hostname resolved to a private or reserved address.");
    }
    const ipv4 = addresses.find(record => record.family === 4);
    if (!ipv4) {
        throw new Error("Radio stream hostname has no public IPv4 address.");
    }
    return ipv4.address;
}

function createRadioStreamProxy({
    sourceUrl,
    lookup = dns.lookup,
    requestImpl,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = MAX_REDIRECTS,
    maxClients = MAX_CLIENTS,
    logger = console,
    serverFactory = http.createServer
} = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
        throw new RangeError("Radio stream timeout must be between 100 and 60000 ms.");
    }
    if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) {
        throw new RangeError("Radio stream redirect limit must be between 0 and 10.");
    }
    if (!Number.isInteger(maxClients) || maxClients < 1 || maxClients > 4) {
        throw new RangeError("Radio stream client limit must be between 1 and 4.");
    }

    const initialUrl = parseRadioUrl(sourceUrl);
    const activeRequests = new Set();
    const activeResponses = new Set();
    const activeClients = new Set();
    const token = randomUUID();
    const requestRemote = requestImpl || ((url, options, callback) =>
        (url.protocol === "https:" ? https : http).request(options, callback));
    let closed = false;
    let closePromise = null;
    let initialAddress;
    const initialAddressPromise = resolvePublicIpv4(initialUrl, lookup, timeoutMs);

    async function openRemote(url, pinnedAddress, rangeHeader, redirectsRemaining, clientResponse) {
        let address = pinnedAddress;
        if (!address) address = await resolvePublicIpv4(url, lookup, timeoutMs);
        if (!isPublicIpv4(address)) throw new Error("Radio stream target is not a public IPv4 address.");

        const requestOptions = {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || undefined,
            path: `${url.pathname}${url.search}`,
            method: "GET",
            headers: {
                Accept: "audio/*, application/octet-stream, */*;q=0.1",
                "User-Agent": "Castorice Radio Stream Proxy",
                ...(rangeHeader && /^bytes=\d{0,16}-\d{0,16}$/.test(rangeHeader)
                    ? { Range: rangeHeader }
                    : {})
            },
            lookup: createPinnedLookup(url.hostname, address),
            servername: net.isIP(url.hostname) ? undefined : url.hostname,
            agent: false
        };

        const response = await new Promise((resolve, reject) => {
            let settled = false;
            let connectionTimer;
            const request = requestRemote(url, requestOptions, incoming => {
                clearTimeout(connectionTimer);
                if (!settled) {
                    settled = true;
                    resolve({ request, response: incoming });
                }
            });
            activeRequests.add(request);
            connectionTimer = setTimeout(() => {
                request.destroy(new Error("Radio stream request timed out."));
            }, timeoutMs);
            connectionTimer.unref?.();
            request.setTimeout(timeoutMs, () => request.destroy(new Error("Radio stream request timed out.")));
            request.once("error", error => {
                clearTimeout(connectionTimer);
                activeRequests.delete(request);
                if (!settled) {
                    settled = true;
                    reject(new Error(error.message === "Radio stream request timed out."
                        ? "Radio stream request timed out."
                        : "Radio stream connection failed."));
                }
            });
            request.once("close", () => {
                clearTimeout(connectionTimer);
                activeRequests.delete(request);
            });
            request.end();
        });

        const { request, response: incoming } = response;
        activeResponses.add(incoming);
        incoming.once("close", () => activeResponses.delete(incoming));
        incoming.once("error", error => {
            logger?.error?.("[Radio Stream Proxy Error]", error);
            if (!clientResponse.destroyed) clientResponse.destroy();
        });
        incoming.setTimeout(timeoutMs, () => incoming.destroy(new Error("Radio stream became idle.")));

        const status = incoming.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
            const location = incoming.headers.location;
            incoming.resume();
            if (!location || redirectsRemaining <= 0) {
                request.destroy();
                throw new Error("Radio stream redirect limit exceeded or location is missing.");
            }
            let redirected;
            try {
                redirected = parseRadioUrl(new URL(location, url).toString());
            } catch (error) {
                request.destroy();
                incoming.destroy();
                throw error;
            }
            if (url.protocol === "https:" && redirected.protocol !== "https:") {
                request.destroy();
                incoming.destroy();
                throw new Error("Radio stream HTTPS downgrade redirect is not allowed.");
            }
            let targetAddress;
            try {
                targetAddress = await resolvePublicIpv4(redirected, lookup, timeoutMs);
            } catch (error) {
                request.destroy();
                incoming.destroy();
                throw error;
            }
            return openRemote(redirected, targetAddress, rangeHeader, redirectsRemaining - 1, clientResponse);
        }
        if (status !== 200 && status !== 206) {
            incoming.resume();
            throw new Error(`Radio stream server returned HTTP ${status || "unknown"}.`);
        }
        return { request, response: incoming };
    }

    const server = serverFactory((clientRequest, clientResponse) => {
        if (closed) {
            clientResponse.writeHead(503).end();
            return;
        }
        if (
            clientRequest.method !== "GET" ||
            clientRequest.url !== `/${token}` ||
            activeClients.size >= maxClients
        ) {
            clientResponse.writeHead(clientRequest.url === `/${token}` ? 429 : 404).end();
            return;
        }

        activeClients.add(clientResponse);
        const onClientClose = () => {
            activeClients.delete(clientResponse);
        };
        clientResponse.once("close", onClientClose);
        (async () => {
            await initialAddressPromise;
            if (closed || clientResponse.destroyed) return;
            const { response } = await openRemote(
                initialUrl,
                initialAddress,
                clientRequest.headers.range,
                maxRedirects,
                clientResponse
            );
            if (closed || clientResponse.destroyed) {
                response.destroy();
                return;
            }
            const headers = {
                "Content-Type": response.headers["content-type"] || "application/octet-stream",
                "Cache-Control": "no-store",
                Connection: "close"
            };
            if (response.headers["content-length"]) headers["Content-Length"] = response.headers["content-length"];
            if (response.headers["content-range"]) headers["Content-Range"] = response.headers["content-range"];
            clientResponse.writeHead(response.statusCode, headers);
            clientResponse.flushHeaders();
            response.pipe(clientResponse);
            clientResponse.once("close", () => {
                if (!clientResponse.writableFinished) response.destroy();
            });
        })().catch(error => {
            logger?.error?.("[Radio Stream Proxy Error]", error);
            if (!clientResponse.destroyed && !clientResponse.headersSent) {
                clientResponse.writeHead(502, { Connection: "close" }).end("Radio stream unavailable.");
            } else if (!clientResponse.destroyed) {
                clientResponse.destroy();
            }
        });
    });

    return (async () => {
        initialAddress = await initialAddressPromise;
        if (closed) throw new Error("Radio stream proxy closed during validation.");
        await new Promise((resolve, reject) => {
            const onError = error => {
                server.removeListener("listening", onListening);
                reject(error);
            };
            const onListening = () => {
                server.removeListener("error", onError);
                resolve();
            };
            server.once("error", onError);
            server.once("listening", onListening);
            server.listen(0, "127.0.0.1");
        });
        const address = server.address();
        if (!address || typeof address === "string") {
            server.close();
            throw new Error("Radio stream proxy failed to bind loopback.");
        }

        return {
            url: `http://127.0.0.1:${address.port}/${token}`,
            sourceUrl: initialUrl.toString(),
            validatedAddress: initialAddress,
            async close() {
                if (closePromise) return closePromise;
                closed = true;
                for (const request of activeRequests) request.destroy();
                for (const response of activeResponses) response.destroy();
                for (const response of activeClients) response.destroy();
                closePromise = new Promise((resolve, reject) => {
                    server.close(error => error ? reject(error) : resolve());
                    server.closeAllConnections?.();
                });
                await closePromise;
            }
        };
    })();
}

module.exports = {
    createRadioStreamProxy,
    isPublicIpv4,
    parseRadioUrl,
    resolvePublicIpv4,
    DEFAULT_TIMEOUT_MS,
    MAX_REDIRECTS
};
