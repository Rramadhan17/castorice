const {
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");
const { checkFeature } = require("../core/feature-guard");

function parseVoiceIntent(input) {
    const text = String(input || "").trim().replace(/[.!?]+$/g, "");
    let match;

    match = text.match(/^(?:buat|bikin|create)\s+(?:(?:temporary|temp)\s+)?voice(?:\s+(?:channel|sementara))?(?:\s+(private|pribadi))?(?:\s+(?:bernama|dengan\s+nama)\s+(.+))?$/i);
    if (match) {
        return {
            type: "create",
            privacy: match[1] ? "private" : undefined,
            name: cleanName(match[2])
        };
    }

    match = text.match(/^(?:ganti\s+nama|ubah\s+nama|rename)\s+(?:voice|channel)(?:\s+(?:saya|ini))?\s+(?:menjadi|jadi|to)\s+(.+)$/i) ||
        text.match(/^rename\s+(?:voice|channel)\s+(.+)$/i);
    if (match) return { type: "rename", name: cleanName(match[1]) };

    match = text.match(/^(?:atur|set|batasi)\s+(?:member\s+)?limit\s+(?:voice\s+)?(\d{1,2})$/i);
    if (match) return { type: "limit", value: Number(match[1]) };

    if (/^(?:kunci|lock)\s+(?:voice|channel)(?:\s+saya)?$/i.test(text)) {
        return { type: "lock", value: true };
    }
    if (/^(?:buka|unlock)\s+(?:voice|channel)(?:\s+saya)?$/i.test(text)) {
        return { type: "lock", value: false };
    }

    match = text.match(/^(?:transfer|pindahkan)\s+(?:owner|ownership|pemilik)(?:\s+voice)?\s+(?:ke|to)\s+(\d{17,20})$/i);
    if (match) return { type: "transfer", targetId: match[1] };

    if (/^(?:hapus|delete)\s+(?:temporary\s+)?(?:voice|channel)(?:\s+saya)?$/i.test(text)) {
        return { type: "delete" };
    }

    return null;
}

function cleanName(value) {
    if (!value) return undefined;
    return value.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
}

function buildDeleteConfirmation(ownerId) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`voice:delete_confirm:${ownerId}`)
            .setLabel("Confirm Delete")
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId("voice:cancel")
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary)
    )];
}

function createVoiceTagRouter({ service, stateStore, featureGuard = checkFeature, logger = console }) {
    if (!service || !stateStore) throw new TypeError("Voice Manager service dan stateStore wajib diisi.");

    return async function handleVoiceTag({ message, commandText }) {
        const intent = parseVoiceIntent(commandText);
        if (!intent) return false;

        if (!message.guild) {
            await message.reply("Voice Manager hanya tersedia di server.");
            return true;
        }

        const feature = await featureGuard(message.guild.id, "voice_manager");
        if (!feature.allowed) {
            await message.reply(feature.reason);
            return true;
        }

        try {
            const member = await message.guild.members.fetch(message.author.id);
            if (intent.type === "create") {
                const channel = await service.createTemporaryVoice(
                    message.guild,
                    message.guild.id,
                    member,
                    { name: intent.name, privacy: intent.privacy }
                );
                await message.reply({
                    content: `Temporary voice berhasil dibuat: <#${channel.id}>`,
                    allowedMentions: { parse: [] }
                });
            } else if (intent.type === "rename") {
                const channel = await service.rename(message.guild, message.guild.id, member, intent.name);
                await message.reply({ content: `Nama temporary voice diubah menjadi **${channel.name}**.`, allowedMentions: { parse: [] } });
            } else if (intent.type === "limit") {
                await service.setLimit(message.guild, message.guild.id, member, intent.value);
                await message.reply(`Member limit temporary voice diatur ke ${intent.value}.`);
            } else if (intent.type === "lock") {
                const state = await stateStore.getGuildState(message.guild.id);
                const record = Object.values(state.temporaryVoices || {}).find(item => item.ownerId === member.id);
                if (!record) throw new Error("Temporary voice milikmu tidak ditemukan.");
                await service.setLocked(message.guild, message.guild.id, member, intent.value);
                await message.reply(intent.value ? "Temporary voice dikunci." : "Temporary voice dibuka.");
            } else if (intent.type === "transfer") {
                await service.transfer(message.guild, message.guild.id, member, intent.targetId);
                await message.reply("Ownership temporary voice berhasil dipindahkan.");
            } else if (intent.type === "delete") {
                await message.reply({
                    content: "Hapus temporary voice milikmu? Anggota yang terhubung akan terputus.",
                    components: buildDeleteConfirmation(member.id),
                    allowedMentions: { parse: [] }
                });
            }

            return true;
        } catch (error) {
            logger.error?.("[Voice Manager Tag Error]", error);
            await message.reply(error.message || "Voice Manager gagal menjalankan permintaan.");
            return true;
        }
    };
}

module.exports = { parseVoiceIntent, createVoiceTagRouter };
