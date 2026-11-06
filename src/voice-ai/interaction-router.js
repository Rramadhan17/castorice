const { checkFeature } = require("../core/feature-guard");

const VOICE_AI_TRIGGER = /^(?:voice\s+ai|ai\s+voice|jawab\s+(?:dengan|pakai)\s+suara|bicara|ucapkan|katakan)\s*[:,;]?\s+(.+)$/i;

function parseVoiceAIIntent(input) {
    if (typeof input !== "string") return null;
    const match = input.trim().match(VOICE_AI_TRIGGER);
    if (!match) return null;
    const text = match[1].trim();
    return text ? { text } : null;
}

function createVoiceAITagRouter({
    service,
    featureGuard = checkFeature,
    logger = console
} = {}) {
    if (!service || typeof service.respondAndSpeak !== "function") {
        throw new TypeError("Voice AI service is required.");
    }

    return async function routeVoiceAITag({ message, commandText }) {
        if (!message?.guild) return false;
        const intent = parseVoiceAIIntent(commandText);
        if (!intent) return false;

        const feature = await featureGuard(message.guild.id, "voice_ai");
        if (!feature.allowed) {
            await message.reply({
                content: feature.reason,
                allowedMentions: { parse: [] }
            });
            return true;
        }

        try {
            const member = message.member ||
                await message.guild.members.fetch(message.author.id);
            const result = await service.respondAndSpeak({
                guild: message.guild,
                member,
                text: intent.text
            });
            const content = result.spoken
                ? `🔊 ${result.text}`
                : `${result.text}\n\n⚠️ Jawaban teks tersedia, tetapi audio tidak dapat diputar (${result.reason || "playback_failed"}).`;
            await message.reply({
                content,
                allowedMentions: { parse: [] }
            });
        } catch (error) {
            logger.error?.("[Voice AI Error]", error.code || error.name || "unknown");
            const messages = {
                not_in_voice: "Masuk ke voice channel server ini terlebih dahulu.",
                tts_not_configured: "Voice AI memerlukan provider TTS yang dikonfigurasi melalui VOICE_GREETER_TTS_MODULE.",
                not_configured: "AI belum dikonfigurasi. Admin bot perlu mengisi AI_API_KEY dan AI_MODEL.",
                rate_limited: "Tunggu sebentar sebelum meminta jawaban AI berikutnya.",
                busy: "Castorice masih memproses permintaanmu. Coba lagi sebentar.",
                input_too_long: error.message,
                invalid_context: error.message,
                bot_member: error.message
            };
            await message.reply({
                content: messages[error.code] || "Voice AI gagal memproses permintaan. Periksa konfigurasi provider dan coba lagi.",
                allowedMentions: { parse: [] }
            });
        }
        return true;
    };
}

module.exports = {
    parseVoiceAIIntent,
    createVoiceAITagRouter
};
