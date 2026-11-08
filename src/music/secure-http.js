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

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function createSecureFetch({
    lookup = dns.lookup,
    requestImpl,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = MAX_RESPONSE_BYTES
} = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
        throw new RangeError("Secure HTTP timeout must be between 1 and 60000 ms.");
    }
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 10 * 1024 * 1024) {
        throw new RangeError("Secure HTTP response limit is invalid.");
    }

    return async function secureFetch(value, options = {}) {
        const url = parseExternalHttpUrl(value);
        const method = String(options.method || "GET").toUpperCase();
        if (method !== "GET") throw new Error("Secure HTTP client only permits GET requests.");
        if (options.redirect && options.redirect !== "error") {
            throw new Error("Secure HTTP client does not follow redirects.");
        }

        const controller = new AbortController();
        const signal = options.signal;
        const abort = () => controller.abort(signal?.reason);
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });

        const timer = setTimeout(() => controller.abort(new Error("Secure HTTP request timed out.")), timeoutMs);
        let request;
        try {
            if (controller.signal.aborted) {
                throw new Error("Secure HTTP request was cancelled.");
            }

            const addresses = await resolvePublicAddresses(url.hostname, lookup, timeoutMs);
            if (controller.signal.aborted) {
                throw new Error("Secure HTTP request was cancelled.");
            }
            const target = addresses.find(record => record.family === 4) || addresses[0];
            const requestOptions = {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || undefined,
                path: `${url.pathname}${url.search}`,
                method,
                headers: options.headers || {},
                lookup: createPinnedLookup(url.hostname, target.address),
                servername: net.isIP(normalizeHostname(url.hostname)) ? undefined : url.hostname,
                agent: false,
                timeout: timeoutMs
            };
            const makeRequest = requestImpl || ((requestUrl, requestConfig, callback) =>
                (requestUrl.protocol === "https:" ? https : http).request(requestConfig, callback));

            const body = await new Promise((resolve, reject) => {
                let settled = false;
                const finish = (error, value) => {
                    if (settled) return;
                    settled = true;
                    controller.signal.removeEventListener("abort", onAbort);
                    if (error) reject(error);
                    else resolve(value);
                };
                const onAbort = () => {
                    request?.destroy();
                    finish(new Error("Secure HTTP request timed out or was cancelled."));
                };

                try {
                    request = makeRequest(url, requestOptions, response => {
                        const chunks = [];
                        let size = 0;
                        response.on("data", chunk => {
                            size += chunk.length;
                            if (size > maxResponseBytes) {
                                request.destroy(new Error("Secure HTTP response exceeded its size limit."));
                                return;
                            }
                            chunks.push(chunk);
                        });
                        response.once("error", error => finish(error));
                        response.once("end", () => {
                            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                                finish(new Error("Secure HTTP redirects are not allowed."));
                                return;
                            }
                            finish(null, {
                                status: response.statusCode || 0,
                                ok: response.statusCode >= 200 && response.statusCode < 300,
                                async json() {
                                    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
                                }
                            });
                        });
                    });
                    request.setTimeout?.(timeoutMs, () => request.destroy(new Error("Secure HTTP request timed out.")));
                    request.once("error", error => finish(error));
                    controller.signal.addEventListener("abort", onAbort, { once: true });
                    request.end();
                } catch (error) {
                    finish(error);
                }
            });
            return body;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
        }
    };
}

module.exports = { createSecureFetch, DEFAULT_TIMEOUT_MS, MAX_RESPONSE_BYTES };
