const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { Events } = require("discord.js");
const { setFeatureEnabled } = require("../../src/features/feature-manager");
const registerInteractionHandler = require("../../src/events/interactionCreate");

const guildId = `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
const guildDirectory = path.resolve(__dirname, "../../data/guilds", guildId);

function registerHandlers(aiConversationService, logger = { error() {} }) {
    const handlers = new Map();
    const client = {
        user: { id: "123456789012345678" },
        on: (event, handler) => handlers.set(event, handler)
    };
    registerInteractionHandler(client, {
        aiConversationService,
        logger,
        globalAISettings: {
            getSettings: async () => ({
                enabled: true,
                providerOrder: null,
                failoverEnabled: null
            })
        }
    });
    return handlers;
}

test("natural trigger routes unrecognized conversation to the configured AI service", async t => {
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));
    await setFeatureEnabled(guildId, "ai_chat", true);
    const calls = [];
    const handlers = registerHandlers({
        respond: async request => {
            calls.push(request);
            return { text: "Halo, ada yang bisa kubantu?" };
        },
        reset: () => true
    });
    const replies = [];
    let typing = false;
    const channelId = "345678901234567890";
    const message = {
        author: { bot: false, id: "234567890123456789" },
        guild: { id: guildId },
        content: "Castorice: jelaskan apa itu gravitasi",
        mentions: { users: { has: () => false } },
        reply: async payload => replies.push(payload),
        channel: {
            id: channelId,
            send: async payload => replies.push(payload),
            sendTyping: async () => { typing = true; }
        }
    };

    await handlers.get(Events.MessageCreate)(message);

    assert.deepEqual(calls, [{
        guildId,
        userId: message.author.id,
        channelId,
        text: "jelaskan apa itu gravitasi"
    }]);
    assert.equal(replies[0].content, "Halo, ada yang bisa kubantu?");
    assert.deepEqual(replies[0].allowedMentions, { parse: [] });
    assert.equal(typing, true);
});

test("AI Chat forwards mixed-language slang questions for a natural Gemini answer", async t => {
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));
    await setFeatureEnabled(guildId, "ai_chat", true);
    const calls = [];
    const handlers = registerHandlers({
        respond: async request => {
            calls.push(request);
            return { text: "Gravitasi itu gaya tarik antar benda, basically." };
        },
        reset: () => true
    });
    const replies = [];
    const message = {
        author: { bot: false, id: "234567890123456789" },
        guild: { id: guildId },
        content: "Castorice, bro jelasin gravity dong in simple words",
        mentions: { users: { has: () => false } },
        reply: async payload => replies.push(payload),
        channel: { id: "345678901234567890" }
    };

    await handlers.get(Events.MessageCreate)(message);

    assert.equal(calls[0].text, "bro jelasin gravity dong in simple words");
    assert.match(replies[0].content, /Gravitasi itu gaya tarik/);
});

test("Gemini failures return an honest message and log only sanitized diagnostics", async t => {
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));
    await setFeatureEnabled(guildId, "ai_chat", true);
    const errors = [];
    const handlers = registerHandlers({
        respond: async () => {
            throw Object.assign(new Error("secret payload and user conversation"), {
                code: "timeout",
                statusCode: 503,
                operation: "generate"
            });
        },
        reset: () => true
    }, {
        error: (...args) => errors.push(args)
    });
    const replies = [];
    const message = {
        author: { bot: false, id: "234567890123456789" },
        guild: { id: guildId },
        content: "Castorice: answer this free question",
        mentions: { users: { has: () => false } },
        reply: async payload => replies.push(payload),
        channel: { id: "345678901234567890" }
    };

    await handlers.get(Events.MessageCreate)(message);

    assert.match(replies[0].content, /Gemini tidak merespons tepat waktu/);
    assert.doesNotMatch(replies[0].content, /secret payload|user conversation/);
    assert.deepEqual(errors[0], ["[Gemini AI Error]", {
        provider: "gemini",
        operation: "generate",
        statusCode: 503,
        category: "timeout"
    }]);
});

test("conversation reset is available even when AI chat is disabled", async t => {
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));
    let resetRequest;
    const handlers = registerHandlers({
        respond: async () => ({ text: "unused" }),
        reset: request => {
            resetRequest = request;
            return true;
        }
    });
    const replies = [];
    const channelId = "345678901234567890";
    const message = {
        author: { bot: false, id: "234567890123456789" },
        guild: { id: guildId },
        content: "Castorice: reset percakapan",
        mentions: { users: { has: () => false } },
        reply: async payload => replies.push(payload),
        channel: { id: channelId }
    };

    await handlers.get(Events.MessageCreate)(message);

    assert.deepEqual(resetRequest, { guildId, userId: message.author.id, channelId });
    assert.match(replies[0].content, /channel ini telah dihapus/);
});

test("AI chat does not call the provider before a guild enables the feature", async t => {
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));
    await setFeatureEnabled(guildId, "ai_chat", false);
    let called = false;
    const handlers = registerHandlers({
        respond: async () => {
            called = true;
            return { text: "should not happen" };
        },
        reset: () => true
    });
    const replies = [];
    const message = {
        author: { bot: false, id: "234567890123456789" },
        guild: { id: guildId },
        content: "Castorice: tell me something",
        mentions: { users: { has: () => false } },
        reply: async payload => replies.push(payload)
    };

    await handlers.get(Events.MessageCreate)(message);

    assert.equal(called, false);
    assert.match(replies[0], /dinonaktifkan/);
});
