const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMusicIntent } = require("../../src/ai/music-intent");

test("empty text requests help and unknown text stays unknown", () => {
    assert.deepEqual(parseMusicIntent("  "), { type: "help" });
    assert.deepEqual(parseMusicIntent("buat server gaming"), { type: "unknown" });
});

test("search and play intents normalize surrounding quotes and punctuation", () => {
    assert.deepEqual(parseMusicIntent('  carikan "NIKI - La La Lost You"!  '), {
        type: "search",
        query: "NIKI - La La Lost You"
    });
    assert.deepEqual(parseMusicIntent("Mainkan 'blue'"), {
        type: "play",
        query: "blue"
    });
});

test("queue intents parse indices and preserve one-based user values", () => {
    assert.deepEqual(parseMusicIntent("Lihat antrean"), { type: "queue_show" });
    assert.deepEqual(parseMusicIntent("hapus lagu 3"), { type: "queue_remove", index: 3 });
    assert.deepEqual(parseMusicIntent("pindahkan lagu 3 ke 1"), {
        type: "queue_move",
        from: 3,
        to: 1
    });
    assert.deepEqual(parseMusicIntent("shuffle queue"), { type: "queue_shuffle" });
    assert.deepEqual(parseMusicIntent("kosongkan antrean"), { type: "queue_clear" });
    assert.deepEqual(parseMusicIntent("siapa requester"), { type: "queue_requester" });
});

test("playback and volume aliases map to deterministic intents", () => {
    const examples = [
        ["jeda", { type: "pause" }],
        ["teruskan", { type: "resume" }],
        ["skip", { type: "next" }],
        ["sebelumnya", { type: "previous" }],
        ["hentikan musik", { type: "stop" }],
        ["status", { type: "status" }],
        ["atur volume 85", { type: "volume", value: 85 }],
        ["kecilkan suara", { type: "volume_change", amount: -10 }],
        ["besarkan volume sedikit", { type: "volume_change", amount: 10 }]
    ];

    for (const [input, expected] of examples) {
        assert.deepEqual(parseMusicIntent(input), expected, input);
    }
});

test("autoplay aliases accept explicit enable and disable requests", () => {
    assert.deepEqual(parseMusicIntent("autoplay on"), { type: "autoplay", enabled: true });
    assert.deepEqual(parseMusicIntent("putar otomatis nyala"), { type: "autoplay", enabled: true });
    assert.deepEqual(parseMusicIntent("autoplay off"), { type: "autoplay", enabled: false });
    assert.deepEqual(parseMusicIntent("putar otomatis nonaktif"), { type: "autoplay", enabled: false });
    assert.deepEqual(parseMusicIntent("autoplay"), { type: "unknown" });
});

test("Radio Discovery intents take precedence over generic music searches", () => {
    assert.deepEqual(parseMusicIntent("cari radio BBC World Service"), {
        type: "radio_search",
        query: "BBC World Service"
    });
    assert.deepEqual(parseMusicIntent("radio search lo-fi"), {
        type: "radio_search",
        query: "lo-fi"
    });
    assert.deepEqual(parseMusicIntent("cari lagu radiohead"), {
        type: "search",
        query: "lagu radiohead"
    });
});

test("non-string input does not throw", () => {
    assert.deepEqual(parseMusicIntent(null), { type: "help" });
    assert.deepEqual(parseMusicIntent(42), { type: "unknown" });
});
