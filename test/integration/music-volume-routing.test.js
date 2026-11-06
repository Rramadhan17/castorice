const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { Events } = require("discord.js");
const music = require("../../src/music/manager");
const registerInteractionHandler = require("../../src/events/interactionCreate");

const guildId = `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
const guildDirectory = path.resolve(__dirname, "../../data/guilds", guildId);

test("natural volume increase preserves the 500 percent engine limit", async t => {
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));
    const originalGetSession = music.getSession;
    const originalSetVolume = music.setVolume;
    const channelId = "345678901234567890";
    const session = {
        guildId,
        channelId,
        volume: 495,
        currentTrack: { title: "Test track" },
        connection: {
            state: { status: "ready" },
            joinConfig: { channelId }
        }
    };
    const values = [];
    music.getSession = () => session;
    music.setVolume = (_guild, volume) => {
        values.push(volume);
        return volume;
    };
    t.after(() => {
        music.getSession = originalGetSession;
        music.setVolume = originalSetVolume;
    });

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
        content: "Castorice: naikkan suara",
        mentions: { users: { has: () => false } },
        reply: async payload => replies.push(payload)
    };

    await handlers.get(Events.MessageCreate)(message);

    assert.deepEqual(values, [500]);
    assert.match(replies[0], /500%/);
});
