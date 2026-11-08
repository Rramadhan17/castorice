const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
    createHealthServer,
    createRuntimeLifecycle,
    parsePort
} = require("../../src/http/health-server");

function fakeClient({ loginError = null } = {}) {
    return {
        destroyed: 0,
        logins: 0,
        async login(token) {
            this.logins += 1;
            assert.equal(token, "test-token");
            if (loginError) throw loginError;
        },
        async destroy() {
            this.destroyed += 1;
        }
    };
}

function fakeProcess() {
    const processRef = new EventEmitter();
    processRef.exitCode = 0;
    return processRef;
}

function quietLogger() {
    return { info() {}, error() {} };
}

test("health server reports Discord readiness with JSON status", async t => {
    let ready = false;
    const server = createHealthServer({
        getHealth: () => ({ status: ready ? "ok" : "starting", discord: ready ? "ready" : "not_ready", uptime: 12 })
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "0.0.0.0", resolve);
    });
    t.after(() => new Promise(resolve => server.close(resolve)));

    const port = server.address().port;
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 503);
    assert.match(health.headers.get("content-type"), /application\/json/);
    assert.deepEqual(await health.json(), { status: "starting", discord: "not_ready", uptime: 12 });

    ready = true;
    const healthy = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(healthy.status, 200);
    assert.deepEqual(await healthy.json(), { status: "ok", discord: "ready", uptime: 12 });

    const notFound = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(notFound.status, 404);
    assert.deepEqual(await notFound.json(), { error: "not_found" });
    const wrongMethod = await fetch(`http://127.0.0.1:${port}/health`, { method: "POST" });
    assert.equal(wrongMethod.status, 404);
});

test("port parsing uses PORT and rejects invalid values", () => {
    assert.equal(parsePort("10000"), 10_000);
    assert.equal(parsePort("0"), 0);
    assert.throws(() => parsePort("not-a-port"), /PORT must be an integer/);
    assert.throws(() => parsePort("65536"), /PORT must be an integer/);
});

test("runtime starts Discord once with HTTP and gracefully closes on SIGTERM", async () => {
    const server = createHealthServer();
    const client = fakeClient();
    const processRef = fakeProcess();
    let cleanupCalls = 0;
    const lifecycle = createRuntimeLifecycle({
        server,
        client,
        token: "test-token",
        port: 0,
        host: "0.0.0.0",
        cleanup: async () => { cleanupCalls += 1; },
        logger: quietLogger(),
        processRef
    });

    await lifecycle.start();
    assert.equal(server.listening, true);
    assert.equal(client.logins, 1);
    assert.equal(client.destroyed, 0);

    processRef.emit("SIGTERM");
    processRef.emit("SIGINT");
    await lifecycle.shutdown();

    assert.equal(server.listening, false);
    assert.equal(client.destroyed, 1);
    assert.equal(cleanupCalls, 1);
    assert.equal(processRef.exitCode, 0);
    assert.equal(processRef.listenerCount("SIGTERM"), 0);
    assert.equal(processRef.listenerCount("SIGINT"), 0);
    assert.equal(server.listenerCount("error"), 0);
});

test("runtime listens on its configured port and serves health before Discord login resolves", async () => {
    const portProbe = require("node:net").createServer();
    await new Promise((resolve, reject) => {
        portProbe.once("error", reject);
        portProbe.listen(0, "127.0.0.1", resolve);
    });
    const port = portProbe.address().port;
    await new Promise((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()));

    let readyState = false;
    const client = {
        async login() {
            startupEvents.push("discord-login");
            return new Promise(resolve => { resolveLogin = resolve; });
        },
        isReady: () => readyState,
        async destroy() {}
    };
    const server = createHealthServer({
        getHealth: () => ({
            status: client.isReady() ? "ok" : "starting",
            discord: client.isReady() ? "ready" : "not_ready",
            uptime: process.uptime()
        })
    });
    const processRef = fakeProcess();
    const logs = [];
    const startupEvents = [];
    let resolveLogin;
    const lifecycle = createRuntimeLifecycle({
        server,
        client,
        token: "test-token",
        port,
        host: "0.0.0.0",
        logger: {
            ...quietLogger(),
            info: (...args) => {
                logs.push(args);
                if (args[0] === "[HTTP] Listening") startupEvents.push("http-listening");
            }
        },
        processRef
    });
    assert.equal(typeof lifecycle.start, "function");
    assert.equal(typeof lifecycle.shutdown, "function");
    const starting = lifecycle.start();
    try {
        await new Promise((resolve, reject) => {
            if (server.listening) return resolve();
            server.once("listening", resolve);
            server.once("error", reject);
        });

        assert.deepEqual(server.address(), { address: "0.0.0.0", family: "IPv4", port });
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        assert.equal(response.status, 503);
        const body = await response.json();
        assert.equal(body.status, "starting");
        assert.equal(body.discord, "not_ready");
        assert.equal(typeof body.uptime, "number");
        assert.ok(logs.some(([message, details]) =>
            message === "[HTTP] Listening" && details.port === port
        ));
        assert.deepEqual(startupEvents, ["http-listening", "discord-login"]);
        assert.equal(typeof resolveLogin, "function");
    } finally {
        resolveLogin?.();
        await starting;
        await lifecycle.shutdown();
    }
});

