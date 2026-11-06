const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const { checkFeature } = require("../core/feature-guard");

function parseServerTemplateIntent(input) {
    const text = String(input || "").trim().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
    const modes = new Map([
        ["create", "create"],
        ["buat", "create"],
        ["rebuild", "rebuild"],
        ["bangun ulang", "rebuild"],
        ["clone", "clone"],
        ["duplikat", "clone"],
        ["smart_merge", "smart_merge"],
        ["merge", "smart_merge"]
    ]);
    if (/^(?:template|templates|server template|template server)$/i.test(text)) {
        return { type: "help" };
    }
    if (/^(?:daftar|list)(?:\s+server)?\s+templates?$/i.test(text)) {
        return { type: "list" };
    }
    const preview = text.match(/^(?:preview|pratinjau)(?:\s+(create|buat|rebuild|bangun ulang|clone|duplikat|smart_merge|merge))?(?:\s+(?:server\s+)?templates?)?$/i);
    if (preview) {
        return { type: "preview", mode: modes.get((preview[1] || "").toLowerCase()) || "smart_merge" };
    }
    const applyMode = text.match(/^(create|buat|rebuild|bangun ulang|clone|duplikat|smart_merge|merge)(?:\s+(?:server\s+)?templates?)?$/i);
    if (applyMode) {
        return { type: "preview", mode: modes.get(applyMode[1].toLowerCase()) };
    }
    const snapshot = text.match(/^(?:simpan|save)\s+(?:server\s+)?(?:snapshot|template)(?:\s+server)?\s+(.+)$/i);
    if (snapshot) return { type: "snapshot", name: snapshot[1].trim() };
    return { type: "unknown" };
}

function formatTemplateList(templates) {
    if (!templates.length) return "Belum ada template tersimpan di server ini.";
    return [
        `Template server tersimpan (${templates.length}):`,
        ...templates.map(template => `• ${template.name} — ${template.roleCount} role, ${template.channelCount} channel (ID: ${template.id})`)
    ].join("\n");
}

function createServerTemplateTagRouter({ service, featureGuard = checkFeature, logger = console } = {}) {
    if (!service || typeof service.list !== "function" || typeof service.create !== "function") {
        throw new TypeError("Server Template service must support list() and create().");
    }

    return async function routeServerTemplateTag({ message, commandText } = {}) {
        if (!message?.guild) return false;
        const intent = parseServerTemplateIntent(commandText);
        if (intent.type === "unknown") return false;

        const reply = async (content, options = {}) => message.reply({
            ...options,
            content: String(content).replace(/@/g, "@\u200b"),
            allowedMentions: { parse: [] }
        });

        if (intent.type === "help") {
            await reply("Kelola template lewat `@Castorice daftar template`, `@Castorice simpan snapshot Community`, atau `@Castorice preview/rebuild/clone/create template`. Pilih server sumber dan ID di dialog; semua perubahan tetap melalui preview dan konfirmasi administrator.");
            return true;
        }

        const feature = await featureGuard(message.guild.id, "server_templates");
        if (!feature.allowed) {
            await reply(feature.reason);
            return true;
        }

        try {
            if (intent.type === "preview") {
                const actor = await message.guild.members.fetch(message.author.id);
                if (!actor.permissions?.has(PermissionFlagsBits.ManageGuild)) {
                    await reply("Kamu membutuhkan izin Manage Server untuk membuka preview template.");
                    return true;
                }
                const mode = intent.mode || "smart_merge";
                const components = [new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`castorice:template_preview_open:${mode}`)
                        .setLabel("Buka Preview Template")
                        .setStyle(ButtonStyle.Primary)
                )];
                await reply(
                    `Masukkan server sumber dan ID template di dialog. Mode **${mode}** sudah dipilih; perubahan hanya diterapkan setelah preview dan konfirmasi.`,
                    { components }
                );
                return true;
            }

            if (intent.type === "list") {
                await reply(formatTemplateList(await service.list(message.guild.id)));
                return true;
            }

            const actor = await message.guild.members.fetch(message.author.id);
            if (!actor.permissions?.has(PermissionFlagsBits.ManageGuild)) {
                await reply("Kamu membutuhkan izin Manage Server untuk menyimpan snapshot template.");
                return true;
            }
            const template = await service.create(message.guild, actor, intent.name);
            await reply(`Snapshot **${template.name}** tersimpan. ${template.roles.length} role dan ${template.channels.length} channel dicatat. ID: \`${template.id}\`. Struktur server belum diubah.`);
        } catch (error) {
            logger.error?.("[Server Template Tag Error]", error);
            await reply(error.message || "Server Template gagal diproses.");
        }
        return true;
    };
}

module.exports = { parseServerTemplateIntent, formatTemplateList, createServerTemplateTagRouter };
