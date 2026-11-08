const test = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const http = require("node:http");
const net = require("node:net");
const { searchTracks } = require("../../src/music/manager");
const {
    createYtDlpEgressProxy,
    spawnSecuredYtDlp,
    MAX_REDIRECTS
} = require("../../src/music/yt-dlp-egress-proxy");

function fakeRequestFactory(responses, calls = []) {
    return (url, options, callback) => {
        const request = new PassThrough();
        request.setTimeout = () => {};
        request.once("finish", () => {
            calls.push({ url, options });
            const responseData = responses.shift();
            if (!responseData) {
                request.destroy(new Error("No fake response."));
                return;
            }
            const response = new PassThrough();
            response.statusCode = responseData.statusCode || 200;
            response.headers = responseData.headers || { "content-type": "audio/mpeg" };
            response.once("error", () => {});
            callback(response);
            process.nextTick(() => response.end(responseData.body || ""));
        });
        return request;
    };
}

function proxyRequest(proxyUrl, targetUrl) {
    const proxy = new URL(proxyUrl);
    return new Promise((resolve, reject) => {
        const request = http.request({
            hostname: proxy.hostname,
            port: proxy.port,
            method: "GET",
            path: targetUrl,
            headers: { host: new URL(targetUrl).host },
            agent: false
        }, response => {
            const chunks = [];
            response.on("data", chunk => chunks.push(chunk));
            response.once("end", () => resolve({
                statusCode: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks).toString()
            }));
        });
        request.once("error", reject);
        request.end();
    });
}

function connectStatus(proxyUrl, authority) {
    const proxy = new URL(proxyUrl);
    return new Promise((resolve, reject) => {
        const socket = net.connect(Number(proxy.port), "127.0.0.1");
        let output = "";
        socket.once("error", reject);
        socket.on("data", data => {
            output += data.toString();
            if (output.includes("\r\n\r\n")) {
                const status = output.split("\r\n", 1)[0];
                socket.destroy();
                resolve(status);
            }
        });
        socket.once("connect", () => {
            socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
        });
    });
}

test("yt-dlp egress proxy pins HTTP connections to an all-public DNS result", async t => {
    const calls = [];
    const proxy = await createYtDlpEgressProxy({
        lookup: async (_host, options) => {
            assert.equal(options.all, true);
            assert.equal(options.family, undefined);
            return [
                { address: "93.184.216.34", family: 4 },
                { address: "2606:4700:4700::1111", family: 6 }
            ];
        },
        requestImpl: fakeRequestFactory([{ body: "ok" }], calls),
        logger: { error() {} }
    });
    t.after(() => proxy.close());

    const response = await proxyRequest(proxy.url, "http://music.example/song");
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, "ok");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.hostname, "music.example");
    calls[0].options.lookup("music.example", {}, (error, address, family) => {
        assert.ifError(error);
        assert.equal(address, "93.184.216.34");
        assert.equal(family, 4);
    });
});

test("yt-dlp egress proxy rejects mixed, private and timed-out DNS before connecting", async t => {
    let outboundCalls = 0;
    const proxy = await createYtDlpEgressProxy({
        timeoutMs: 100,
        lookup: async host => {
            if (host === "mixed.example") {
                return [
                    { address: "93.184.216.34", family: 4 },
                    { address: "fd00::1", family: 6 }
                ];
            }
            if (host === "slow.example") return new Promise(() => {});
            return [{ address: "10.0.0.1", family: 4 }];
        },
        requestImpl: (...args) => {
            outboundCalls += 1;
            return fakeRequestFactory([{ body: "unexpected" }])(...args);
        },
        logger: { error() {} }
    });
    t.after(() => proxy.close());

    for (const host of ["mixed.example", "private.example", "slow.example"]) {
        const response = await proxyRequest(proxy.url, `http://${host}/resource`);
        assert.equal(response.statusCode, 502, host);
    }
    assert.equal(outboundCalls, 0);
});

test("yt-dlp egress proxy resolves every request again to prevent DNS rebinding", async t => {
    let lookups = 0;
    const calls = [];
    const proxy = await createYtDlpEgressProxy({
        lookup: async () => [{
            address: ++lookups === 1 ? "93.184.216.34" : "10.0.0.2",
            family: 4
        }],
        requestImpl: fakeRequestFactory([{ body: "first" }], calls),
        logger: { error() {} }
    });
    t.after(() => proxy.close());

    assert.equal((await proxyRequest(proxy.url, "http://changing.example/one")).statusCode, 200);
    assert.equal((await proxyRequest(proxy.url, "http://changing.example/two")).statusCode, 502);
    assert.equal(lookups, 2);
    assert.equal(calls.length, 1);
});

