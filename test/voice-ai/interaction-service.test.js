const test = require("node:test");
const assert = require("node:assert/strict");
const { VoiceAIError, createVoiceAIService } = require("../../src/voice-ai/interaction-service");

function makeContext() {
    const guild = { id: "12345678901234567" };
    const channel = { id: "22345678901234567", guildId: guild.id };
    const member = {
        id: "32345678901234567",
        guild,
        user: { bot: false },
        voice: { channel }
    };
    return { guild, channel, member };
}

test("Voice AI generates a guild/user response and speaks it through the TTS playback service", async () => {
    const context = makeContext();
    const calls = [];
    const service = createVoiceAIService({
        conversationService: {
            respond: async request => {
                calls.push(["respond", request]);
                return { text: "Jawaban suara", usage: { totalTokens: 8 } };
            }
        },
        ttsProvider: { synthesize: async () => Buffer.from("audio") },
        playback: async request => {
            calls.push(["playback", request]);
            return { spoken: true };
        }
    });

    const result = await service.respondAndSpeak({
        ...context,
        text: "Apa kabar?"
    });

    assert.deepEqual(result, {
        text: "Jawaban suara",
        spoken: true,
        reason: null,
        usage: { totalTokens: 8 }
    });
    assert.deepEqual(calls[0], ["respond", {
        guildId: context.guild.id,
        userId: context.member.id,
        text: "Apa kabar?"
    }]);
    assert.equal(calls[1][1].channel, context.channel);
    assert.equal(calls[1][1].text, "Jawaban suara");
});

test("Voice AI validates guild and voice membership before calling AI or TTS", async () => {
    let aiCalls = 0;
    let providerLoads = 0;
    const service = createVoiceAIService({
        conversationService: { respond: async () => { aiCalls += 1; return { text: "answer" }; } },
        loadTtsProvider: () => { providerLoads += 1; return { synthesize: async () => Buffer.from("audio") }; },
        playback: async () => ({ spoken: true })
    });
    const context = makeContext();

    await assert.rejects(
        service.respondAndSpeak({
            ...context,
            member: { ...context.member, voice: { channel: null } },
            text: "hello"
        }),
        error => error instanceof VoiceAIError && error.code === "not_in_voice"
    );
    await assert.rejects(
        service.respondAndSpeak({
            ...context,
            member: { ...context.member, guild: { id: "42345678901234567" } },
            text: "hello"
        }),
        error => error.code === "invalid_context"
    );
    assert.equal(aiCalls, 0);
    assert.equal(providerLoads, 0);
});

test("Voice AI requires a real TTS provider and preserves safe no-interruption playback result", async () => {
    const context = makeContext();
    let aiCalls = 0;
    const unconfigured = createVoiceAIService({
        conversationService: { respond: async () => { aiCalls += 1; return { text: "answer" }; } }
    });
    await assert.rejects(
        unconfigured.respondAndSpeak({ ...context, text: "hello" }),
        error => error instanceof VoiceAIError && error.code === "tts_not_configured"
    );
    assert.equal(aiCalls, 0);

    const busy = createVoiceAIService({
        conversationService: { respond: async () => ({ text: "answer" }) },
        ttsProvider: { synthesize: async () => Buffer.from("audio") },
        playback: async () => ({ spoken: false, reason: "voice_busy" })
    });
    assert.deepEqual(
        await busy.respondAndSpeak({ ...context, text: "hello" }),
        { text: "answer", spoken: false, reason: "voice_busy", usage: null }
    );
});
