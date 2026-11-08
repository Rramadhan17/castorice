const test = require("node:test");
const assert = require("node:assert/strict");
const { HELP_CENTER_PAGES, buildVoiceGreeterHelpCenter } = require("../../src/dashboard/voice-greeter-help-center");

test("Voice Greeter Help Center exposes tutorial-only navigation for implemented features", () => {
    const panel = buildVoiceGreeterHelpCenter();
    const select = panel.components[0].components[0].toJSON();
    const summary = panel.components[1].components[0].toJSON();

    assert.equal(panel.embeds[0].data.title, "Help Center Castorice — Ringkasan");
    assert.equal(select.custom_id, "castorice:voice_help_select");
    assert.equal(select.options.length, HELP_CENTER_PAGES.length);
    assert.equal(summary.custom_id, "castorice:voice_help_overview");
    assert.equal(summary.disabled, true);
    assert.match(buildVoiceGreeterHelpCenter("media").embeds[0].data.description, /belum tersedia/i);
});

test("Voice Greeter Help Center rejects unknown pages instead of showing a misleading fallback", () => {
    assert.throws(() => buildVoiceGreeterHelpCenter("download"), RangeError);
});
