const test = require("node:test");
const assert = require("node:assert/strict");
const EffectsController = require("../../src/effects/controller");

test("concurrent start and close calls share lifecycle promises", async () => {
    let finishSend;
    let clientClosed = false;
    let released = false;
    const client = {
        sendCommand: () => new Promise(resolve => { finishSend = resolve; }),
        close: async () => { clientClosed = true; }
    };
    const controller = new EffectsController({
        endpointLease: {
            endpoint: "tcp://127.0.0.1:5559",
            release: () => { released = true; }
        },
        client
    });

    const firstStart = controller.start();
    const secondStart = controller.start();
    assert.strictEqual(firstStart, secondStart);

    await new Promise(resolve => setImmediate(resolve));
    const firstClose = controller.close();
    const secondClose = controller.close();
    assert.strictEqual(firstClose, secondClose);
    finishSend("0");

    await assert.rejects(firstStart, /ditutup saat startup/i);
    await firstClose;
    assert.equal(clientClosed, true);
    assert.equal(released, true);
});

test("close is safe before start and repeated close does not release twice", async () => {
    let releases = 0;
    let closes = 0;
    const controller = new EffectsController({
        endpointLease: {
            endpoint: "tcp://127.0.0.1:5559",
            release: () => { releases += 1; }
        },
        client: {
            sendCommand: async () => "0",
            close: async () => { closes += 1; }
        }
    });

    await controller.close();
    await controller.close();
    assert.equal(closes, 1);
    assert.equal(releases, 1);
    await assert.rejects(controller.start(), /sudah ditutup/i);
});

test("close interrupts a ZeroMQ readiness request before awaiting startup", async () => {
    let rejectSend;
    let released = 0;
    let closed = 0;
    const controller = new EffectsController({
        endpointLease: {
            endpoint: "tcp://127.0.0.1:5560",
            release: () => { released += 1; }
        },
        client: {
            sendCommand: () => new Promise((resolve, reject) => { rejectSend = reject; }),
            close: async () => {
                closed += 1;
                rejectSend(new Error("socket closed"));
            }
        }
    });

    const starting = controller.start();
    await new Promise(resolve => setImmediate(resolve));
    await controller.close();

    await assert.rejects(starting, /ditutup saat startup/i);
    assert.equal(closed, 1);
    assert.equal(released, 1);
});