test("yt-dlp egress proxy reports outbound connection failures without leaking upstream data", async t => {
    const proxy = await createYtDlpEgressProxy({
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestImpl: () => {
            const request = new PassThrough();
            request.setTimeout = () => {};
            request.once("finish", () => request.destroy(new Error("ECONNREFUSED private detail")));
            return request;
        },
        logger: { error() {} }
    });
    t.after(() => proxy.close());

    const response = await proxyRequest(proxy.url, "http://music.example/song");
    assert.equal(response.statusCode, 502);
    assert.doesNotMatch(response.body, /private detail|ECONNREFUSED/);
});

test("HTTP redirects validate and resolve each hop, reject private destinations, and cap chains", async t => {
    let privateProxy = await createYtDlpEgressProxy({
        lookup: async host => [{
            address: host === "music.example" ? "93.184.216.34" : "192.168.1.1",
            family: 4
        }],
        requestImpl: fakeRequestFactory([{
            statusCode: 302,
            headers: { location: "http://private.example/admin" }
        }]),
        logger: { error() {} }
    });
    t.after(() => privateProxy.close());
    const privateResponse = await proxyRequest(privateProxy.url, "http://music.example/start");
    assert.equal(privateResponse.statusCode, 502);

    const responses = Array.from({ length: MAX_REDIRECTS + 2 }, (_, index) => ({
        statusCode: 302,
        headers: { location: `http://music.example/redirect-${index + 1}` }
    }));
    const calls = [];
    const chainProxy = await createYtDlpEgressProxy({
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestImpl: fakeRequestFactory(responses, calls),
        logger: { error() {} }
    });
    t.after(() => chainProxy.close());

    let nextUrl = "http://music.example/redirect-0";
    let response;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        response = await proxyRequest(chainProxy.url, nextUrl);
        if (response.statusCode !== 302) break;
        nextUrl = response.headers.location;
    }
    assert.equal(response.statusCode, 502);
    assert.equal(calls.length, MAX_REDIRECTS + 1);
});

test("HTTP redirect counts are isolated per request", async t => {
    const calls = [];
    const proxy = await createYtDlpEgressProxy({
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestImpl: (url, options, callback) => {
            const request = new PassThrough();
            request.setTimeout = () => {};
            request.once("finish", () => {
                calls.push(url.pathname);
                const match = url.pathname.match(/^\/(first|second)-(\d+)$/);
                const chain = match[1];
                const hop = Number(match[2]);
                const redirectsForRequest = chain === "first" ? MAX_REDIRECTS : 1;
                const response = new PassThrough();
                response.statusCode = hop < redirectsForRequest ? 302 : 200;
                response.headers = hop < redirectsForRequest
                    ? { location: `http://music.example/${chain}-${hop + 1}` }
                    : { "content-type": "audio/mpeg" };
                response.once("error", () => {});
                callback(response);
                process.nextTick(() => response.end(chain));
            });
            return request;
        },
        logger: { error() {} }
    });
    t.after(() => proxy.close());

    const first = await proxyRequest(proxy.url, "http://music.example/first-0");
    const second = await proxyRequest(proxy.url, "http://music.example/second-0");
    assert.equal(first.statusCode, 200);
    assert.equal(first.body, "first");
    assert.equal(second.statusCode, 200);
    assert.equal(second.body, "second");
    assert.equal(calls.filter(path => path.startsWith("/first-")).length, MAX_REDIRECTS + 1);
    assert.equal(calls.filter(path => path.startsWith("/second-")).length, 2);
});

test("HTTP redirect loops stop at the per-request redirect limit", async t => {
    let outboundCalls = 0;
    const proxy = await createYtDlpEgressProxy({
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestImpl: (url, options, callback) => {
            const request = new PassThrough();
            request.setTimeout = () => {};
            request.once("finish", () => {
                outboundCalls += 1;
                const response = new PassThrough();
                response.statusCode = 302;
                response.headers = { location: url.toString() };
                response.once("error", () => {});
                callback(response);
                process.nextTick(() => response.end());
            });
            return request;
        },
        logger: { error() {} }
    });
    t.after(() => proxy.close());

    const response = await proxyRequest(proxy.url, "http://music.example/loop");
    assert.equal(response.statusCode, 502);
    assert.match(response.body, /redirect limit exceeded/i);
    assert.equal(outboundCalls, MAX_REDIRECTS + 1);
});

