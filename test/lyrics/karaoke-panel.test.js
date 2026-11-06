const test = require("node:test");
const assert = require("node:assert/strict");
const music = require("../../src/music/manager");
const { buildLyricsPanel } = require("../../src/lyrics/panel");
const { getRefreshInterval } = require("../../src/music/panel-updater");

test("synced lyrics render the active karaoke line and timestamp-based progress", t => {
    const originalGetSession = music.getSession;
    const originalGetPosition = music.getPosition;
    music.getSession = () => ({
        currentTrack: { title: "Example", artist: "Artist" },
        player: { state: { status: "playing" } },
        history: [],
        queue: []
    });
    music.getPosition = () => 3.5;
    t.after(() => {
        music.getSession = originalGetSession;
        music.getPosition = originalGetPosition;
    });

    const panel = buildLyricsPanel(
        { id: "123456789012345678" },
        {
            found: true,
            synced: true,
            lyrics: [
                { time: 1, text: "First line" },
                { time: 5, text: "Second line" },
                { time: 9, text: "Third line" }
            ]
        }
    );
    const description = panel.embeds[0].data.description;

    assert.match(description, /🎤 \*\*First line\*\*/);
    assert.match(description, /▰▰▰▰▰▰▱▱▱▱ 63%/);
    assert.match(description, /Second line/);
    assert.match(panel.embeds[0].data.footer.text, /Karaoke/);
});

test("karaoke panels refresh each second while playing and back off while paused", () => {
    assert.equal(getRefreshInterval("lyrics", "playing"), 1000);
    assert.equal(getRefreshInterval("lyrics", "paused"), 5000);
    assert.equal(getRefreshInterval("music", "playing"), 5000);
});
