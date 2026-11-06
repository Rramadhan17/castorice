const test = require("node:test");
const assert = require("node:assert/strict");
const { parseLrc } = require("../../src/lyrics/lrc-parser");
const { getActiveLyric } = require("../../src/lyrics/synchronizer");

test("LRC parser handles empty input, line endings, and metadata-only lines", () => {
    assert.deepEqual(parseLrc(null), []);
    assert.deepEqual(parseLrc("  "), []);
    assert.deepEqual(parseLrc("[ti:Title]\r\n[ar:Artist]\r\n[00:01.00]Line"), [
        { time: 1, text: "Line" }
    ]);
});

test("timestamps support centiseconds, milliseconds, and multiple tags", () => {
    const lines = parseLrc("[00:01.23][00:02:345]Repeated")
        .map(line => ({ ...line, time: Math.round(line.time * 1000) / 1000 }));

    assert.deepEqual(lines, [
        { time: 1.23, text: "Repeated" },
        { time: 2.345, text: "Repeated" }
    ]);
});

test("parsed lines are chronologically sorted and ties preserve source order", () => {
    assert.deepEqual(parseLrc("[00:03.00]Third\n[00:01.00]First\n[00:01.00]Also first"), [
        { time: 1, text: "First" },
        { time: 1, text: "Also first" },
        { time: 3, text: "Third" }
    ]);
});

test("offset metadata adjusts timestamps and negative results clamp to zero", () => {
    assert.deepEqual(parseLrc("[offset:-1500]\n[00:01.00]At zero\n[00:02.00]Half second"), [
        { time: 0, text: "At zero" },
        { time: 0.5, text: "Half second" }
    ]);
});

test("malformed seconds and timestamp-only lines are ignored", () => {
    assert.deepEqual(parseLrc("[00:60.00]Invalid\n[00:01.00]\n[01:02.00]Valid"), [
        { time: 62, text: "Valid" }
    ]);
});

test("synchronizer returns empty state and upcoming lyric before first timestamp", () => {
    assert.deepEqual(getActiveLyric([], 0), {
        index: -1,
        current: null,
        previous: null,
        next: null,
        progress: 0
    });

    const lyrics = [{ time: 5, text: "First" }, { time: 9, text: "Second" }];
    assert.deepEqual(getActiveLyric(lyrics, 2), {
        index: -1,
        current: null,
        previous: null,
        next: lyrics[0],
        progress: 0
    });
});

test("synchronizer selects inclusive timestamp boundaries and interpolates progress", () => {
    const lyrics = [
        { time: 1, text: "First" },
        { time: 5, text: "Second" },
        { time: 9, text: "Third" }
    ];

    assert.equal(getActiveLyric(lyrics, 1).index, 0);
    assert.deepEqual(getActiveLyric(lyrics, 3), {
        index: 0,
        current: lyrics[0],
        previous: null,
        next: lyrics[1],
        progress: 0.5
    });
    assert.equal(getActiveLyric(lyrics, 5).index, 1);
    assert.equal(getActiveLyric(lyrics, 30).progress, 1);
});

test("synchronizer clamps negative/invalid positions and handles invalid lyric arrays", () => {
    assert.equal(getActiveLyric([{ time: 0, text: "Line" }], -5).index, 0);
    assert.equal(getActiveLyric([{ time: 0, text: "Line" }], "bad").index, 0);
    assert.equal(getActiveLyric(null, 5).index, -1);
});
