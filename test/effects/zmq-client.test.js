const test = require("node:test");
const assert = require("node:assert/strict");
const ZmqClient = require("../../src/effects/zmq-client");

test("closing ZeroMQ client interrupts an outstanding request without waiting for its timeout", async () => {
    const client = new ZmqClient("tcp://127.0.0.1:42991", 4000);
    const request = client.sendCommand("bass@bassboost gain 0");
    await new Promise(resolve => setTimeout(resolve, 50));

    const close = client.close();
    let timer;
    const result = await Promise.race([
        close.then(() => "closed"),
        new Promise(resolve => { timer = setTimeout(() => resolve("timed out"), 1000); })
    ]);
    clearTimeout(timer);

    assert.equal(result, "closed");
    await assert.rejects(request, /ZeroMQ request gagal/i);
});
