const { playTtsGreeting } = require("./greeter-tts");

class VoiceAIError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "VoiceAIError";
        this.code = code;
    }
}

function createVoiceAIService({
    conversationService,
    ttsProvider = null,
    loadTtsProvider = () => null,
    playback = playTtsGreeting,
    runtime = {}
} = {}) {
    if (!conversationService || typeof conversationService.respond !== "function") {
        throw new TypeError("AI conversation service is required.");
    }
    if (typeof loadTtsProvider !== "function" || typeof playback !== "function") {
        throw new TypeError("TTS provider loader and playback function must be callable.");
    }

    async function respondAndSpeak({ guild, member, text }) {
        if (!guild?.id || !member?.id || String(member.guild?.id) !== String(guild.id)) {
            throw new VoiceAIError("invalid_context", "Anggota dan server tidak valid.");
        }
        if (member.user?.bot) {
            throw new VoiceAIError("bot_member", "Voice AI hanya tersedia untuk anggota manusia.");
        }
        const channel = member.voice?.channel;
        if (!channel?.id || String(channel.guildId ?? channel.guild?.id) !== String(guild.id)) {
            throw new VoiceAIError("not_in_voice", "Masuk ke voice channel server ini terlebih dahulu.");
        }

        const provider = ttsProvider || loadTtsProvider();
        if (!provider || typeof provider.synthesize !== "function") {
            throw new VoiceAIError(
                "tts_not_configured",
                "Voice AI memerlukan provider TTS di VOICE_GREETER_TTS_MODULE."
            );
        }

        const answer = await conversationService.respond({
            guildId: guild.id,
            userId: member.id,
            text
        });
        const playbackResult = await playback({
            guild,
            channel,
            member,
            text: answer.text,
            provider,
            runtime
        });

        return {
            text: answer.text,
            spoken: playbackResult?.spoken === true,
            reason: playbackResult?.reason || null,
            usage: answer.usage ?? null
        };
    }

    return { respondAndSpeak };
}

module.exports = { VoiceAIError, createVoiceAIService };
