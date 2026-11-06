const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { Events } = require("discord.js");
const music = require("../../src/music/manager");
const registerInteractionHandler = require("../../src/events/interactionCreate");

const guildId = `${Date.now()}${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
const guildDirectory = path.resolve(__dirname, "../../data/guilds", guildId);

test("natural autoplay commands require voice access and update the active session", async t => {
    t.after(async () => {
        music.getSessions().delete(guildId);
        await fs.rm(guildDirectory, { recursive: true, force: true });
    });

    const channelId = "345678901234567890";
    const session = {
        guildId,
        channelId,
        autoplayEnabled: false,
        connection: {
            state: { status: "ready" },
            joinConfig: { channelId }
        }
    };
    music.getSessions().set(guildId, session);

    const handlers = new Map();
    const client = {
        user: { id: "123456789012345678" },
        on: (event, handler) => handlers.set(event, handler)
    };
    registerInteractionHandler(client);
    const replies = [];
    const message = {
        author: { bot: false, id: "234567890123456789" },
        guild: {
            id: guildId,
            members: {
                fetch: async id => ({
                    id,
                    guild: { id: guildId },
                    voice: { channelId }
                }),
                fetchMe: async () => ({ voice: { channelId } })
            }
        },
        content: "Castorice: autoplay on",
        mentions: { users: { has: () => false } },
        reply: async payload => replies.push(payload)
    };

    await handlers.get(Events.MessageCreate)(message);

    assert.equal(session.autoplayEnabled, true);
    assert.match(replies[0], /Autoplay diaktifkan untuk sesi ini/i);
});
