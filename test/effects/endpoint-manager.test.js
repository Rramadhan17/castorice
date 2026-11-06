const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const EndpointManager = require("../../src/effects/endpoint-manager");

function fakeServer({ port, failure = null }) {
    const server = new EventEmitter();
    server.listening = false;
    server.listen = (_port, _host, callback) => {
        if (failure) {
            setImmediate(() => server.emit("error", failure));
            return;
        }
        server.listening = true;
        setImmediate(callback);
    };
    server.address = () => ({ port });
    server.close = callback => {
        server.listening = false;
        callback();
    };
    return server;
}

test("endpoint allocation retries transient reservation failures", async () => {
    let attempts = 0;
    const manager = new EndpointManager({
        createServer: () => {
            attempts += 1;
            return fakeServer({ port: 42001, failure: attempts === 1 ? new Error("temporary bind failure") : null });
        },
        maxAttempts: 3
    });

    const lease = await manager.allocate();
    assert.equal(attempts, 2);
    assert.equal(lease.endpoint, "tcp://127.0.0.1:42001");
    assert.equal(manager.activeCount, 1);
    lease.release();
    lease.release();
    assert.equal(manager.activeCount, 0);
});

test("endpoint allocation retries when server creation itself fails", async () => {
    let attempts = 0;
    const manager = new EndpointManager({
        createServer: () => {
            attempts += 1;
            if (attempts === 1) throw new Error("temporary factory failure");
            return fakeServer({ port: 42005 });
        },
        maxAttempts: 2
    });
    const lease = await manager.allocate();
    assert.equal(attempts, 2);
    lease.release();
});

test("endpoint allocation retries a port already leased by this manager", async () => {
    const ports = [42002, 42003];
    const manager = new EndpointManager({ createServer: () => fakeServer({ port: ports.shift() }) });
    manager.activePorts.add(42002);

    const lease = await manager.allocate();
    assert.equal(lease.port, 42003);
    assert.equal(manager.activeCount, 2);
    lease.release();
    manager.activePorts.delete(42002);
});

test("endpoint allocation fails with a bounded retry count", async () => {
    let attempts = 0;
    const manager = new EndpointManager({
        createServer: () => {
            attempts += 1;
            return fakeServer({ port: 42004, failure: new Error("bind denied") });
        },
        maxAttempts: 3
    });

    await assert.rejects(manager.allocate(), /setelah 3 percobaan: bind denied/i);
    assert.equal(attempts, 3);
    assert.equal(manager.activeCount, 0);
});

test("endpoint manager validates retry configuration", () => {
    assert.throws(() => new EndpointManager({ maxAttempts: 0 }), /maxAttempts/i);
    assert.throws(() => new EndpointManager({ createServer: null }), /createServer/i);
});
