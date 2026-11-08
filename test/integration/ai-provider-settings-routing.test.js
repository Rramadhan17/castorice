const test = require("node:test");
const assert = require("node:assert/strict");
const { Events } = require("discord.js");
const registerInteractionHandler = require("../../src/events/interactionCreate");

const ownerId = "234567890123456789";
const guildId = `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;

function createHandler({ isOwner }) {
    const handlers = new Map();
    const client = {
        user: { id: "123456789012345678" },
        on: (event, handler) => handlers.set(event, handler)
    };
    const globalSettings = { enabled: true };
    const aiProvider = { generate: async () => ({ text: "unused" }) };
    registerInteractionHandler(client, {
        aiProvider,
        aiConversationService: { respond: async () => ({ text: "unused" }), reset: () => true },
        globalAISettings: {
            getSettings: async () => ({ ...globalSettings }),
            setEnabled: async enabled => {
                globalSettings.enabled = enabled;
                return { ...globalSettings };
            }
        },
        isOwner
    });
    return {
        handler: handlers.get(Events.MessageCreate),
        globalSettings
    };
}

function makeMessage(userId, content, { dmFails = false } = {}) {
    const replies = [];
    const dms = [];
    const author = {
        id: userId,
        bot: false,
        send: async payload => {
            if (dmFails) throw new Error("DM unavailable");
            dms.push(payload);
        }
    };
    return {
        replies,
        dms,
        message: {
            author,
            guild: { id: guildId },
            content,
            mentions: { users: { has: () => false } },
            reply: async payload => replies.push(payload)
        }
    };
}

test("owner can privately inspect the single Gemini provider status", async () => {
    const { handler } = createHandler({ isOwner: id => id === ownerId });
    const status = makeMessage(ownerId, "Castorice: status provider AI");

    await handler(status.message);

    assert.match(status.dms[0].content, /Gemini: dikonfigurasi/);
    assert.match(status.dms[0].content, /belum diverifikasi live/);
    assert.deepEqual(status.dms[0].allowedMentions, { parse: [] });
    assert.equal(status.replies.length, 0);
    assert.doesNotMatch(status.dms[0].content, /OpenAI|OpenRouter|failover|priority/i);
});

test("non-owner cannot inspect global Gemini status", async () => {
    const { handler } = createHandler({ isOwner: id => id === ownerId });
    const request = makeMessage("334567890123456789", "Castorice: provider AI status");

    await handler(request.message);

    assert.equal(request.dms.length, 0);
    assert.match(request.replies[0].content, /hanya dapat dilihat oleh pemilik/i);
});

test("owner status remains private when DMs are unavailable", async () => {
    const { handler } = createHandler({ isOwner: id => id === ownerId });
    const request = makeMessage(ownerId, "Castorice: status provider AI", { dmFails: true });

    await handler(request.message);

    assert.equal(request.dms.length, 0);
    assert.equal(request.replies.length, 1);
    assert.match(request.replies[0].content, /hanya ditampilkan lewat DM/i);
    assert.doesNotMatch(request.replies[0].content, /Gemini|OpenAI|OpenRouter|failover/i);
});
