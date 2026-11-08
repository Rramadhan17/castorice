const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createSecureFetch } = require("../../src/music/secure-http");

function requestHarness({ statusCode = 200, body = '{"ok":true}', headers = {} } = {}) {
    let captured;
    const requestImpl = (url, options, callback) => {
        captured = { url, options };
        const request = new EventEmitter();
        request.setTimeout = () => {};
        request.end = () => {
            const response = new PassThrough();
            response.statusCode = statusCode;
            response.headers = headers;
            callback(response);
            process.nextTick(() => response.end(body));
        };
        request.destroy = error => {
            if (error) request.emit("error", error);
        };
        return request;
    };
    return { requestImpl, get captured() { return captured; } };
}

test("Radio discovery HTTPS client pins its validated address and uses no redirect following", async () => {
    const harness = requestHarness();
    const fetch = createSecureFetch({
        lookup: async (_host, options) => {
            assert.equal(options.all, true);
            return [{ address: "93.184.216.34", family: 4 }];
        },
        requestImpl: harness.requestImpl
    });
    const response = await fetch("https://radio.example/api", {
        headers: { "User-Agent": "Castorice test" }
    });
    assert.equal(response.ok, true);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(harness.captured.options.hostname, "radio.example");
    harness.captured.options.lookup("radio.example", {}, (error, address) => {
        assert.ifError(error);
        assert.equal(address, "93.184.216.34");
    });
});

test("Radio discovery DNS failures, private mixed records, redirects and aborts fail closed", async () => {
    const mixed = createSecureFetch({
        lookup: async () => [
            { address: "93.184.216.34", family: 4 },
            { address: "fc00::1", family: 6 }
        ],
        requestImpl: () => { throw new Error("Must not connect."); }
    });
    await assert.rejects(mixed("https://radio.example/api"), /privat atau non-global/);

    const redirectHarness = requestHarness({
        statusCode: 302,
        headers: { location: "http://127.0.0.1/admin" }
    });
    const redirect = createSecureFetch({
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestImpl: redirectHarness.requestImpl
    });
    await assert.rejects(redirect("https://radio.example/api"), /redirects are not allowed/);

    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(redirect("https://radio.example/api", { signal: aborted.signal }), /cancelled/);
});
