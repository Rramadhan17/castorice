const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits
} = require("discord.js");
const { checkFeature } = require("../core/feature-guard");

function isGreeterConfigurationIntent(input) {
    const text = String(input || "").trim().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
    return /^(?:configure|config|atur|ubah|set|ganti)\s+(?:(?:pesan|message|greeting|sambutan)\s+)?(?:voice\s+)?greeter(?:\s+(?:pesan|message|greeting|sambutan))?$/i.test(text);
}

function createVoiceGreeterTagRouter({ featureGuard = checkFeature, logger = console } = {}) {
    return async function routeVoiceGreeterTag({ message, commandText } = {}) {
        if (!isGreeterConfigurationIntent(commandText)) return false;
        if (!message?.guild) {
            await message?.reply?.("Voice Greeter hanya dapat diatur di server.");
            return true;
        }

        const reply = async content => message.reply({
            content: String(content).replace(/@/g, "@\u200b"),
            allowedMentions: { parse: [] }
        });

        const feature = await featureGuard(message.guild.id, "voice_greeter");
        if (!feature.allowed) {
            await reply(feature.reason);
            return true;
        }

        try {
            const member = await message.guild.members.fetch(message.author.id);
            if (!member.permissions?.has(PermissionFlagsBits.ManageGuild)) {
                await reply("Kamu membutuhkan izin Manage Server untuk mengubah pesan Voice Greeter.");
                return true;
            }

            const components = [new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("castorice:greeter_configure")
                    .setLabel("Atur Pesan Sambutan")
                    .setStyle(ButtonStyle.Primary)
            )];
            await message.reply({
                content: "Buka dialog untuk mengatur pesan sambutan voice. Gunakan `{user}` untuk menyebut anggota; mention massal akan dinonaktifkan.",
                components,
                allowedMentions: { parse: [] }
            });
        } catch (error) {
            logger.error?.("[Voice Greeter Tag Error]", error);
            await reply(error.message || "Voice Greeter gagal membuka konfigurasi.");
        }
        return true;
    };
}

module.exports = {
    isGreeterConfigurationIntent,
    createVoiceGreeterTagRouter
};
