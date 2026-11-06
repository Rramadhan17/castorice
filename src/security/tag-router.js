const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const { checkFeature } = require("../core/feature-guard");

function parseSecurityIntent(input) {
    const text = String(input || "").trim().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
    if (/^(?:security|keamanan|security assistant)$/i.test(text)) return { type: "help" };
    if (/^(?:security audit|audit security|cek keamanan|audit keamanan|periksa keamanan)$/i.test(text)) {
        return { type: "audit" };
    }
    if (/^(?:security history|audit history|riwayat audit(?: keamanan)?|riwayat keamanan)$/i.test(text)) {
        return { type: "history" };
    }
    if (/^(?:security policy|kebijakan keamanan|kebijakan bot offline)$/i.test(text)) {
        return { type: "policy" };
    }
    return { type: "unknown" };
}

function formatSecurityHistory(reports, maxReports = 5) {
    if (!Array.isArray(reports) || reports.length === 0) {
        return "Belum ada riwayat audit keamanan untuk server ini.";
    }
    const recent = reports.slice(0, maxReports);
    return [
        `Riwayat audit keamanan terbaru (${recent.length}):`,
        ...recent.map(report => {
            const { critical, high, medium, low } = report.summary;
            return `• ${report.scannedAt} — ${critical} critical, ${high} high, ${medium} medium, ${low} low (ID: ${report.id})`;
        })
    ].join("\n");
}

function formatSecurityReport(report, maxFindings = 5) {
    const { critical, high, medium, low, total } = report.summary;
    const findings = report.findings.slice(0, maxFindings).map(finding =>
        `• [${finding.severity.toUpperCase()}] ${finding.title}: ${finding.detail}`
    );
    const presence = report.botPresence
        ? `Bot di cache: ${report.botPresence.cachedBots} • online ${report.botPresence.online} • idle ${report.botPresence.idle} • DND ${report.botPresence.dnd} • offline/invisible ${report.botPresence.offlineOrInvisible} • tidak diketahui ${report.botPresence.unknown}.`
        : "Data presence bot tidak tersedia pada laporan ini.";
    const remainder = total > findings.length
        ? `\n...dan ${total - findings.length} temuan lainnya.`
        : "";
    return [
        `Security audit selesai — ${critical} critical, ${high} high, ${medium} medium, ${low} low.`,
        presence,
        "Offline/invisible bukan bukti bot mati; cache dapat tidak lengkap dan Discord tidak mengungkapkan penyebab status tersebut.",
        findings.length ? findings.join("\n") : "Tidak ada temuan berdasarkan aturan audit saat ini.",
        remainder,
        "Tidak ada perubahan server atau tindakan otomatis yang dijalankan."
    ].filter(Boolean).join("\n");
}

function createSecurityTagRouter({ service, featureGuard = checkFeature, logger = console } = {}) {
    if (!service || typeof service.audit !== "function") {
        throw new TypeError("Security Assistant service is required.");
    }

    return async function routeSecurityTag({ message, commandText }) {
        if (!message?.guild) return false;
        const intent = parseSecurityIntent(commandText);
        if (intent.type === "unknown") return false;
        if (intent.type === "help") {
            await message.reply({
                content: "Gunakan `@Castorice cek keamanan`, `@Castorice riwayat audit`, atau `@Castorice kebijakan keamanan`. Audit hanya melaporkan temuan dan tidak melakukan tindakan terhadap anggota.",
                allowedMentions: { parse: [] }
            });
            return true;
        }

        const feature = await featureGuard(message.guild.id, "security_assistant");
        if (!feature.allowed) {
            await message.reply({ content: feature.reason, allowedMentions: { parse: [] } });
            return true;
        }

        try {
            const actor = await message.guild.members.fetch(message.author.id);
            if (!actor.permissions?.has(PermissionFlagsBits.ManageGuild)) {
                await message.reply({
                    content: "Kamu membutuhkan izin Manage Server untuk menjalankan audit keamanan.",
                    allowedMentions: { parse: [] }
                });
                return true;
            }
            const content = intent.type === "history"
                ? formatSecurityHistory(await service.listReports(message.guild.id))
                : intent.type === "policy"
                    ? formatSecurityPolicy(await service.getPolicy(message.guild.id))
                    : formatSecurityReport(await service.audit(message.guild, actor));
            await message.reply({
                content,
                ...(intent.type === "policy" ? {
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId("castorice:security_policy")
                            .setLabel("Preview Kebijakan")
                            .setStyle(ButtonStyle.Secondary)
                    )]
                } : {}),
                allowedMentions: { parse: [] }
            });
        } catch (error) {
            logger.error?.("[Security Assistant Tag Error]", error);
            await message.reply({
                content: error.message || "Security Assistant gagal menjalankan audit.",
                allowedMentions: { parse: [] }
            });
        }
        return true;
    };
}

function formatSecurityPolicy(policy) {
    return [
        `Kebijakan bot offline alert-only: ${policy.enabled ? "aktif" : "nonaktif"}.`,
        `Threshold ${policy.thresholdMinutes} menit; jarak sampel maksimum ${policy.maxObservationGapMinutes} menit.`,
        `Bot dikecualikan: ${policy.excludedBotIds.length ? policy.excludedBotIds.join(", ") : "tidak ada"}.`,
        "Hanya sampel presence eksplisit dan berurutan yang dapat menghasilkan kandidat alert. Unknown/missing presence mereset kontinuitas; tidak ada kick/ban otomatis."
    ].join("\n");
}

module.exports = {
    parseSecurityIntent,
    formatSecurityHistory,
    formatSecurityPolicy,
    formatSecurityReport,
    createSecurityTagRouter
};
