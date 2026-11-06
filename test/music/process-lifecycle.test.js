const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { stopProcessPair } = require("../../src/music/process-lifecycle");

function fakeChild() {
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.killed = false;
    child.killCalls = 0;
    child.kill = () => {
        child.killCalls += 1;
        child.killed = true;
    };
    return child;
}

function finishChild(child) {
    child.signalCode = "SIGTERM";
    child.emit("close", null, "SIGTERM");
}

test("process cleanup unpipes, closes stdin, kills both children and awaits close", async () => {
    const yt = fakeChild();
    const ffmpeg = fakeChild();
    const input = {
        destroyed: false,
        destroy() { this.destroyed = true; }
    };
    let unpipeCalls = 0;
    yt.stdout = { unpipe: stream => { assert.equal(stream, input); unpipeCalls += 1; } };
    ffmpeg.stdin = input;

    let resolved = false;
    const cleanup = stopProcessPair(yt, ffmpeg).then(() => { resolved = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resolved, false);
    finishChild(yt);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resolved, false);
    finishChild(ffmpeg);
    await cleanup;

    assert.equal(unpipeCalls, 1);
    assert.equal(ffmpeg.stdin.destroyed, true);
    assert.equal(yt.killCalls, 1);
    assert.equal(ffmpeg.killCalls, 1);
});

test("already-closed children are not killed again", async () => {
    const yt = fakeChild();
    const ffmpeg = fakeChild();
    yt.exitCode = 0;
    ffmpeg.signalCode = "SIGTERM";

    await stopProcessPair(yt, ffmpeg);
    assert.equal(yt.killCalls, 0);
    assert.equal(ffmpeg.killCalls, 0);
});

test("repeated cleanup waits for a child close without duplicate kills", async () => {
    const yt = fakeChild();
    const ffmpeg = fakeChild();
    const first = stopProcessPair(yt, ffmpeg);
    const second = stopProcessPair(yt, ffmpeg);

    finishChild(yt);
    finishChild(ffmpeg);
    await Promise.all([first, second]);
    assert.equal(yt.killCalls, 1);
    assert.equal(ffmpeg.killCalls, 1);
});

test("process cleanup escalates to SIGKILL when SIGTERM does not close a child", async () => {
    const child = fakeChild();
    const signals = [];
    child.kill = signal => {
        signals.push(signal || "SIGTERM");
        child.killed = true;
        if (signal === "SIGKILL") finishChild(child);
    };

    await stopProcessPair(child, null, { graceMs: 5, forceWaitMs: 20 });
    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("process cleanup rejects after bounded escalation if child still does not close", async () => {
    const child = fakeChild();
    child.kill = () => { child.killed = true; };

    await assert.rejects(
        stopProcessPair(child, null, { graceMs: 5, forceWaitMs: 5 }),
        /tidak berhenti setelah SIGKILL/i
    );
});
