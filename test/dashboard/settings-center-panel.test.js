const test = require("node:test");
const assert = require("node:assert/strict");
const {
    SETTINGS_ACTION_IDS,
    buildSettingsPanel
} = require("../../src/dashboard/menu-panel");
const { buildVoiceGreeterHelpCenter } = require("../../src/dashboard/voice-greeter-help-center");

test("Settings Center exposes each supported action exactly once with stable custom IDs", async () => {
    const panel = await buildSettingsPanel();
    const buttons = panel.components.flatMap(row =>
        row.components.map(component => component.toJSON())
    );
    const ids = buttons.map(button => button.custom_id);

    assert.deepEqual(
        Object.values(SETTINGS_ACTION_IDS).sort(),
        [
            "castorice:settings_tutor",
            "castorice:settings_rate",
            "castorice:settings_suggestion",
            "castorice:settings_report"
        ].sort()
    );
    for (const customId of Object.values(SETTINGS_ACTION_IDS)) {
        assert.equal(ids.filter(id => id === customId).length, 1);
    }
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes("castorice:home"));
});

test("Tutor Help Center keeps navigation back to Settings in the same message", () => {
    const panel = buildVoiceGreeterHelpCenter();
    const buttonIds = panel.components.flatMap(row =>
        row.components.map(component => component.toJSON().custom_id)
    );

    assert.ok(buttonIds.includes("castorice:settings"));
    assert.match(panel.embeds[0].data.description, /panduan/i);
});