test("health follows Discord reconnect state while the same HTTP server stays online", async () => {
    let ready = false;
    const client = {
        async login() {
            ready = true;
        },
        isReady: () => ready,
        async destroy() {
            ready = false;
        }
    };
    const server = createHealthServer({
        getHealth: () => ({
            status: client.isReady() ? "ok" : "starting",
            discord: client.isReady() ? "ready" : "not_ready",
            uptime: process.uptime()
        })
    });
    const lifecycle = createRuntimeLifecycle({
        server,
        client,
        token: "test-token",
        port: 0,
        host: "0.0.0.0",
        logger: quietLogger(),
        processRef: fakeProcess()
    });

    await lifecycle.start();
    const port = server.address().port;
    const readHealth = async () => {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        return { status: response.status, body: await response.json() };
    };

    assert.equal((await readHealth()).status, 200);
    assert.equal((await readHealth()).body.discord, "ready");

    ready = false;
    assert.equal((await readHealth()).status, 503);
    assert.equal((await readHealth()).body.discord, "not_ready");
    assert.equal(server.listening, true);

    ready = true;
    assert.equal((await readHealth()).status, 200);
    assert.equal((await readHealth()).body.discord, "ready");

    await lifecycle.shutdown();
    assert.equal(server.listening, false);
});

test("Discord login failure closes HTTP, destroys the client, and sets a failing exit code", async () => {
    const server = createHealthServer();
    const client = fakeClient({ loginError: Object.assign(new Error("private login detail"), { code: "LOGIN_FAILED" }) });
    const processRef = fakeProcess();
    const logs = [];
    const lifecycle = createRuntimeLifecycle({
        server,
        client,
        token: "test-token",
        port: 0,
        host: "127.0.0.1",
        logger: { info() {}, error: (...args) => logs.push(args) },
        processRef
    });

    await assert.rejects(lifecycle.start(), /private login detail/);

    assert.equal(server.listening, false);
    assert.equal(client.logins, 1);
    assert.equal(client.destroyed, 1);
    assert.equal(processRef.exitCode, 1);
    assert.doesNotMatch(JSON.stringify(logs), /private login detail/);
});

test("runtime HTTP server failure sets a failing exit code and removes runtime listeners", async () => {
    const server = createHealthServer();
    const client = fakeClient();
    const processRef = fakeProcess();
    let cleanupCalls = 0;
    const lifecycle = createRuntimeLifecycle({
        server,
        client,
        token: "test-token",
        port: 0,
        logger: quietLogger(),
        cleanup: async () => { cleanupCalls += 1; },
        processRef
    });

    await lifecycle.start();
    server.emit("error", Object.assign(new Error("private server detail"), { code: "HTTP_FAILED" }));
    await lifecycle.shutdown();

    assert.equal(server.listening, false);
    assert.equal(client.destroyed, 1);
    assert.equal(cleanupCalls, 1);
    assert.equal(processRef.exitCode, 1);
    assert.equal(processRef.listenerCount("SIGTERM"), 0);
    assert.equal(processRef.listenerCount("SIGINT"), 0);
    assert.equal(server.listenerCount("error"), 0);
});

test("HTTP startup failure does not attempt Discord login and destroys the client", async t => {
    const occupiedServer = createHealthServer();
    await new Promise((resolve, reject) => {
        occupiedServer.once("error", reject);
        occupiedServer.listen(0, "127.0.0.1", resolve);
    });
    t.after(() => new Promise(resolve => occupiedServer.close(resolve)));
    const port = occupiedServer.address().port;
    const server = createHealthServer();
    const client = fakeClient();
    const processRef = fakeProcess();
    const lifecycle = createRuntimeLifecycle({
        server,
        client,
        token: "test-token",
        port,
        host: "127.0.0.1",
        logger: quietLogger(),
        processRef
    });

    await assert.rejects(lifecycle.start());

    assert.equal(client.logins, 0);
    assert.equal(client.destroyed, 1);
    assert.equal(processRef.exitCode, 1);
});
