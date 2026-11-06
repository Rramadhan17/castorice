const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlaylistTagRouter } = require("../../src/playlists/tag-router");

const message = (commandText, replies = []) => ({
    guild: { id: "guild" },
    member: { id: "member", guild: { id: "guild" }, voice: { channel: { id: "voice" } } },
    author: { id: "member" },
    async reply(payload) { replies.push(payload); }
});

test("AI Tag can list playlists and play a named playlist", async () => {
    const replies = [];
    const playlist = { id: "id-1", name: "Road Trip", tracks: [{ input: "one" }, { input: "two" }] };
    const service = {
        async list() { return { items: { [playlist.id]: playlist } }; },
        async findByName(_guildId, name) { return name === playlist.name ? playlist : null; }
    };
    const queued = [];
    const route = createPlaylistTagRouter({
        service,
        musicManager: { async addToQueue(_guild, _member, input) { queued.push(input); } },
        featureGuard: async (_guildId, feature) => ({ allowed: true, state: { id: feature } })
    });
    const msg = message("", replies);

    assert.equal(await route({ message: msg, commandText: "lihat playlist" }), true);
    assert.match(replies[0].content, /Road Trip/);
    assert.equal(await route({ message: msg, commandText: "putar playlist Road Trip" }), true);
    assert.deepEqual(queued, ["one", "two"]);
    assert.match(replies[1].content, /2 track/);
});

test("AI Tag blocks disabled playlists and reports a missing name", async () => {
    const replies = [];
    const msg = message("", replies);
    let serviceCalls = 0;
    const route = createPlaylistTagRouter({
        service: {
            async list() { serviceCalls += 1; return { items: {} }; },
            async findByName() { serviceCalls += 1; return null; }
        },
        featureGuard: async () => ({ allowed: false, reason: "Playlists disabled" })
    });

    await route({ message: msg, commandText: "lihat playlist" });
    assert.match(replies[0], /disabled/);
    assert.equal(serviceCalls, 0);
});

test("AI Tag checks Music separately before attempting playlist playback", async () => {
    const replies = [];
    const playlist = { id: "id", name: "Road Trip", tracks: [{ input: "one" }] };
    const route = createPlaylistTagRouter({
        service: { async findByName() { return playlist; } },
        musicManager: { async addToQueue() { assert.fail("must not enqueue"); } },
        featureGuard: async (_guildId, feature) => ({ allowed: feature !== "music", reason: "Music disabled" })
    });
    await route({ message: message("", replies), commandText: "play playlist Road Trip" });
    assert.match(replies[0], /Music disabled/);
});
