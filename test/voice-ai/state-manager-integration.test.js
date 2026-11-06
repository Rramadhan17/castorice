const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { PermissionFlagsBits, ChannelType } = require("discord.js");
const stateStore = require("../../src/voice-ai/state-manager");
const { createVoiceManager } = require("../../src/voice-ai/manager-service");

const randomDigits = () => String(Math.floor(Math.random() * 100_000)).padStart(5, "0");
const guildId = `${Date.now()}${randomDigits()}`;
const ownerId = `${Date.now() + 1}${randomDigits()}`;
const channelId = `${Date.now() + 2}${randomDigits()}`;
const guildDirectory = path.resolve(__dirname, "../../data/guilds", guildId);

test("Voice Manager service persists a valid record through the existing state manager", async t => {
    t.after(async () => {
        stateStore.clearGuildCache(guildId);
        await fs.rm(guildDirectory, { recursive: true, force: true });
    });

    let deleted = false;
    let movedTo = null;
    const channel = {
        id: channelId,
        guildId,
        type: ChannelType.GuildVoice,
        parentId: null,
        members: new Map(),
        permissionsFor: () => ({ has: permission => permission === PermissionFlagsBits.Connect }),
        setName: async () => {},
        setUserLimit: async () => {},
        permissionOverwrites: { edit: async () => {} },
        delete: async () => { deleted = true; }
    };
    const member = {
        id: ownerId,
        guild: { id: guildId },
        displayName: "Test Owner",
        user: { username: "test-owner", bot: false },
        voice: {
            channel: { id: "72345678901234567", guildId, type: ChannelType.GuildVoice, parent: null },
            setChannel: async target => { movedTo = target.id; }
        }
    };
    const guild = {
        id: guildId,
        roles: { everyone: { id: guildId } },
        members: {
            me: { id: "82345678901234567", permissions: { has: () => true } },
            fetch: async id => id === ownerId ? member : null
        },
        channels: {
            create: async () => channel,
            fetch: async id => id === channelId ? channel : null
        }
    };

    const service = createVoiceManager({ stateStore });
    await service.createTemporaryVoice(guild, guildId, member);
    const saved = await stateStore.getVoiceState(guildId, channelId);

    assert.equal(saved.ownerId, ownerId);
    assert.equal(saved.status, "active");
    assert.equal(saved.members[ownerId].joinedAt > 0, true);
    assert.equal(movedTo, channelId);

    await service.deleteOwned(guild, guildId, member);
    assert.equal(await stateStore.getVoiceState(guildId, channelId), null);
    assert.equal(deleted, true);
});
