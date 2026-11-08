const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

function parseDuration(text) {
    const matches = [...String(text || "").matchAll(/(\d{1,4})\s*(detik|seconds?|secs?|menit|minutes?|mins?|jam|hours?|hrs?)/gi)];
    if (!matches.length) return null;
    return matches.reduce((total, match) => {
        const unit = match[2].toLowerCase();
        const multiplier = /^(?:detik|second|seconds|sec|secs)$/.test(unit)
            ? 1000
            : /^(?:jam|hour|hours|hr|hrs)$/.test(unit)
                ? 60 * 60 * 1000
                : 60 * 1000;
        return total + Number(match[1]) * multiplier;
    }, 0);
}

function mentionedId(collection) {
    if (!collection) return null;
    if (typeof collection.first === "function") return collection.first()?.id || null;
    const first = collection.values?.().next?.().value;
    return first?.id || null;
}

function isSelfTarget(value) {
    return /^(?:member ini|orang ini|pengguna ini|saya|aku|me|this member|this person|this user)$/i.test(value);
}

function parseVoiceCenterIntent(text, message) {
    const input = String(text || "").trim().replace(/[.!?]+$/g, "");
    let match;

    if (/^(?:status|cek|lihat)\s+auto\s*disconnect$/i.test(input)) return { action: "timer_status" };
    if (/^(?:matikan|batalkan|cancel|nonaktifkan)\s+auto\s*disconnect$/i.test(input)) {
        return { action: "timer_cancel" };
    }
    match = input.match(/^(?:(?:atur|set|jadwalkan)\s+)?auto\s*disconnect(?:\s+(.+))?$/i);
    if (match) {
        if (!match[1] || /^(?:status|cek|lihat)$/i.test(match[1].trim())) return { action: "timer_status" };
        if (/^(?:mati(?:kan)?|off|disable|nonaktif(?:kan)?|batal(?:kan)?|cancel)$/i.test(match[1].trim())) {
            return { action: "timer_cancel" };
        }
        return { action: "timer_set", durationMs: parseDuration(match[1]) };
    }

    if (/^(?:aktifkan|nyalakan|enable)\s+(?:auto\s*kick(?:\s+voice)?|kick\s+voice)$/i.test(input)) {
        return { action: "auto_toggle", enabled: true };
    }
    if (/^(?:nonaktifkan|matikan|disable)\s+(?:auto\s*kick(?:\s+voice)?|kick\s+voice)$/i.test(input)) {
        return { action: "auto_toggle", enabled: false };
    }
    if (/^(?:status|cek|lihat)\s+auto\s*kick(?:\s+voice)?$/i.test(input)) {
        return { action: "auto_status" };
    }
    match = input.match(/^(?:atur|set)\s+(?:grace\s*period|masa\s*tunggu)\s+(.+)$/i);
    if (match) return { action: "grace", durationMs: parseDuration(match[1]) };

    if (/^(?:daftar|list|lihat|tampilkan|show)\s+(?:(?:daftar|list)\s+)?(?:orang\s+)?(?:terpercaya|trusted\s+(?:members?|list))$/i.test(input)) {
        return { action: "trusted_list" };
    }
    if (/^(?:hapus|kosongkan|clear)\s+(?:semua\s+)?(?:trusted\s+(?:members?|list)|daftar\s+(?:trusted\s+members?|terpercaya))$/i.test(input)) {
        return { action: "trusted_clear_confirm" };
    }
    match = input.match(/^(?:cek|periksa)\s+(?:status\s+)?member\s+(.+)$/i);
    if (match) return { action: "trusted_check", targetId: mentionedId(message.mentions?.users) || match[1].match(/\d{17,20}/)?.[0] };
    match = input.match(/^(?:is|apakah)\s+(.+?)\s+(?:trusted|terpercaya)\??$/i);
    if (match) return { action: "trusted_check", targetId: mentionedId(message.mentions?.users) || match[1].match(/\d{17,20}/)?.[0] };
    match = input.match(/^(?:tambah(?:kan)?|masukkan|add)\s+(.+?)\s+(?:ke|sebagai)\s+(?:trusted\s+members?|daftar\s+terpercaya)$/i) ||
        input.match(/^(?:tambah(?:kan)?|add|daftarkan)\s+(?:member\s+)?(.+?)\s+(?:ke|to)\s+(?:daftar\s+)?trusted\s+(?:members?|list)$/i) ||
        input.match(/^(?:tambah(?:kan)?|add|daftarkan)\s+trusted\s*(?:member|user)\s+(.+)$/i);
    if (match) {
        const target = match[1].trim();
        return { action: "trusted_add", targetId: mentionedId(message.mentions?.users) || target.match(/\d{17,20}/)?.[0] || (isSelfTarget(target) ? message.author.id : null) };
    }
    match = input.match(/^(?:hapus|keluarkan|remove)\s+(.+?)\s+dari\s+(?:trusted\s+members?|daftar\s+terpercaya)$/i) ||
        input.match(/^(?:hapus|keluarkan|remove)\s+(.+?)\s+(?:dari|from)\s+(?:daftar\s+)?trusted\s+(?:members?|list)$/i) ||
        input.match(/^(?:hapus|remove)\s+trusted\s*(?:member|user)\s+(.+)$/i);
    if (match) {
        const target = match[1].trim();
        return { action: "trusted_remove", targetId: mentionedId(message.mentions?.users) || target.match(/\d{17,20}/)?.[0] || (isSelfTarget(target) ? message.author.id : null) };
    }

    match = input.match(/^(?:tambahkan|tambah|add)\s+(?:role\s+)?(.+?)\s+ke\s+trusted\s+roles?$/i);
    if (match) return { action: "trusted_role_add", targetId: mentionedId(message.mentions?.roles) || match[1].match(/\d{17,20}/)?.[0] };
    match = input.match(/^(?:hapus|remove)\s+(?:role\s+)?(.+?)\s+dari\s+trusted\s+roles?$/i);
    if (match) return { action: "trusted_role_remove", targetId: mentionedId(message.mentions?.roles) || match[1].match(/\d{17,20}/)?.[0] };
    if (/^(?:kecualikan|exclude)\s+role\s+(?:ini|this)\s+dari\s+auto\s*kick(?:\s+voice)?$/i.test(input)) {
        return { action: "exempt_role_add", targetId: mentionedId(message.mentions?.roles) };
    }
    match = input.match(/^(?:kecualikan|exclude)\s+role\s+(.+?)\s+dari\s+auto\s*kick(?:\s+voice)?$/i);
    if (match) return { action: "exempt_role_add", targetId: mentionedId(message.mentions?.roles) || match[1].match(/\d{17,20}/)?.[0] };
    match = input.match(/^(?:hapus|remove)\s+(?:pengecualian\s+)?role\s+(.+?)\s+dari\s+auto\s*kick(?:\s+voice)?$/i);
    if (match) return { action: "exempt_role_remove", targetId: mentionedId(message.mentions?.roles) || match[1].match(/\d{17,20}/)?.[0] };

    if (/^(?:lindungi|protect)\s+(?:voice\s+)?channel\s+(?:ini|saya|this)$/i.test(input)) {
        return { action: "channel_protect", targetId: message.member?.voice?.channelId };
    }
    match = input.match(/^(?:lindungi|protect)\s+(?:voice\s+)?channel\s+(.+)$/i);
    if (match) return { action: "channel_protect", targetId: mentionedId(message.mentions?.channels) || match[1].match(/\d{17,20}/)?.[0] };
    match = input.match(/^(?:jangan\s+)?(?:hapus\s+perlindungan|unprotect)\s+(?:voice\s+)?channel\s+(.+)$/i);
    if (match) return { action: "channel_unprotect", targetId: mentionedId(message.mentions?.channels) || match[1].match(/\d{17,20}/)?.[0] };

    if (/^(?:batalkan|batal|cancel)\s+(?:timer\s+)?(?:keluar\s+)?voice(?:\s+timer)?$/i.test(input)) {
        return { action: "timer_cancel" };
    }
    if (/^(?:reset|atur\s+ulang)\s+(?:timer\s+)?(?:keluar\s+)?voice(?:\s+disconnect)?$/i.test(input)) {
        return { action: "timer_reset" };
    }
    if (/^(?:status|cek|lihat|tampilkan|berapa lama lagi)\s+(?:(?:sisa|status)\s+)?(?:timer\s+)?(?:keluar\s+)?voice(?:\s+timer)?(?:\s+aktif)?$/i.test(input) ||
        /^(?:berapa lama lagi kamu|berapa lama lagi castorice)\s+(?:akan\s+)?keluar voice$/i.test(input)) {
        return { action: "timer_status" };
    }
    match = input.match(/^(?:tambah|perpanjang|extend)\s+(?:timer\s+)?(?:keluar\s+)?voice\s+(.+)$/i) ||
        input.match(/^(?:tambah|perpanjang|extend)\s+timer\s+(.+)$/i);
    if (match) return { action: "timer_extend", durationMs: parseDuration(match[1]) };
    match = input.match(/^(?:atur|set|jadwalkan|keluar)\s+(?:timer\s+)?(?:keluar\s+)?voice(?:\s+(?:dalam|menjadi|untuk))?\s+(.+)$/i) ||
        input.match(/^keluar voice dalam\s+(.+)$/i);
    if (match) return { action: "timer_set", durationMs: parseDuration(match[1]) };

    return null;
}

