const test = require("node:test");
const assert = require("node:assert/strict");
const { translateLyrics, LyricsTranslationError } = require("../../src/lyrics/translation");

test("translates synchronized lyric lines and keeps timing when line alignment is preserved", async () => {
    const calls = [];
    const translator = {
        maxLength: 100,
        async translate(input) {
            calls.push(input);
            return {
                translatedText: input.text.replace("Hello", "Halo").replace("world", "dunia"),
                target: input.target,
                detectedLanguage: "en"
            };
        }
    };

    const result = await translateLyrics({
        synced: true,
        lyrics: [{ time: 0, text: "Hello" }, { time: 1, text: "world" }]
    }, translator, { target: "id" });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].text, "Hello\nworld");
    assert.equal(result.translatedText, "Halo\ndunia");
    assert.equal(result.source, "en");
    assert.equal(result.target, "id");
    assert.equal(result.synchronized, true);
    assert.equal(result.alignment, "line");
    assert.deepEqual(result.alignedLyrics, [
        { time: 0, text: "Halo" },
        { time: 1, text: "dunia" }
    ]);
});

test("does not claim translated timing when a provider changes line count", async () => {
    const result = await translateLyrics({
        synced: true,
        lyrics: [{ time: 0, text: "First" }, { time: 1, text: "Second" }]
    }, {
        maxLength: 100,
        async translate() { return { translatedText: "Merged translation" }; }
    }, { target: "id" });

    assert.equal(result.synchronized, false);
    assert.equal(result.alignment, "not-guaranteed");
    assert.equal(result.alignedLyrics, null);
});

test("does not claim line alignment when lyrics were split across provider requests", async () => {
    const result = await translateLyrics({
        synced: true,
        lyrics: [{ time: 0, text: "1234" }, { time: 1, text: "5678" }]
    }, {
        maxLength: 5,
        async translate({ text }) { return { translatedText: text }; }
    }, { target: "id" });

    assert.equal(result.translatedText, "1234\n5678");
    assert.equal(result.synchronized, false);
    assert.equal(result.alignedLyrics, null);
});

test("splits long lyrics to the provider limit and retains line boundaries", async () => {
    const inputs = [];
    const translator = {
        maxLength: 5,
        async translate(input) {
            inputs.push(input.text);
            return { translatedText: input.text };
        }
    };

    const result = await translateLyrics({
        plainLyrics: "1234\n5678\n90"
    }, translator, { target: "id" });

    assert.deepEqual(inputs, ["1234", "5678", "90"]);
    assert.equal(result.translatedText, "1234\n5678\n90");
});

test("splits a single overlong lyric line without dropping characters", async () => {
    const inputs = [];
    const translator = {
        maxLength: 4,
        async translate(input) {
            inputs.push(input.text);
            return { translatedText: input.text };
        }
    };

    const result = await translateLyrics({ plainLyrics: "abcdefghij" }, translator, { target: "id" });

    assert.deepEqual(inputs, ["abcd", "efgh", "ij"]);
    assert.equal(result.translatedText, "abcdefghij");
});

test("preserves blank lines in plain lyrics", async () => {
    const translator = {
        maxLength: 100,
        async translate(input) {
            return { translatedText: input.text };
        }
    };

    const result = await translateLyrics({ plainLyrics: "first\n\nthird" }, translator, { target: "id" });
    assert.equal(result.translatedText, "first\n\nthird");
});

test("rejects absent lyrics, provider, and malformed provider output", async () => {
    await assert.rejects(
        translateLyrics({ plainLyrics: "" }, { translate() {} }, { target: "id" }),
        error => error instanceof LyricsTranslationError && error.code === "no_lyrics"
    );
    await assert.rejects(
        translateLyrics({ plainLyrics: "text" }, null, { target: "id" }),
        error => error.code === "invalid_provider"
    );
    await assert.rejects(
        translateLyrics({ plainLyrics: "text" }, { async translate() { return {}; } }, { target: "id" }),
        error => error.code === "invalid_provider_response"
    );
});
