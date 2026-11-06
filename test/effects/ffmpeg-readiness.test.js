const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");

const ffmpegPath = require("ffmpeg-static");
const EndpointManager = require("../../src/effects/endpoint-manager");
const EffectsController = require("../../src/effects/controller");
const { buildFilterGraph } = require("../../src/effects/filter-builder");
const { DEFAULT_EFFECTS } = require("../../src/effects/presets");

function waitForClose(child) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise(resolve => child.once("close", resolve));
}

test("bundled FFmpeg binds the leased azmq endpoint and accepts effect commands", { timeout: 20000 }, async t => {
    assert.ok(ffmpegPath && fs.existsSync(ffmpegPath), "ffmpeg-static binary must be installed");
    const endpointManager = new EndpointManager();
    const lease = await endpointManager.allocate();
    let ffmpeg;
    let controller;
    let stderr = "";

    t.after(async () => {
        await controller?.close().catch(() => {});
        if (ffmpeg && ffmpeg.exitCode === null && ffmpeg.signalCode === null) {
            ffmpeg.kill();
        }
        if (ffmpeg) await waitForClose(ffmpeg);
        lease.release();
    });

    const graph = buildFilterGraph(DEFAULT_EFFECTS, 0, lease.endpoint);
    ffmpeg = spawn(ffmpegPath, [
        "-hide_banner",
        "-loglevel", "error",
        "-re",
        "-f", "lavfi",
        "-i", "anullsrc=r=48000:cl=stereo",
        "-af", graph,
        "-t", "30",
        "-f", "null", "-"
    ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });

    ffmpeg.stderr.on("data", chunk => {
        stderr = (stderr + chunk.toString()).slice(-4000);
    });
    const closePromise = waitForClose(ffmpeg);
    controller = new EffectsController({
        endpointLease: lease,
        effects: DEFAULT_EFFECTS
    });

    await controller.start();
    const state = await controller.setBass("high");
    assert.equal(state.bass, "high");
    assert.equal(ffmpeg.exitCode, null, `FFmpeg exited before the readiness check: ${stderr}`);

    await controller.close();
    ffmpeg.kill();
    await closePromise;
    assert.equal(endpointManager.activeCount, 0);
    assert.doesNotMatch(stderr, /error|failed/i);
    assert.doesNotMatch(stderr, /error|failed/i);
});
