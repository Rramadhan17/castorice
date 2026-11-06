const test = require("node:test");
const assert = require("node:assert/strict");
const { enqueuePlaylist } = require("../../src/playlists/queue");

test("playlist enqueue requires same-guild voice and reports complete success", async () => {
    const calls = [];
    const result = await enqueuePlaylist({
        guild: { id: "guild" },
        member: { id: "member", guild: { id: "guild" }, voice: { channel: { id: "voice" } } },
        playlist: { tracks: [{ input: "one" }, { input: "two" }] },
        addToQueue: async (_guild, _member, input) => calls.push(input)
    });
    assert.deepEqual(calls, ["one", "two"]);
    assert.equal(result.added, 2);
    assert.equal(result.partial, false);
});

test("playlist enqueue reports partial queue failures without claiming all tracks", async () => {
    let calls = 0;
    const result = await enqueuePlaylist({
        guild: { id: "guild" },
        member: { id: "member", guild: { id: "guild" }, voice: { channel: { id: "voice" } } },
        playlist: { tracks: [{ input: "one" }, { input: "two" }, { input: "three" }] },
        addToQueue: async () => {
            calls += 1;
            if (calls === 2) throw new Error("queue full");
        }
    });
    assert.equal(result.added, 1);
    assert.equal(result.total, 3);
    assert.equal(result.partial, true);
    assert.match(result.error.message, /full/);
});

test("playlist enqueue refuses a different guild or missing voice channel", async () => {
    const params = {
        guild: { id: "guild-a" },
        member: { guild: { id: "guild-b" }, voice: { channel: { id: "voice" } } },
        playlist: { tracks: [{ input: "one" }] },
        addToQueue: async () => assert.fail("must not enqueue")
    };
    await assert.rejects(enqueuePlaylist(params), /server ini/i);
    await assert.rejects(enqueuePlaylist({ ...params, member: { guild: { id: "guild-a" }, voice: {} } }), /voice channel/i);
});
