const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { Events } = require("discord.js");
const { setFeatureEnabled } = require("../../src/features/feature-manager");
const registerInteractionHandler = require("../../src/events/interactionCreate");

const guildId = `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
const guildDirectory = path.resolve(__dirname, "../../data/guilds", guildId);

test("Voice AI natural trigger routes the prompt to speech service after guild opt-in", async t => {
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));
    await setFeatureEnabled(guildId, "voice_ai", true);
    const calls = [];
    const handlers = new Map();
    const client = {
        user: { id: "123456789012345678" },
        on: (event, handler) => handlers.set(event, handler)
    };
    registerInteractionHandler(client, {
        globalAISettings: {
            getSettings: async () => ({
                enabled: true,
                providerOrder: null,
                failoverEnabled: null
            })
        },
        voiceAIService: {
            respondAndSpeak: async request => {
                calls.push(request);
                return { text: "Jawaban audio", spoken: true };
            }
        }
    });
    const replies = [];
    const channel = { id: "32345678901234567", guildId };
    const member = {
        id: "22345678901234567",
        guild: { id: guildId },
        user: { bot: false },
        voice: { channel }
    };
    const message = {
        author: member.user,
        member,
        guild: { id: guildId },
        content: "Castorice: voice ai jelaskan aurora",
        mentions: { users: { has: () => false } },
        reply: async payload => replies.push(payload)
    };

    await handlers.get(Events.MessageCreate)(message);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
        guild: message.guild,
        member,
        text: "jelaskan aurora"
    });
    assert.equal(replies[0].content, "🔊 Jawaban audio");
    assert.deepEqual(replies[0].allowedMentions, { parse: [] });
});

test("Voice AI route does not create a temporary voice channel from voice phrasing", async t => {
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));
    await setFeatureEnabled(guildId, "voice_ai", true);
    let voiceManagerCalls = 0;
    const handlers = new Map();
    const client = {
        user: { id: "123456789012345678" },
        on: (event, handler) => handlers.set(event, handler)
    };
    registerInteractionHandler(client, {
        globalAISettings: {
            getSettings: async () => ({
                enabled: true,
                providerOrder: null,
                failoverEnabled: null
            })
        },
        voiceAIService: {
            respondAndSpeak: async () => ({ text: "answer", spoken: true })
        },
        voiceManager: { createTemporaryVoice: async () => { voiceManagerCalls += 1; } },
        voiceStateStore: {}
    });
    const message = {
        author: { id: "22345678901234567", bot: false },
        member: { id: "22345678901234567", guild: { id: guildId } },
        guild: { id: guildId },
        content: "<@123456789012345678> voice ai say hi",
        mentions: { users: { has: () => true } },
        reply: async () => {}
    };

    await handlers.get(Events.MessageCreate)(message);
    assert.equal(voiceManagerCalls, 0);
});
