const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { buildVoiceGreeterModal, buildFeatureSelectionPanel } = require("../../src/dashboard/menu-panel");

test("Voice Greeter Dashboard offers a bounded message editor with the member placeholder", async t => {
    const guildId = `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
    const guildDirectory = path.resolve(__dirname, "../../data/guilds", guildId);
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));

    const modal = buildVoiceGreeterModal("Halo {user}").toJSON();
    assert.equal(modal.custom_id, "castorice:greeter_submit");
    const input = modal.components[0].components[0];
    assert.equal(input.custom_id, "greeter_message");
    assert.equal(input.max_length, 500);
    assert.equal(input.value, "Halo {user}");

    const panel = await buildFeatureSelectionPanel(guildId);
    const buttons = panel.components.flatMap(row => row.components.map(component => component.toJSON()));
    assert.equal(buttons.some(button => button.custom_id === "castorice:greeter_configure"), true);
});
