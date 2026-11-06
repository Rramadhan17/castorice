const test = require("node:test");
const assert = require("node:assert/strict");
const music = require("../../src/music/manager");
const { buildMusicPanel } = require("../../src/dashboard/menu-panel");

test("music panel reports autoplay state and exposes a session-scoped toggle", t => {
    const guildId = `autoplay-panel-${Date.now()}-${Math.random()}`;
    const session = {
        channelId: "345678901234567890",
        player: { state: { status: "idle" } },
        currentTrack: null,
        queue: [],
        history: [],
        volume: 100,
        autoplayEnabled: true
    };
    music.getSessions().set(guildId, session);
    t.after(() => music.getSessions().delete(guildId));

    const panel = buildMusicPanel({ id: guildId });
    const controls = panel.components[2].components.map(component => component.toJSON());
    const autoplay = controls.find(component => component.custom_id === "castorice:music_autoplay");
    const autoplayField = panel.embeds[0].toJSON().fields.find(field => field.name === "Autoplay");

    assert.equal(autoplay.label, "Autoplay: On");
    assert.equal(autoplay.style, 3);
    assert.equal(autoplay.disabled, false);
    assert.equal(autoplayField.value, "Aktif");
    assert.equal(controls.length, 5);
});