function formatDuration(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours ? `${hours} jam` : null, minutes ? `${minutes} menit` : null, seconds ? `${seconds} detik` : null]
        .filter(Boolean).join(" ") || "0 detik";
}

function createVoiceCenterTagRouter({ service, logger = console } = {}) {
    if (!service) throw new TypeError("Voice Center service wajib diisi.");

    return async function handleVoiceCenterTag({ message, commandText }) {
        if (!message.guild) return false;
        const intent = parseVoiceCenterIntent(commandText, message);
        if (!intent) return false;
        const reply = (content, components) => message.reply({
            content,
            ...(components ? { components } : {}),
            allowedMentions: { parse: [] }
        });

        try {
            if (!service.isAuthorized(message.guild, message.member)) {
                await reply("Hanya pemilik server atau administrator dengan izin Manage Server yang dapat mengelola Voice AI Center.");
                return true;
            }
            const actor = message.member;
            const guild = message.guild;
            if (intent.action === "auto_toggle") {
                const config = await service.configureAutoKick(guild, actor, { enabled: intent.enabled });
                await reply(`Auto Kick Voice sekarang **${config.enabled ? "ON" : "OFF"}**.`);
            } else if (intent.action === "auto_status") {
                const config = await service.getConfig(guild.id);
                await reply(`Auto Kick Voice: **${config.autoKick.enabled ? "ON" : "OFF"}** · grace period ${formatDuration(config.autoKick.gracePeriodMs)} · ${config.protectedVoiceChannelIds.length} channel dilindungi.`);
            } else if (intent.action === "grace") {
                if (!Number.isInteger(intent.durationMs)) throw new Error("Sebutkan grace period, misalnya `30 detik` atau `2 menit`.");
                const config = await service.configureAutoKick(guild, actor, { gracePeriodMs: intent.durationMs });
                await reply(`Grace period Auto Kick Voice diatur ke ${formatDuration(config.gracePeriodMs)}.`);
            } else if (intent.action === "trusted_list") {
                const list = await service.listTrustedMembers(guild.id);
                const members = list.memberIds.length ? list.memberIds.map(id => `<@${id}>`).join(", ") : "Belum ada trusted member.";
                const roles = list.roleIds.length ? list.roleIds.map(id => `<@&${id}>`).join(", ") : "Belum ada trusted role.";
                try {
                    if (typeof message.author?.send !== "function") throw new Error("dm_unavailable");
                    await message.author.send({
                        content: `**Trusted Members**\n${members}\n**Trusted Roles**\n${roles}`,
                        allowedMentions: { parse: [] }
                    });
                } catch {
                    logger.warn?.("[Voice Center Private List Error]", "dm_unavailable");
                    await reply("Daftar Trusted Members hanya dikirim lewat DM. Aktifkan DM dari anggota server lalu coba lagi.");
                }
            } else if (intent.action === "trusted_clear_confirm") {
                const rows = [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`voicecenter:ai_clear_confirm:${message.author.id}`).setLabel("Konfirmasi hapus semua").setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId("voicecenter:ai_clear_cancel").setLabel("Batal").setStyle(ButtonStyle.Secondary)
                )];
                await reply("Konfirmasi untuk menghapus seluruh trusted member dan trusted role di server ini.", rows);
            } else if (intent.action === "trusted_check") {
                if (!intent.targetId) throw new Error("Sebutkan atau mention satu member yang ingin diperiksa.");
                const status = await service.checkMemberStatus(guild, intent.targetId);
                await reply(`<@${status.memberId}> ${status.trusted ? "terdaftar sebagai trusted." : "belum terdaftar sebagai trusted."}`);
            } else if (intent.action === "trusted_add" || intent.action === "trusted_remove") {
                if (!intent.targetId) throw new Error("Sebutkan atau mention satu member. Target tidak boleh ditebak.");
                const list = intent.action === "trusted_add"
                    ? await service.addTrustedMember(guild, actor, intent.targetId)
                    : await service.removeTrustedMember(guild, actor, intent.targetId);
                await reply(`Trusted Members diperbarui. Total member: ${list.length}.`);
            } else if (intent.action === "trusted_role_add" || intent.action === "trusted_role_remove") {
                if (!intent.targetId) throw new Error("Mention satu role yang ingin diubah.");
                const roles = intent.action === "trusted_role_add"
                    ? await service.addTrustedRole(guild, actor, intent.targetId)
                    : await service.removeTrustedRole(guild, actor, intent.targetId);
                await reply(`Trusted Roles diperbarui. Total role: ${roles.length}.`);
            } else if (intent.action === "exempt_role_add" || intent.action === "exempt_role_remove") {
                if (!intent.targetId) throw new Error("Mention role yang ingin dikecualikan.");
                const roles = intent.action === "exempt_role_add"
                    ? await service.addExemptRole(guild, actor, intent.targetId)
                    : await service.removeExemptRole(guild, actor, intent.targetId);
                await reply(`Pengecualian Auto Kick Voice diperbarui. Total role: ${roles.length}.`);
            } else if (intent.action === "channel_protect" || intent.action === "channel_unprotect") {
                if (!intent.targetId) throw new Error("Sebutkan atau mention satu voice channel yang ingin dilindungi.");
                const channels = intent.action === "channel_protect"
                    ? await service.addProtectedChannel(guild, actor, intent.targetId)
                    : await service.removeProtectedChannel(guild, actor, intent.targetId);
                await reply(`Daftar protected voice channel diperbarui. Total: ${channels.length}.`);
            } else if (intent.action === "timer_set" || intent.action === "timer_extend") {
                if (!Number.isInteger(intent.durationMs)) throw new Error("Sebutkan durasi, misalnya `15 menit`, `30 menit`, atau `1 jam`.");
                const timer = intent.action === "timer_set"
                    ? await service.setVoiceTimer(guild, actor, intent.durationMs)
                    : await service.extendVoiceTimer(guild, actor, intent.durationMs);
                await reply(`Timer voice aktif. Castorice akan keluar dari <#${timer.channelId}> dalam ${formatDuration(timer.remainingMs)}.`);
            } else if (intent.action === "timer_cancel") {
                const cancelled = await service.cancelVoiceTimer(guild, actor);
                await reply(cancelled ? "Timer voice dibatalkan." : "Tidak ada timer voice aktif.");
            } else if (intent.action === "timer_reset") {
                const timer = await service.resetVoiceTimer(guild, actor);
                await reply(`Timer voice direset. Sisa waktu: ${formatDuration(timer.remainingMs)}.`);
            } else if (intent.action === "timer_status") {
                const timer = await service.getVoiceTimer(guild);
                await reply(timer
                    ? `Sisa timer voice: ${formatDuration(timer.remainingMs)} untuk <#${timer.channelId}>.`
                    : "Tidak ada timer voice aktif.");
            }
        } catch (error) {
            logger.warn?.("[Voice Center Tag Error]", {
                guildId: String(message.guild.id),
                action: intent.action,
                code: error?.code ?? "request_failed"
            });
            await reply(error.message || "Voice AI Center gagal menjalankan permintaan.");
        }
        return true;
    };
}

module.exports = {
    parseVoiceCenterIntent,
    createVoiceCenterTagRouter,
    parseDuration,
    formatDuration
};
