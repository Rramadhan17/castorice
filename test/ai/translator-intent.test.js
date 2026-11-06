const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMusicIntent } = require("../../src/ai/music-intent");

test("translator intent detects automatic source and target language", () => {
    assert.deepEqual(
        parseMusicIntent("terjemahkan 'hello world' ke ID!"),
        {
            type: "translate",
            text: "hello world",
            source: "auto",
            target: "id"
        }
    );
});

test("translator intent accepts an explicit source language", () => {
    assert.deepEqual(
        parseMusicIntent("translate hello dari en ke tl"),
        {
            type: "translate",
            text: "hello",
            source: "en",
            target: "tl"
        }
    );
});

test("malformed translation requests remain unknown", () => {
    assert.equal(parseMusicIntent("terjemahkan hello ke indonesian").type, "unknown");
});
