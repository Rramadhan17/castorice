const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { Events } = require("discord.js");
const registerInteractionHandler = require("../../src/events/interactionCreate");

const guildId = `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
const guildDirectory = path.resolve(__dirname, "../../data/guilds", guildId);

function register(service, musicManager) {
    const handlers = new Map();
    registerInteractionHandler({
        user: { id: "123456789012345678" },
        on: (event, handler) => handlers.set(event, handler)
    }, { playlistService: service, musicManager });
    return handlers;
}

test("Dashboard playlist selection enqueues tracks through the music manager", async t => {
    t.after(() => fs.rm(guildDirectory, { recursive: true, force: true }));
    const playlist = { id: "playlist-id", name: "Road Trip", tracks: [{ input: "one" }, { input: "two" }] };
    const queued = [];
    const service = { async list() { return { items: { [playlist.id]: playlist } }; } };
    const handlers = register(service, {
        async addToQueue(guild, member, input) {
            queued.push({ guildId: guild.id, memberId: member.id, input });
        }
    });
    const interaction = {
        customId: "castorice:playlist_manage_select:0",
        values: [`play:${playlist.id}`],
        guildId,
        guild: {
            id: guildId,
            members: {
                async fetch(id) {
                    return { id, guild: { id: guildId }, voice: { channel: { id: "voice" } } };
                }
            }
        },
        user: { id: "234567890123456789" },
        memberPermissions: { has: () => false },
        deferred: false,
        replied: false,
        isChatInputCommand: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => true,
        deferReply: async () => { interaction.deferred = true; },
        editReply: async payload => { interaction.result = payload; },
        followUp: async () => {}
    };

    await handlers.get(Events.InteractionCreate)(interaction);
    assert.deepEqual(queued.map(item => item.input), ["one", "two"]);
    assert.match(interaction.result.content, /2 track/);
});

test("AI Tag playlist commands route through the persisted service contract", async t => {
    t.after(() => fs.rm(guildDirectory, { recursive: true, force: true }));
    const playlist = { id: "playlist-id", name: "Road Trip", tracks: [{ input: "one" }] };
    const queued = [];
    const handlers = register({
        async list() { return { items: { [playlist.id]: playlist } }; },
        async findByName(_guild, name) { return name === playlist.name ? playlist : null; }
    }, { async addToQueue(_guild, _member, input) { queued.push(input); } });
    const replies = [];
    const message = {
        author: { bot: false, id: "234567890123456789" },
        member: { id: "234567890123456789", guild: { id: guildId }, voice: { channel: { id: "voice" } } },
        guild: {
            id: guildId,
            members: {
                async fetch(id) {
                    return {
                        id,
                        guild: { id: guildId },
                        permissions: { has: () => true }
                    };
                }
            }
        },
        content: "<@123456789012345678> putar playlist Road Trip",
        mentions: { users: { has: () => true } },
        async reply(payload) { replies.push(payload); }
    };

    await handlers.get(Events.MessageCreate)(message);
    assert.deepEqual(queued, ["one"]);
    assert.match(replies[0].content, /1 track/);
});

test("Dashboard playlist create modal persists newline-separated tracks", async t => {
    t.after(() => fs.rm(guildDirectory, { recursive: true, force: true }));
    let created;
    const playlist = { id: "new-playlist", name: "Focus", tracks: [{ input: "one" }, { input: "two" }] };
    const service = {
        async create(_guild, name, tracks) { created = { name, tracks }; return playlist; },
        async list() { return { items: { [playlist.id]: playlist } }; }
    };
    const handlers = register(service, {});
    const interaction = {
        customId: "castorice:playlist_create_submit",
        guildId,
        guild: {
            id: guildId,
            members: {
                async fetch(id) {
                    return {
                        id,
                        guild: { id: guildId },
                        permissions: { has: () => true }
                    };
                }
            }
        },
        user: { id: "234567890123456789" },
        memberPermissions: { has: () => true },
        fields: { getTextInputValue: id => ({ playlist_name: "Focus", playlist_tracks: "one\ntwo\n" })[id] },
        deferred: false,
        replied: false,
        isChatInputCommand: () => false,
        isModalSubmit: () => true,
        isStringSelectMenu: () => false,
        deferReply: async () => { interaction.deferred = true; },
        editReply: async payload => { interaction.result = payload; },
        followUp: async () => {}
    };

    await handlers.get(Events.InteractionCreate)(interaction);
    assert.deepEqual(created, { name: "Focus", tracks: ["one", "two"] });
    assert.match(interaction.result.embeds[0].data.description, /Playlist berhasil dibuat/);
});

test("playlist deletion confirmation is bound to its requester", async t => {
    t.after(() => fs.rm(guildDirectory, { recursive: true, force: true }));
    let removed = 0;
    const handlers = register({
        async remove() { removed += 1; return true; },
        async list() { return { items: {} }; }
    }, {});
    const interaction = {
        customId: "castorice:playlist_delete_confirm:playlist-id:234567890123456789",
        guildId,
        guild: { id: guildId },
        user: { id: "345678901234567890" },
        memberPermissions: { has: () => true },
        replied: false,
        deferred: false,
        isChatInputCommand: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        isButton: () => true,
        async reply(payload) { interaction.result = payload; },
        async deferReply() { interaction.deferred = true; },
        async editReply(payload) { interaction.edited = payload; },
        async followUp() {}
    };
    await handlers.get(Events.InteractionCreate)(interaction);
    assert.match(interaction.result.content, /hanya dapat digunakan oleh pemintanya/i);
    assert.equal(removed, 0);
});

test("playlist Dashboard denies mutation controls without Manage Server", async t => {
    t.after(() => fs.rm(guildDirectory, { recursive: true, force: true }));
    let modalShown = false;
    const handlers = register({}, {});
    const interaction = {
        customId: "castorice:playlist_create",
        guildId,
        guild: { id: guildId },
        memberPermissions: { has: () => false },
        replied: false,
        deferred: false,
        isChatInputCommand: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        isButton: () => true,
        async reply(payload) { interaction.result = payload; },
        async showModal() { modalShown = true; }
    };
    await handlers.get(Events.InteractionCreate)(interaction);
    assert.match(interaction.result.content, /Manage Server/i);
    assert.equal(modalShown, false);
});
