const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { JsonGuildStore } = require("../../src/storage/json-guild-store");
const { createPlaylistService } = require("../../src/playlists/service");

const guildId = "12345678901234567";
const adminActor = {
    guild: { id: guildId },
    permissions: { has: () => true }
};

test("playlist CRUD persists records by guild and validates operations", async t => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "castorice-playlists-"));
    t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
    const service = createPlaylistService({
        store: new JsonGuildStore({ rootDir }),
        now: () => "2026-01-01T00:00:00.000Z"
    });

    assert.deepEqual(await service.list(guildId), { items: {} });
    const created = await service.create(guildId, "Road Trip", ["https://example.test/track"], adminActor);
    assert.equal(created.name, "Road Trip");
    assert.equal((await service.list(guildId)).items[created.id].tracks.length, 1);
    await assert.rejects(service.create(guildId, "road trip", [], adminActor), /sudah digunakan/i);

    const renamed = await service.rename(guildId, created.id, "Late Night", adminActor);
    assert.equal(renamed.name, "Late Night");
    const updated = await service.addTracks(guildId, created.id, [{ url: "https://example.test/second", title: "Second" }], adminActor);
    assert.equal(updated.tracks.length, 2);
    assert.equal((await service.removeTrack(guildId, created.id, 0, adminActor)).input, "https://example.test/track");
    assert.equal(await service.remove(guildId, created.id, adminActor), true);
    assert.equal(await service.remove(guildId, created.id, adminActor), false);
    assert.deepEqual((await service.list(guildId)).items, {});
});

test("playlist service rejects invalid names, tracks and indices", async t => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "castorice-playlists-"));
    t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
    const service = createPlaylistService({ store: new JsonGuildStore({ rootDir }) });

    await assert.rejects(service.create(guildId, "  ", [], adminActor), /nama playlist/i);
    await assert.rejects(service.create(guildId, "Valid", [""], adminActor), /input yang valid/i);
    const playlist = await service.create(guildId, "Valid", [], adminActor);
    await assert.rejects(service.removeTrack(guildId, playlist.id, 0, adminActor), /tidak ditemukan/i);
    await assert.rejects(service.addTracks(guildId, playlist.id, [], adminActor), /minimal satu/i);
});

test("playlist mutation service denies missing, mismatched and insufficient actors", async () => {
    const service = createPlaylistService();
    await assert.rejects(service.create(guildId, "Denied"), /Manage Server/i);
    await assert.rejects(service.create(guildId, "Denied", [], {
        guild: { id: "12345678901234568" },
        permissions: { has: () => true }
    }), /Manage Server/i);
    await assert.rejects(service.create(guildId, "Denied", [], {
        guild: { id: guildId },
        permissions: { has: () => false }
    }), /Manage Server/i);
});
