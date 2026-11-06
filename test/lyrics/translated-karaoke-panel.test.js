const test = require("node:test");
const assert = require("node:assert/strict");
const music = require("../../src/music/manager");
const { buildLyricsPanel } = require("../../src/lyrics/panel");

test("line-aligned translated lyrics follow the active karaoke timestamp", t => {
    const originalGetSession = music.getSession;
    const originalGetPosition = music.getPosition;
    music.getSession = () => ({
        currentTrack: { title: "Example", artist: "Artist" },
        player: { state: { status: "playing" } },
        history: [],
        queue: []
    });
    music.getPosition = () => 6;
    t.after(() => {
        music.getSession = originalGetSession;
        music.getPosition = originalGetPosition;
    });

    const panel = buildLyricsPanel(
        { id: "123456789012345678" },
        {
            found: true,
            synced: true,
            lyrics: [{ time: 1, text: "First" }, { time: 5, text: "Second" }]
        },
        {
            translatedText: "Pertama\nKedua",
            target: "id",
            synchronized: true,
            alignedLyrics: [{ time: 1, text: "Pertama" }, { time: 5, text: "Kedua" }]
        }
    );

    assert.match(panel.embeds[0].data.description, /🎤 \*\*Second\*\*\n↳ Kedua/);
    assert.match(panel.embeds[1].data.footer.text, /tersinkron per baris/i);
});
