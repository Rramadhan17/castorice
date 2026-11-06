const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDashboard } = require("../../src/dashboard/menu-panel");

test("Dashboard routes Voice Manager to its private interaction panel", () => {
    const payload = buildDashboard({
        id: "123456789012345678",
        voiceStates: { cache: { filter: () => ({ size: 0 }) } },
        channels: { cache: { filter: () => ({ size: 0 }) } },
        members: { me: { voice: { channel: null } } }
    });
    const buttons = payload.components.flatMap(row => row.components.map(component => component.toJSON()));
    const voiceManager = buttons.find(button => button.custom_id === "voice:open");

    assert.ok(voiceManager);
    assert.equal(voiceManager.disabled, false);
});
