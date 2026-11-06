const {
    Events,
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js");

const { checkFeature } = require("../core/feature-guard");
const { buildDashboard } = require("../dashboard/menu-panel");

function buildVoicePanel(record = null) {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Castorice | Voice Manager")
        .setDescription(record
            ? `Temporary voice milikmu: <#${record.channelId}>\nStatus: ${record.isLocked ? "Private / locked" : "Public"} • Batas: ${record.userLimit || "Tidak terbatas"} anggota.`
            : "Buat temporary voice dari voice channel yang sedang kamu gunakan.")
        .setFooter({ text: "Setiap aksi memeriksa ulang pemilik dan guild." });

    const rows = [];
    if (record) {
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("voice:rename").setLabel("Rename").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("voice:limit").setLabel("Member Limit").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("voice:lock").setLabel(record.isLocked ? "Unlock" : "Lock").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("voice:transfer").setLabel("Transfer Owner").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("voice:delete").setLabel("Delete").setStyle(ButtonStyle.Danger)
        ));
    } else {
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("voice:create").setLabel("Create Temporary Voice").setStyle(ButtonStyle.Primary)
        ));
    }

    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("voice:dashboard").setLabel("Dashboard").setStyle(ButtonStyle.Secondary)
    ));

    return { embeds: [embed], components: rows };
}

function buildTextModal({ id, title, label, placeholder, maxLength, style = TextInputStyle.Short }) {
    const input = new TextInputBuilder()
        .setCustomId("value")
        .setLabel(label)
        .setStyle(style)
        .setRequired(true)
        .setMaxLength(maxLength);
    if (placeholder) input.setPlaceholder(placeholder);

    return new ModalBuilder()
        .setCustomId(`voice:${id}_submit`)
        .setTitle(title)
        .addComponents(new ActionRowBuilder().addComponents(input));
}

function createVoiceInteractions({
    service,
    stateStore,
    featureGuard = checkFeature,
    logger = console
}) {
    if (!service || !stateStore) throw new TypeError("Voice Manager service dan stateStore wajib diisi.");

    async function getRecord(guildId, userId) {
        const state = await stateStore.getGuildState(guildId);
        return Object.values(state.temporaryVoices || {}).find(record =>
            record.ownerId === userId && ["active", "deletion_pending"].includes(record.status)
        ) || null;
    }

    async function updatePanel(interaction, content = "") {
        const record = await getRecord(interaction.guild.id, interaction.user.id);
        await interaction.update({ ...buildVoicePanel(record), content });
    }

    return async function handleVoiceInteraction(interaction) {
        const customId = interaction.customId;
        if (!customId?.startsWith("voice:")) return false;

        try {
            if (!interaction.guild) {
                await interaction.reply({ content: "Voice Manager hanya tersedia di server.", flags: MessageFlags.Ephemeral });
                return true;
            }

            const feature = await featureGuard(interaction.guildId, "voice_manager");
            if (!feature.allowed) {
                await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                return true;
            }

            const action = customId.split(":")[1];
            if (action === "open") {
                const record = await getRecord(interaction.guild.id, interaction.user.id);
                await interaction.reply({ ...buildVoicePanel(record), flags: MessageFlags.Ephemeral });
                return true;
            }

            if (action === "dashboard") {
                await interaction.update(buildDashboard(interaction.guild));
                return true;
            }

            if (action === "rename") {
                await interaction.showModal(buildTextModal({
                    id: "rename",
                    title: "Rename Temporary Voice",
                    label: "Nama channel",
                    placeholder: "Maksimal 100 karakter",
                    maxLength: 100
                }));
                return true;
            }

            if (action === "limit") {
                await interaction.showModal(buildTextModal({
                    id: "limit",
                    title: "Atur Member Limit",
                    label: "Jumlah anggota (0 = tidak terbatas)",
                    placeholder: "0 sampai 99",
                    maxLength: 2
                }));
                return true;
            }

            if (action === "transfer") {
                await interaction.showModal(buildTextModal({
                    id: "transfer",
                    title: "Transfer Voice Ownership",
                    label: "Discord user ID anggota di channel ini",
                    placeholder: "17 sampai 20 digit",
                    maxLength: 20
                }));
                return true;
            }

            const member = await interaction.guild.members.fetch(interaction.user.id);
            if (action === "create") {
                await service.createTemporaryVoice(interaction.guild, interaction.guildId, member);
                await updatePanel(interaction, "Temporary voice berhasil dibuat dan kamu dipindahkan ke sana.");
                return true;
            }

            if (action === "lock") {
                const record = await getRecord(interaction.guild.id, interaction.user.id);
                if (!record) throw new Error("Temporary voice milikmu tidak ditemukan.");
                await service.setLocked(interaction.guild, interaction.guildId, member, !record.isLocked);
                await updatePanel(interaction, record.isLocked ? "Temporary voice dibuka." : "Temporary voice dikunci.");
                return true;
            }

            if (action === "delete") {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("voice:delete_confirm").setLabel("Confirm Delete").setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId("voice:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
                );
                await interaction.update({
                    content: "Hapus temporary voice milikmu? Anggota yang terhubung akan terputus.",
                    embeds: [],
                    components: [row]
                });
                return true;
            }

            if (action === "delete_confirm") {
                const expectedOwnerId = customId.split(":")[2];
                if (expectedOwnerId && expectedOwnerId !== interaction.user.id) {
                    await interaction.reply({
                        content: "Hanya pemilik voice yang dapat mengonfirmasi penghapusan ini.",
                        flags: MessageFlags.Ephemeral
                    });
                    return true;
                }
                await service.deleteOwned(interaction.guild, interaction.guildId, member);
                await interaction.update({ content: "Temporary voice telah dihapus.", embeds: [], components: [] });
                return true;
            }

            if (action === "cancel") {
                await updatePanel(interaction, "Penghapusan dibatalkan.");
                return true;
            }

            if (action.endsWith("_submit") && interaction.isModalSubmit()) {
                const value = interaction.fields.getTextInputValue("value").trim();
                if (action === "rename_submit") await service.rename(interaction.guild, interaction.guildId, member, value);
                else if (action === "limit_submit") {
                    if (!/^\d{1,2}$/.test(value)) throw new Error("Masukkan angka limit dari 0 sampai 99.");
                    await service.setLimit(interaction.guild, interaction.guildId, member, Number(value));
                } else if (action === "transfer_submit") {
                    await service.transfer(interaction.guild, interaction.guildId, member, value);
                } else return false;

                const record = await getRecord(interaction.guild.id, interaction.user.id);
                await interaction.reply({
                    ...buildVoicePanel(record),
                    content: "Pengaturan temporary voice berhasil diperbarui.",
                    flags: MessageFlags.Ephemeral
                });
                return true;
            }

            return false;
        } catch (error) {
            logger.error?.("[Voice Manager Interaction Error]", error);
            const response = { content: error.message || "Aksi Voice Manager gagal.", flags: MessageFlags.Ephemeral };
            if (interaction.replied || interaction.deferred) await interaction.followUp(response).catch(() => {});
            else await interaction.reply(response).catch(() => {});
            return true;
        }
    };
}

function registerVoiceManagerInteractions(client, options) {
    const handler = createVoiceInteractions(options);
    client.on(Events.InteractionCreate, handler);
    return handler;
}

module.exports = {
    buildVoicePanel,
    createVoiceInteractions,
    registerVoiceManagerInteractions
};
