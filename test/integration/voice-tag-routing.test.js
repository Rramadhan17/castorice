const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { Events } = require("discord.js");
const registerInteractionHandler = require("../../src/events/interactionCreate");

const G = `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
const guildDirectory = path.resolve(__dirname, "../../data/guilds", G);

test("AI Tag routes temporary voice creation through the Voice Manager service", async t => {
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));
    const handlers = new Map();
    const client = {
        user: { id: "123456789012345678" },
        on: (event, callback) => handlers.set(event, callback)
    };
    const calls = [];
    registerInteractionHandler(client, {
        voiceManager: {
            createTemporaryVoice: async (...args) => {
                calls.push(args);
                return { id: "32345678901234567" };
            }
        },
        voiceStateStore: {}
    });
    const replies = [];
    const guild = {
        id: G,
        members: {
            fetch: async id => ({ id, voice: { channel: { id: "42345678901234567" } } })
        }
    };
    const message = {
        author: { id: "22345678901234567", bot: false },
        guild,
        content: "<@123456789012345678> buat voice private bernama Team Room",
        mentions: { users: { has: () => true } },
        reply: async payload => replies.push(payload)
    };

    await handlers.get(Events.MessageCreate)(message);

    assert.equal(calls.length, 1);
    assert.equal(calls[0][2].id, message.author.id);
    assert.deepEqual(calls[0][3], { name: "Team Room", privacy: "private" });
    assert.match(replies[0].content, /<#[0-9]+>/);
});