test("cancelled HTTP redirect requests destroy their upstream and do not poison later requests", async t => {
    const outboundRequests = [];
    const proxy = await createYtDlpEgressProxy({
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestImpl: (_url, _options, callback) => {
            const request = new PassThrough();
            request.setTimeout = () => {};
            outboundRequests.push(request);
            request.once("finish", () => {
                if (outboundRequests.length === 1) {
                    const response = new PassThrough();
                    response.statusCode = 200;
                    response.headers = { "content-type": "audio/mpeg" };
                    response.once("error", () => {});
                    callback(response);
                    response.write("partial");
                    return;
                }
                const response = new PassThrough();
                response.statusCode = 200;
                response.headers = { "content-type": "audio/mpeg" };
                response.once("error", () => {});
                callback(response);
                process.nextTick(() => response.end("ok"));
            });
            return request;
        },
        logger: { error() {} }
    });
    t.after(() => proxy.close());

    await new Promise(resolve => {
        const proxyAddress = new URL(proxy.url);
        const request = http.request({
            hostname: proxyAddress.hostname,
            port: proxyAddress.port,
            path: "http://music.example/cancel",
            headers: { host: "music.example" },
            agent: false
        }, response => {
            response.destroy();
            resolve();
        });
        request.once("error", resolve);
        request.end();
    });
    for (let attempt = 0; attempt < 20 && !outboundRequests[0]?.destroyed; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(outboundRequests.length, 1);
    assert.equal(outboundRequests[0].destroyed, true);

    const response = await proxyRequest(proxy.url, "http://music.example/next");
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, "ok");
});

test("CONNECT rejects non-global destinations and pins the actual socket address", async t => {
    let connectedTo;
    const blockedProxy = await createYtDlpEgressProxy({
        lookup: async () => [{ address: "169.254.169.254", family: 4 }],
        connectImpl: options => {
            connectedTo = options;
            throw new Error("Must not connect.");
        },
        logger: { error() {} }
    });
    t.after(() => blockedProxy.close());
    assert.match(await connectStatus(blockedProxy.url, "metadata.example:443"), /^HTTP\/1\.1 502/);
    assert.equal(connectedTo, undefined);

    let pinnedTarget;
    const tunnelProxy = await createYtDlpEgressProxy({
        lookup: async () => [
            { address: "93.184.216.34", family: 4 },
            { address: "2606:4700:4700::1111", family: 6 }
        ],
        connectImpl: options => {
            pinnedTarget = options;
            const socket = new PassThrough();
            socket.setTimeout = () => {};
            process.nextTick(() => socket.emit("connect"));
            return socket;
        },
        logger: { error() {} }
    });
    t.after(() => tunnelProxy.close());
    assert.match(await connectStatus(tunnelProxy.url, "media.example:443"), /^HTTP\/1\.1 200/);
    assert.deepEqual(pinnedTarget, { host: "93.184.216.34", family: 4, port: 443 });

    let ipv6Target;
    const ipv6Proxy = await createYtDlpEgressProxy({
        connectImpl: options => {
            ipv6Target = options;
            const socket = new PassThrough();
            socket.setTimeout = () => {};
            process.nextTick(() => socket.emit("connect"));
            return socket;
        },
        logger: { error() {} }
    });
    t.after(() => ipv6Proxy.close());
    assert.match(
        await connectStatus(ipv6Proxy.url, "[2606:4700:4700::1111]:443"),
        /^HTTP\/1\.1 200/
    );
    assert.deepEqual(ipv6Target, {
        host: "2606:4700:4700::1111",
        family: 6,
        port: 443
    });
});

test("yt-dlp launch blocks external, redirected, and private URL scenarios before network access", async () => {
    let spawnCalls = 0;
    let proxyCalls = 0;
    const sources = [
        "https://music.example/song",
        "https://cdn.example/redirected",
        "https://127.0.0.1/private",
        "https://[::1]/private"
    ];
    for (const source of sources) {
        await assert.rejects(
            spawnSecuredYtDlp("yt-dlp", ["--", source], {
                proxyFactory: async () => { proxyCalls += 1; },
                spawnImpl: () => { spawnCalls += 1; }
            }),
            /isolasi egress tingkat proses\/OS/
        );
    }
    assert.equal(spawnCalls, 0);
    assert.equal(proxyCalls, 0);
});

test("Music search-by-name explicitly reports that yt-dlp is disabled", async () => {
    let spawnCalls = 0;
    await assert.rejects(
        searchTracks("The Artist - The Song", {
            spawnImpl: () => { spawnCalls += 1; }
        }),
        /isolasi egress tingkat proses\/OS/
    );
    assert.equal(spawnCalls, 0);
});
