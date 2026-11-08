const {
    MessageFlags,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js");
const { buildDashboard } = require("../dashboard/menu-panel");
const { parseDuration, formatDuration } = require("./center-tag-router");

const PAGE_SIZE = 10;

function isAdmin(guild, member, ownerId) {
    return Boolean(
        member?.id &&
        (String(member.id) === String(guild.ownerId) ||
            (ownerId && String(member.id) === String(ownerId)) ||
            member.permissions?.has?.(PermissionFlagsBits.ManageGuild))
    );
}

function button(id, label, style = ButtonStyle.Secondary) {
    return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}

function buildVoiceCenterPanel({ guild, config, timer, canManage, section = "home", page = 0, notice = "" }) {
    const auto = config.autoKick;
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle("Castorice | Voice AI Center");
    const rows = [];
    const addRow = (...components) => rows.push(new ActionRowBuilder().addComponents(...components));

    if (section === "home") {
        embed.setDescription([
            notice,
            `**Auto Kick Voice:** ${auto.enabled ? "ON" : "OFF"} (default OFF)`,
            `**Grace period:** ${formatDuration(auto.gracePeriodMs)}`,
            `**Protected channels:** ${config.protectedVoiceChannelIds.length}`,
            `**Trusted members / roles:** ${config.trustedMemberIds.length} / ${config.trustedRoleIds.length}`,
            `**Voice timer:** ${timer ? `${formatDuration(timer.remainingMs)} remaining in <#${timer.channelId}>` : "inactive"}`,
            `**Active session:** ${guild.members?.me?.voice?.channel ? `<#${guild.members.me.voice.channelId}>` : "disconnected"}`
        ].filter(Boolean).join("\n"));
        if (canManage) {
            addRow(
                button("voicecenter:auto_toggle", `Auto Kick ${auto.enabled ? "OFF" : "ON"}`, auto.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
                button("voicecenter:grace_modal", "Grace period"),
                button("voicecenter:trusted", "Trusted Members")
            );
            addRow(
                button("voicecenter:roles", "Trusted Roles"),
                button("voicecenter:channels", "Protected Channels"),
                button("voicecenter:timer", "Disconnect Timer")
            );
            addRow(
                button("voicecenter:session", "Active Voice Session"),
                button("voicecenter:logs:0", "Activity Logs"),
                button("voicecenter:back", "Back to Dashboard", ButtonStyle.Primary)
            );
        } else {
            addRow(
                button("voicecenter:session", "Active Voice Session"),
                button("voicecenter:back", "Back to Dashboard", ButtonStyle.Primary)
            );
        }
    } else if (section === "trusted") {
        const ids = config.trustedMemberIds;
        const start = page * PAGE_SIZE;
        const text = ids.slice(start, start + PAGE_SIZE).map((id, index) => `${start + index + 1}. <@${id}>`).join("\n") || "Belum ada trusted member.";
        embed.setDescription(`${notice ? `${notice}\n\n` : ""}**Trusted Members** (${ids.length})\n${text}`);
        if (canManage) {
            addRow(
                button("voicecenter:trusted_add_modal", "Tambah Member", ButtonStyle.Success),
                button("voicecenter:trusted_remove_modal", "Hapus Member", ButtonStyle.Danger),
                button("voicecenter:trusted_check_modal", "Check Status"),
                button("voicecenter:trusted_clear", "Clear List", ButtonStyle.Danger)
            );
        }
        addRow(
            ...(page > 0 ? [button(`voicecenter:trusted_page:${page - 1}`, "Previous")] : []),
            ...(start + PAGE_SIZE < ids.length ? [button(`voicecenter:trusted_page:${page + 1}`, "Next")] : []),
            button("voicecenter:home", "Back")
        );
    } else if (section === "roles") {
        const roleIds = config.trustedRoleIds;
        const exemptIds = auto.exemptRoleIds;
        const roleStart = page * PAGE_SIZE;
        embed.setDescription([
            notice,
            `**Trusted Roles (${roleIds.length}):** ${roleIds.slice(roleStart, roleStart + PAGE_SIZE).map(id => `<@&${id}>`).join(", ") || "none"}`,
            `**Auto Kick exemptions (${exemptIds.length}):** ${exemptIds.slice(roleStart, roleStart + PAGE_SIZE).map(id => `<@&${id}>`).join(", ") || "none"}`,
            `Admins exempt: ${auto.exemptAdmins ? "yes" : "no"} · Server owner exempt: ${auto.exemptOwner ? "yes" : "no"}`
        ].filter(Boolean).join("\n"));
        if (canManage) {
            addRow(
                button("voicecenter:trusted_role_add_modal", "Add Trusted Role", ButtonStyle.Success),
                button("voicecenter:trusted_role_remove_modal", "Remove Trusted Role", ButtonStyle.Danger)
            );
            addRow(
                button("voicecenter:exempt_role_add_modal", "Add Auto Kick Exemption"),
                button("voicecenter:exempt_role_remove_modal", "Remove Exemption", ButtonStyle.Danger)
            );
            addRow(
                button("voicecenter:exempt_admins_toggle", `Admins ${auto.exemptAdmins ? "Exempt" : "Included"}`),
                button("voicecenter:exempt_owner_toggle", `Owner ${auto.exemptOwner ? "Exempt" : "Included"}`)
            );
        }
        addRow(
            ...(page > 0 ? [button(`voicecenter:roles_page:${page - 1}`, "Previous")] : []),
            ...(roleStart + PAGE_SIZE < Math.max(roleIds.length, exemptIds.length) ? [button(`voicecenter:roles_page:${page + 1}`, "Next")] : []),
            button("voicecenter:home", "Back")
        );
    } else if (section === "channels") {
        const ids = config.protectedVoiceChannelIds;
        const start = page * PAGE_SIZE;
        const text = ids.slice(start, start + PAGE_SIZE).map((id, index) => `${start + index + 1}. <#${id}>`).join("\n") || "Belum ada protected voice channel.";
        embed.setDescription(`${notice ? `${notice}\n\n` : ""}**Protected Voice Channels** (${ids.length})\n${text}`);
        if (canManage) {
            addRow(
                button("voicecenter:channel_add_modal", "Protect Channel", ButtonStyle.Success),
                button("voicecenter:channel_remove_modal", "Unprotect Channel", ButtonStyle.Danger)
            );
        }
        addRow(
            ...(page > 0 ? [button(`voicecenter:channels_page:${page - 1}`, "Previous")] : []),
            ...(start + PAGE_SIZE < ids.length ? [button(`voicecenter:channels_page:${page + 1}`, "Next")] : []),
            button("voicecenter:home", "Back")
        );
    } else if (section === "timer") {
        embed.setDescription([
            notice,
            timer
                ? `Timer aktif untuk <#${timer.channelId}> · sisa ${formatDuration(timer.remainingMs)}.`
                : "Tidak ada timer voice aktif.",
            "Timer hanya mengakhiri sesi Castorice yang sama pada server ini."
        ].filter(Boolean).join("\n"));
        if (canManage) {
            addRow(
                button("voicecenter:timer_set_modal", "Start / Set Timer", ButtonStyle.Success),
                button("voicecenter:timer_extend_modal", "Extend Timer"),
                button("voicecenter:timer_reset", "Reset Timer")
            );
            addRow(
                button("voicecenter:timer_cancel", "Cancel Timer", ButtonStyle.Danger),
                button("voicecenter:home", "Back")
            );
        } else {
            addRow(button("voicecenter:home", "Back"));
        }
    } else if (section === "session") {
        const channelId = guild.members?.me?.voice?.channelId;
        embed.setDescription([
            notice,
            `Status: ${channelId ? `connected to <#${channelId}>` : "disconnected"}`,
            `Voice timer: ${timer ? `${formatDuration(timer.remainingMs)} remaining` : "inactive"}`
        ].filter(Boolean).join("\n"));
        addRow(button("voicecenter:home", "Back"));
    } else if (section === "logs") {
        const events = config.activity;
        const start = page * PAGE_SIZE;
        const text = events.slice(start, start + PAGE_SIZE).map(event =>
            `• <t:${Math.floor(event.at / 1000)}:R> **${event.type}** — ${event.detail}`
        ).join("\n") || "Belum ada activity log.";
        embed.setDescription(`${notice ? `${notice}\n\n` : ""}**Activity Logs** (${events.length})\n${text}`);
        addRow(
            ...(page > 0 ? [button(`voicecenter:logs:${page - 1}`, "Previous")] : []),
            ...(start + PAGE_SIZE < events.length ? [button(`voicecenter:logs:${page + 1}`, "Next")] : []),
            button("voicecenter:home", "Back")
        );
    } else if (section === "confirm_clear") {
        embed.setDescription("Konfirmasi untuk menghapus seluruh trusted member dan trusted role server ini.");
        addRow(
            button("voicecenter:clear_confirm", "Confirm Clear", ButtonStyle.Danger),
            button("voicecenter:trusted", "Cancel")
        );
    }

    embed.setFooter({ text: "Perubahan Voice AI Center dibatasi ke server ini." });
    return { embeds: [embed], components: rows };
}

function makeModal(id, title, label, placeholder = "Discord ID", maxLength = 20) {
    return new ModalBuilder()
        .setCustomId(`voicecenter:${id}_submit`)
        .setTitle(title)
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("value")
                .setLabel(label)
                .setPlaceholder(placeholder)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(maxLength)
        ));
}

