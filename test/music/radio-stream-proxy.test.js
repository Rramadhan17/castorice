const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const http = require("node:http");
const {
    createRadioStreamProxy,
    isPublicIpv4,
    parseRadioUrl,
    resolvePublicIpv4
} = require("../../src/music/radio-stream-proxy");

function fakeRequestFactory(responses, captured = []) {
    return (url, options, callback) => {
        const request = new EventEmitter();
        request.setTimeout = () => {};
        request.destroy = error => {
            if (error) request.emit("error", error);
            request.emit("close");
        };
        request.end = () => {
            captured.push({ url, options });
            const response = responses.shift();
            if (!response) {
                request.emit("error", new Error("no fake response"));
                return;
            }
            const incoming = new PassThrough();
            incoming.statusCode = response.statusCode || 200;
            incoming.headers = response.headers || { "content-type": "audio/mpeg" };
            incoming.setTimeout = () => {};
            process.nextTick(() => {
                callback(incoming);
                if (response.body) incoming.end(response.body);
                else incoming.end();
            });
        };
        return request;
    };
}

function loopbackGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, response => {
            const chunks = [];
            response.on("data", chunk => chunks.push(chunk));
            response.on("end", () => resolve({
                statusCode: response.statusCode,
                body: Buffer.concat(chunks).toString()
            }));
        }).on("error", reject);
    });
}

test("Radio URL validator rejects unsafe protocols, credentials, local and private hosts", () => {
    assert.equal(parseRadioUrl("https://radio.example/live").hostname, "radio.example");
    for (const url of [
        "file:///etc/passwd",
        "ftp://radio.example/live",
        "https://user:pass@radio.example/live",
        "http://localhost/live",
        "http://host.internal/live",
        "http://127.0.0.1/live",
        "http://169.254.169.254/latest",
        "http://[::1]/live"
    ]) {
        assert.throws(() => parseRadioUrl(url), undefined, url);
    }
    assert.equal(isPublicIpv4("93.184.216.34"), true);
    assert.equal(isPublicIpv4("10.0.0.1"), false);
    assert.equal(isPublicIpv4("100.64.1.1"), false);
    assert.equal(isPublicIpv4("192.0.2.1"), false);
    assert.equal(isPublicIpv4("224.0.0.1"), false);
});

test("Radio DNS resolution rejects private answers and has a timeout", async () => {
    const url = parseRadioUrl("https://radio.example/live");
    await assert.rejects(
        resolvePublicIpv4(url, async () => [
            { address: "93.184.216.34" },
            { address: "127.0.0.1" }
        ]),
        /private or reserved/
    );
    await assert.rejects(
        resolvePublicIpv4(url, () => new Promise(() => {}), 100),
        /DNS lookup timed out/
    );
});

test("Radio proxy pins DNS before opening FFmpeg loopback URL and relays audio", async t => {
    const calls = [];
    const proxy = await createRadioStreamProxy({
        sourceUrl: "https://radio.example/live",
        lookup: async host => {
            assert.equal(host, "radio.example");
            return [{ address: "93.184.216.34" }];
        },
        requestImpl: fakeRequestFactory([{ body: "radio-audio" }], calls)
    });
    t.after(() => proxy.close());

    assert.match(proxy.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+$/i);
    assert.equal(proxy.validatedAddress, "93.184.216.34");
    const result = await loopbackGet(proxy.url);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body, "radio-audio");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.lookup("radio.example", {}, (error, address) => {
        assert.ifError(error);
        assert.equal(address, "93.184.216.34");
    }), undefined);
});

test("Radio proxy validates every redirect target and refuses private redirects", async t => {
    const calls = [];
    const proxy = await createRadioStreamProxy({
        sourceUrl: "http://radio.example/live",
        lookup: async host => [{ address: host === "radio.example" ? "93.184.216.34" : "10.0.0.1" }],
        requestImpl: fakeRequestFactory([{
            statusCode: 302,
            headers: { location: "http://private.example/admin" }
        }], calls)
    });
    t.after(() => proxy.close());

    const result = await loopbackGet(proxy.url);
    assert.equal(result.statusCode, 502);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.hostname, "radio.example");
});

test("Radio proxy re-resolves and pins each public redirect hop", async t => {
    const calls = [];
    const proxy = await createRadioStreamProxy({
        sourceUrl: "https://radio.example/live",
        lookup: async host => [{
            address: host === "radio.example" ? "93.184.216.34" : "1.1.1.1"
        }],
        requestImpl: fakeRequestFactory([
            { statusCode: 302, headers: { location: "https://cdn.example/stream" } },
            { body: "redirected-audio" }
        ], calls)
    });
    t.after(() => proxy.close());

    const result = await loopbackGet(proxy.url);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body, "redirected-audio");
    assert.deepEqual(calls.map(call => call.options.lookup === undefined), [false, false]);
    assert.equal(calls[0].url.hostname, "radio.example");
    assert.equal(calls[1].url.hostname, "cdn.example");
    for (const call of calls) {
        call.options.lookup(call.url.hostname, {}, (error, address) => {
            assert.ifError(error);
            assert.equal(address, call.url.hostname === "radio.example" ? "93.184.216.34" : "1.1.1.1");
        });
    }
});

