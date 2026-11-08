const test = require("node:test");
const assert = require("node:assert/strict");
const { getTrackMetadata } = require("../../src/music/track-resolver");

test("track metadata resolution fails closed before proxy or subprocess creation", async () => {
    let proxyCalls = 0;
    let spawnCalls = 0;

    await assert.rejects(
        getTrackMetadata("https://music.example/song", {
            binary: "yt-dlp",
            proxyFactory: async () => { proxyCalls += 1; },
            spawnImpl: () => { spawnCalls += 1; },
            logger: { error() {} }
        }),
        /isolasi egress tingkat proses\/OS/
    );
    assert.equal(proxyCalls, 0);
    assert.equal(spawnCalls, 0);
});

test("track metadata resolution validates required configuration before failing closed", async () => {
    await assert.rejects(getTrackMetadata("https://music.example/song"), /binary path is required/);
    await assert.rejects(
        getTrackMetadata("https://music.example/song", { binary: "yt-dlp", timeoutMs: 0 }),
        /timeout must be between/
    );
});