function createVoiceCenterInteractionHandler({ service, ownerId = null, logger = console } = {}) {
    if (!service) throw new TypeError("Voice Center service wajib diisi.");

    async function render(interaction, section = "home", page = 0, notice = "") {
        const config = await service.getConfig(interaction.guild.id);
        const timer = await service.getVoiceTimer(interaction.guild);
        const canManage = isAdmin(interaction.guild, interaction.member, ownerId);
        await interaction.update(buildVoiceCenterPanel({
            guild: interaction.guild, config, timer, canManage, section, page, notice
        }));
    }

    return async function handleVoiceCenterInteraction(interaction) {
        const customId = interaction.customId;
        if (!customId?.startsWith("voicecenter:")) return false;
        if (!interaction.guild) {
            await interaction.reply({ content: "Voice AI Center hanya tersedia di server.", flags: MessageFlags.Ephemeral });
            return true;
        }

        const [, action, arg] = customId.split(":");
        let actor = interaction.member;
        if (!actor?.guild && interaction.guild.members?.fetch) {
            actor = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        }
        const requireAdmin = () => {
            if (!service.isAuthorized(interaction.guild, actor)) {
                throw new Error("Hanya pemilik server atau administrator dengan izin Manage Server yang dapat mengubah Voice AI Center.");
            }
        };
        try {
            if (action === "open") {
                await interaction.reply({
                    ...buildVoiceCenterPanel({
                        guild: interaction.guild,
                        config: await service.getConfig(interaction.guild.id),
                        timer: await service.getVoiceTimer(interaction.guild),
                        canManage: isAdmin(interaction.guild, actor, ownerId)
                    }),
                    flags: MessageFlags.Ephemeral
                });
            } else if (action === "home") {
                await render(interaction, "home");
            } else if (action === "back") {
                await interaction.update(buildDashboard(interaction.guild));
            } else if (action === "auto_toggle") {
                requireAdmin();
                const config = await service.getConfig(interaction.guild.id);
                await service.configureAutoKick(interaction.guild, actor, { enabled: !config.autoKick.enabled });
                await render(interaction, "home", 0, `Auto Kick Voice ${config.autoKick.enabled ? "dinonaktifkan" : "diaktifkan"}.`);
            } else if (action === "exempt_admins_toggle" || action === "exempt_owner_toggle") {
                requireAdmin();
                const config = await service.getConfig(interaction.guild.id);
                const field = action === "exempt_admins_toggle" ? "exemptAdmins" : "exemptOwner";
                const enabled = !config.autoKick[field];
                await service.configureAutoKick(interaction.guild, actor, { [field]: enabled });
                await render(interaction, "roles", 0, `${field === "exemptAdmins" ? "Pengecualian admin" : "Pengecualian owner"} ${enabled ? "diaktifkan" : "dinonaktifkan"}.`);
            } else if (action === "grace_modal") {
                requireAdmin();
                await interaction.showModal(makeModal("grace", "Atur Grace Period", "Durasi", "Contoh: 30 detik atau 2 menit", 32));
            } else if (action.endsWith("_modal")) {
                requireAdmin();
                const modals = {
                    trusted_add_modal: ["trusted_add", "Tambah Trusted Member", "Discord user ID"],
                    trusted_remove_modal: ["trusted_remove", "Hapus Trusted Member", "Discord user ID"],
                    trusted_check_modal: ["trusted_check", "Check Trusted Status", "Discord user ID"],
                    trusted_role_add_modal: ["trusted_role_add", "Tambah Trusted Role", "Discord role ID"],
                    trusted_role_remove_modal: ["trusted_role_remove", "Hapus Trusted Role", "Discord role ID"],
                    exempt_role_add_modal: ["exempt_role_add", "Tambah Auto Kick Exemption", "Discord role ID"],
                    exempt_role_remove_modal: ["exempt_role_remove", "Hapus Auto Kick Exemption", "Discord role ID"],
                    channel_add_modal: ["channel_add", "Protect Voice Channel", "Discord voice channel ID"],
                    channel_remove_modal: ["channel_remove", "Unprotect Voice Channel", "Discord voice channel ID"],
                    timer_set_modal: ["timer_set", "Set Voice Disconnect Timer", "Durasi", "Contoh: 15 menit atau 1 jam", 32],
                    timer_extend_modal: ["timer_extend", "Extend Voice Disconnect Timer", "Durasi tambahan", "Contoh: 10 menit", 32]
                };
                const values = modals[action];
                await interaction.showModal(makeModal(...values));
            } else if (["trusted", "roles", "channels"].includes(action)) {
                requireAdmin();
                await render(interaction, action);
            } else if (action === "timer" || action === "session") {
                await render(interaction, action);
            } else if (action === "trusted_page" || action === "roles_page" || action === "channels_page" || action === "logs") {
                requireAdmin();
                const section = action === "trusted_page"
                    ? "trusted"
                    : action === "roles_page"
                        ? "roles"
                        : action === "channels_page"
                            ? "channels"
                            : "logs";
                await render(interaction, section, Number(arg) || 0);
            } else if (action === "trusted_clear") {
                requireAdmin();
                const config = await service.getConfig(interaction.guild.id);
                const timer = await service.getVoiceTimer(interaction.guild);
                await interaction.update(buildVoiceCenterPanel({
                    guild: interaction.guild, config, timer, canManage: true, section: "confirm_clear"
                }));
            } else if (action === "clear_confirm" || action === "ai_clear_confirm") {
                requireAdmin();
                if (action === "ai_clear_confirm" && arg !== interaction.user.id) {
                    await interaction.reply({ content: "Hanya peminta yang dapat mengonfirmasi aksi ini.", flags: MessageFlags.Ephemeral });
                    return true;
                }
                await service.clearTrustedMembers(interaction.guild, actor);
                if (action === "ai_clear_confirm") {
                    await interaction.update({
                        content: "Trusted member dan role server ini sudah dihapus.",
                        embeds: [],
                        components: []
                    });
                } else {
                    await render(interaction, "trusted", 0, "Trusted member dan role sudah dihapus.");
                }
            } else if (action === "ai_clear_cancel") {
                await interaction.update({ content: "Penghapusan dibatalkan.", components: [] });
            } else if (action === "timer_reset" || action === "timer_cancel") {
                requireAdmin();
                if (action === "timer_reset") await service.resetVoiceTimer(interaction.guild, actor);
                else await service.cancelVoiceTimer(interaction.guild, actor);
                await render(interaction, "timer");
            } else if (interaction.isModalSubmit?.() && action.endsWith("_submit")) {
                requireAdmin();
                const value = interaction.fields.getTextInputValue("value").trim();
                if (action === "grace_submit") {
                    const durationMs = parseDuration(value);
                    if (!Number.isInteger(durationMs)) throw new Error("Durasi tidak valid. Contoh: 30 detik atau 2 menit.");
                    await service.configureAutoKick(interaction.guild, actor, { gracePeriodMs: durationMs });
                    await render(interaction, "home", 0, `Grace period diatur ke ${formatDuration(durationMs)}.`);
                } else if (action === "timer_set_submit" || action === "timer_extend_submit") {
                    const durationMs = parseDuration(value);
                    if (!Number.isInteger(durationMs)) throw new Error("Durasi tidak valid. Contoh: 15 menit atau 1 jam.");
                    if (action === "timer_set_submit") await service.setVoiceTimer(interaction.guild, actor, durationMs);
                    else await service.extendVoiceTimer(interaction.guild, actor, durationMs);
                    await render(interaction, "timer");
                } else {
                    const id = value.match(/\d{17,20}/)?.[0];
                    if (!id) throw new Error("Discord ID tidak valid.");
                    if (action === "trusted_check_submit") {
                        const status = await service.checkMemberStatus(interaction.guild, id);
                        await render(interaction, "trusted", 0, `<@${status.memberId}> ${status.trusted ? "terdaftar sebagai trusted." : "belum terdaftar sebagai trusted."}`);
                    } else if (action === "trusted_add_submit") await service.addTrustedMember(interaction.guild, actor, id);
                    else if (action === "trusted_remove_submit") await service.removeTrustedMember(interaction.guild, actor, id);
                    else if (action === "trusted_role_add_submit") await service.addTrustedRole(interaction.guild, actor, id);
                    else if (action === "trusted_role_remove_submit") await service.removeTrustedRole(interaction.guild, actor, id);
                    else if (action === "exempt_role_add_submit") await service.addExemptRole(interaction.guild, actor, id);
                    else if (action === "exempt_role_remove_submit") await service.removeExemptRole(interaction.guild, actor, id);
                    else if (action === "channel_add_submit") await service.addProtectedChannel(interaction.guild, actor, id);
                    else if (action === "channel_remove_submit") await service.removeProtectedChannel(interaction.guild, actor, id);
                    await render(interaction, action.startsWith("trusted_") ? "trusted" : action.startsWith("channel_") ? "channels" : "roles");
                }
            } else {
                await interaction.reply({ content: "Aksi Voice AI Center tidak dikenali.", flags: MessageFlags.Ephemeral });
            }
        } catch (error) {
            logger.warn?.("[Voice Center Interaction Error]", {
                guildId: String(interaction.guild.id),
                action,
                code: error?.code ?? "request_failed"
            });
            const response = { content: error.message || "Voice AI Center gagal memproses aksi.", flags: MessageFlags.Ephemeral };
            if (interaction.replied || interaction.deferred) await interaction.followUp(response);
            else if (interaction.isModalSubmit?.()) await interaction.reply(response);
            else await interaction.reply(response);
        }
        return true;
    };
}

module.exports = {
    buildVoiceCenterPanel,
    createVoiceCenterInteractionHandler,
    isAdmin
};
