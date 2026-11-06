const test = require("node:test");
const assert = require("node:assert/strict");
const { buildLyricsPanel } = require("../../src/lyrics/panel");
const music = require("../../src/music/manager");

test("lyrics panel keeps original lyrics and labels translation as unsynchronized", t => {
    const originalGetSession = music.getSession;
    music.getSession = () => ({
        currentTrack: { title: "Example", artist: "Artist" },
        player: { state: { status: "idle" } },
        history: [],
        queue: []
    });
    t.after(() => { music.getSession = originalGetSession; });

    const panel = buildLyricsPanel(
        { id: "123456789012345678" },
        { found: true, synced: false, plainLyrics: "Hello world" },
        {
            translatedText: "Halo dunia",
            source: "en",
            target: "id",
            synchronized: false
        }
    );

    assert.equal(panel.embeds.length, 2);
    assert.match(panel.embeds[0].data.description, /Hello world/);
    assert.match(panel.embeds[1].data.description, /Halo dunia/);
    assert.match(panel.embeds[1].data.footer.text, /tidak disinkronkan/i);
    assert.equal(panel.components[0].components[3].toJSON().custom_id, "castorice:lyrics_translate");
});
