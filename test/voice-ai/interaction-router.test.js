const test = require("node:test");
const assert = require("node:assert/strict");
const {
    parseVoiceAIIntent,
    createVoiceAITagRouter
} = require("../../src/voice-ai/interaction-router");

test("Voice AI parser recognizes explicit speech requests without consuming other intents", () => {
    assert.deepEqual(parseVoiceAIIntent("voice ai what is a black hole"), {
        text: "what is a black hole"
    });
    assert.deepEqual(parseVoiceAIIntent("Jawab pakai suara: jelaskan musik"), {
        text: "jelaskan musik"
    });
    assert.deepEqual(parseVoiceAIIntent("ucapkan selamat datang"), {
        text: "selamat datang"
    });
    assert.equal(parseVoiceAIIntent("buat voice private bernama Team"), null);
    assert.equal(parseVoiceAIIntent("what is a black hole"), null);
    assert.equal(parseVoiceAIIntent("voice ai"), null);
});

test("Voice AI tag router checks the guild feature before invoking the service", async () => {
    let calls = 0;
    const replies = [];
    const route = createVoiceAITagRouter({
        service: { respondAndSpeak: async () => { calls += 1; } },
        featureGuard: async (_guildId, featureId) => ({
            allowed: false,
            reason: `${featureId} disabled`
        })
    });
    const handled = await route({
        message: {
            guild: { id: "12345678901234567" },
            reply: async payload => replies.push(payload)
        },
        commandText: "voice ai say hello"
    });

    assert.equal(handled, true);
    assert.equal(calls, 0);
    assert.equal(replies[0].content, "voice_ai disabled");
    assert.deepEqual(replies[0].allowedMentions, { parse: [] });
});

test("Voice AI tag router reports text-only playback accurately", async () => {
    const replies = [];
    const route = createVoiceAITagRouter({
        service: {
            respondAndSpeak: async () => ({
                text: "A spoken response",
                spoken: false,
                reason: "voice_busy"
            })
        },
        featureGuard: async () => ({ allowed: true })
    });
    await route({
        message: {
            guild: { id: "12345678901234567" },
            member: { id: "22345678901234567" },
            reply: async payload => replies.push(payload)
        },
        commandText: "voice ai tell me a story"
    });

    assert.match(replies[0].content, /A spoken response/);
    assert.match(replies[0].content, /audio tidak dapat diputar \(voice_busy\)/);
});