test("Radio proxy rejects HTTPS downgrade redirects and invalid requests", async t => {
    const calls = [];
    const proxy = await createRadioStreamProxy({
        sourceUrl: "https://radio.example/live",
        lookup: async () => [{ address: "93.184.216.34" }],
        requestImpl: fakeRequestFactory([{
            statusCode: 302,
            headers: { location: "http://radio.example/insecure" }
        }], calls)
    });
    t.after(() => proxy.close());

    assert.equal((await loopbackGet(proxy.url)).statusCode, 502);
    const wrongPath = await loopbackGet(`${proxy.url}/extra`);
    assert.equal(wrongPath.statusCode, 404);
    assert.equal(calls.length, 1);
});

test("Radio proxy enforces the redirect limit", async t => {
    const calls = [];
    const proxy = await createRadioStreamProxy({
        sourceUrl: "http://radio.example/live",
        maxRedirects: 1,
        lookup: async () => [{ address: "93.184.216.34" }],
        requestImpl: fakeRequestFactory([
            { statusCode: 302, headers: { location: "/next" } },
            { statusCode: 302, headers: { location: "/final" } }
        ], calls)
    });
    t.after(() => proxy.close());

    assert.equal((await loopbackGet(proxy.url)).statusCode, 502);
    assert.equal(calls.length, 2);
});

test("Radio proxy request timeout destroys the outbound request", async t => {
    let requestDestroyed = false;
    const proxy = await createRadioStreamProxy({
        sourceUrl: "http://radio.example/live",
        timeoutMs: 100,
        lookup: async () => [{ address: "93.184.216.34" }],
        requestImpl: () => {
            const request = new EventEmitter();
            request.setTimeout = () => {};
            request.destroy = error => {
                requestDestroyed = true;
                if (error) request.emit("error", error);
            };
            request.end = () => {};
            return request;
        },
        logger: { error() {} }
    });
    t.after(() => proxy.close());

    const result = await loopbackGet(proxy.url);
    assert.equal(result.statusCode, 502);
    assert.equal(requestDestroyed, true);
});

test("Radio proxy close destroys active stream connections", async t => {
    let remoteResponse;
    let remoteRequest;
    const proxy = await createRadioStreamProxy({
        sourceUrl: "http://radio.example/live",
        lookup: async () => [{ address: "93.184.216.34" }],
        requestImpl: (url, options, callback) => {
            remoteRequest = new EventEmitter();
            remoteRequest.setTimeout = () => {};
            remoteRequest.destroy = () => {
                remoteRequest.emit("close");
            };
            remoteRequest.end = () => {
                remoteResponse = new PassThrough();
                remoteResponse.statusCode = 200;
                remoteResponse.headers = { "content-type": "audio/mpeg" };
                remoteResponse.setTimeout = () => {};
                process.nextTick(() => callback(remoteResponse));
            };
            return remoteRequest;
        },
        logger: { error() {} }
    });
    t.after(() => proxy.close());

    const clientClosed = new Promise((resolve, reject) => {
        const request = http.get(proxy.url, response => {
            response.once("close", resolve);
        });
        request.once("error", error => {
            if (error.code === "ECONNRESET") resolve();
            else reject(error);
        });
    });
    await new Promise(resolve => {
        const check = () => remoteResponse ? resolve() : setImmediate(check);
        check();
    });
    await proxy.close();
    await clientClosed;
    assert.equal(remoteResponse.destroyed, true);
    assert.ok(remoteRequest);
});

test("Radio proxy logs upstream stream errors and closes the client cleanly", async t => {
    let remoteResponse;
    const errors = [];
    const proxy = await createRadioStreamProxy({
        sourceUrl: "http://radio.example/live",
        lookup: async () => [{ address: "93.184.216.34" }],
        requestImpl: (url, options, callback) => {
            const request = new EventEmitter();
            request.setTimeout = () => {};
            request.destroy = () => request.emit("close");
            request.end = () => {
                remoteResponse = new PassThrough();
                remoteResponse.statusCode = 200;
                remoteResponse.headers = { "content-type": "audio/mpeg" };
                remoteResponse.setTimeout = () => {};
                process.nextTick(() => callback(remoteResponse));
            };
            return request;
        },
        logger: { error: (...args) => errors.push(args) }
    });
    t.after(() => proxy.close());

    let resolveClientReady;
    const clientReady = new Promise(resolve => { resolveClientReady = resolve; });
    const clientClosed = new Promise((resolve, reject) => {
        const request = http.get(proxy.url, response => {
            response.on("data", () => {});
            response.once("close", resolve);
            resolveClientReady();
        });
        request.once("error", error => {
            if (error.code === "ECONNRESET") resolve();
            else reject(error);
        });
    });
    let readyTimer;
    try {
        await Promise.race([
            clientReady,
            new Promise((_, reject) => {
                readyTimer = setTimeout(() => {
                    reject(new Error("Radio proxy did not start the client response."));
                }, 1_000);
            })
        ]);
    } finally {
        clearTimeout(readyTimer);
    }
    assert.ok(remoteResponse, "The proxy should establish an upstream stream before relaying.");
    remoteResponse.destroy(new Error("upstream stream failed"));
    let closeTimer;
    try {
        await Promise.race([
            clientClosed,
            new Promise((_, reject) => {
                closeTimer = setTimeout(() => reject(new Error("Radio proxy left the failed client stream open.")), 1_000);
            })
        ]);
    } finally {
        clearTimeout(closeTimer);
    }

    assert.equal(errors.length, 1);
    assert.match(errors[0][0], /Radio Stream Proxy Error/);
    assert.equal(remoteResponse.destroyed, true);
});
