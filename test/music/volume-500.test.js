const test = require("node:test");
const assert = require("node:assert/strict");
const music = require("../../src/music/manager");

test("setVolume validates boundaries 0 to 500 and adjusts volume", () => {
    const fakeSession = {
        currentTrack: { title: "Test Track" },
        volume: 100,
        resource: {
            volume: {
                volume: 1,
                setVolume(v) { this.volume = v; }
            }
        }
    };

    music.getSessions().set("guild-vol", fakeSession);

    try {
        // Valid 150
        const v150 = music.setVolume({ id: "guild-vol" }, 150);
        assert.equal(v150, 150);
        assert.equal(fakeSession.volume, 150);
        assert.equal(fakeSession.resource.volume.volume, 1.5);

        // Valid 500
        const v500 = music.setVolume({ id: "guild-vol" }, 500);
        assert.equal(v500, 500);
        assert.equal(fakeSession.volume, 500);
        assert.equal(fakeSession.resource.volume.volume, 5.0);

        // Valid 0
        const v0 = music.setVolume({ id: "guild-vol" }, 0);
        assert.equal(v0, 0);
        assert.equal(fakeSession.volume, 0);
        assert.equal(fakeSession.resource.volume.volume, 0);

        // Invalid > 500
        assert.throws(() => music.setVolume({ id: "guild-vol" }, 501), /Volume harus antara 0 sampai 500/);

        // Invalid < 0
        assert.throws(() => music.setVolume({ id: "guild-vol" }, -5), /Volume harus antara 0 sampai 500/);
    } finally {
        music.getSessions().delete("guild-vol");
    }
});
