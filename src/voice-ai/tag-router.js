const {
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType
} = require("discord.js");
const { checkFeature } = require("../core/feature-guard");

const pendingChannelNames = new Map();
const CHANNEL_NAME_TTL_MS = 3 * 60 * 1000;

function parseVoiceIntent(input, message = null) {
    const text = String(input || "").trim().replace(/[.!?]+$/g, "");
    const command = text.replace(/^(?:(?:please|tolong|bisa|coba|can you|could you|aku mau|saya mau|gue mau|i want to|i need to)\s+)+/i, "");
    let match;

    const creation = parseChannelCreation(text, message);
    if (creation) return creation;

    match = text.match(/^(?:buat|bikin|create)\s+(?:(?:temporary|temp)\s+)?voice(?:\s+(?:channel|sementara))?(?:\s+(private|pribadi))?(?:\s+(?:bernama|dengan\s+nama)\s+(.+))?$/i);
    if (match) {
        return {
            type: "create",
            privacy: match[1] ? "private" : undefined,
            name: cleanName(match[2])
        };
    }

    match = command.match(/^(?:ganti\s+nama|ubah\s+nama|rubah\s+nama|rename|change\s+name)\s+(?:voice|channel|room|ruangan|vc)(?:\s+(?:saya|ini|this|my))?\s+(?:menjadi|jadi|to|as)\s+(.+)$/i) ||
        command.match(/^(?:ganti|ubah|rubah|rename|change)\s+(?:nama\s+)?(?:voice|channel|room|ruangan|vc)(?:\s+(?:saya|ini|this|my))?\s+(?:menjadi|jadi|to|as)\s+(.+)$/i);
    if (match) return { type: "rename", name: cleanName(match[1]) };

    match = command.match(/^(?:atur|set|batasi|limit|maksimalkan|cap)\s+(?:(?:member|anggota|people|users?)\s+)?(?:limit\s+)?(?:voice|channel|room|ruangan|vc)?\s*(?:(?:jadi|menjadi|to)\s*)?(\d{1,2}|[a-z]+(?:[\s-]+[a-z]+){0,2})\s*(?:orang|members?|anggota|people|users?)?$/i) ||
        command.match(/^(?:maksimal|max|limit)\s+(\d{1,2}|[a-z]+(?:[\s-]+[a-z]+){0,2})\s*(?:orang|members?|anggota|people|users?)$/i);
    if (match) {
        const value = parseSmallNumber(match[1]);
        if (value !== null && value <= 99) return { type: "limit", value };
    }

    if (/^(?:kunci|lock|tutup akses|make private)\s+(?:(?:(?:saya|ini|this|my)\s+)?(?:voice|channel|room|ruangan|vc)(?:\s+(?:saya|ini|this|my))?|akses\s+(?:voice|room|vc))$/i.test(command)) {
        return { type: "lock", value: true };
    }
    if (/^(?:buka|unlock|make public|allow people in)\s+(?:(?:(?:saya|ini|this|my)\s+)?(?:voice|channel|room|ruangan|vc)(?:\s+(?:saya|ini|this|my))?|akses\s+(?:voice|room|vc))$/i.test(command) ||
        /^(?:izinkan orang masuk|allow people in)$/i.test(command)) {
        return { type: "lock", value: false };
    }

    match = command.match(/^(?:transfer|pindahkan|jadikan)\s+(?:owner|ownership|pemilik)(?:\s+(?:voice|room|vc))?\s+(?:ke|to)\s+(.+)$/i);
    if (match) {
        const targetId = message?.mentions?.users?.first?.()?.id || match[1].match(/\d{17,20}/)?.[0];
        if (targetId) return { type: "transfer", targetId };
    }

    if (/^(?:hapus|delete|remove)\s+(?:(?:temporary|temp)\s+)?(?:(?:saya|ini|this|my)\s+)?(?:voice|channel|room|ruangan|vc)(?:\s+(?:saya|ini|this|my))?$/i.test(command)) {
        return { type: "delete" };
    }

    return null;
}

function parseSmallNumber(value) {
    const text = String(value || "").trim().toLowerCase();
    if (/^\d{1,2}$/.test(text)) return Number(text);

    const units = {
        zero: 0, nol: 0, one: 1, satu: 1, two: 2, dua: 2, three: 3, tiga: 3,
        four: 4, empat: 4, five: 5, lima: 5, six: 6, enam: 6, seven: 7, tujuh: 7,
        eight: 8, delapan: 8, nine: 9, sembilan: 9, ten: 10, sepuluh: 10,
        eleven: 11, sebelas: 11, twelve: 12, thirteen: 13, fourteen: 14,
        fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
        dua_belas: 12, tiga_belas: 13, empat_belas: 14, lima_belas: 15,
        enam_belas: 16, tujuh_belas: 17, delapan_belas: 18, sembilan_belas: 19
    };
    const tens = {
        twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
        seventy: 70, eighty: 80, ninety: 90, dua_puluh: 20, tiga_puluh: 30,
        empat_puluh: 40, lima_puluh: 50, enam_puluh: 60, tujuh_puluh: 70,
        delapan_puluh: 80, sembilan_puluh: 90
    };
    const normalized = text.replace(/[\s-]+/g, "_");
    if (Object.hasOwn(units, normalized)) return units[normalized];
    if (Object.hasOwn(tens, normalized)) return tens[normalized];
    const [ten, unit] = normalized.split("_");
    if (Object.hasOwn(tens, ten) && Object.hasOwn(units, unit) && units[unit] < 10) {
        return tens[ten] + units[unit];
    }
    if (normalized.endsWith("_belas")) {
        const base = normalized.slice(0, -6);
        const value = units[base];
        if (Number.isInteger(value) && value >= 2 && value <= 9) return 10 + value;
    }
    if (normalized.endsWith("_belas")) return null;
    const puluhIndex = normalized.indexOf("_puluh");
    if (puluhIndex > 0) {
        const base = normalized.slice(0, puluhIndex);
        const rest = normalized.slice(puluhIndex + 7);
        const tensValue = units[base] * 10;
        if (tensValue >= 20 && tensValue <= 90) {
            if (!rest) return tensValue;
            const unitValue = units[rest];
            if (Number.isInteger(unitValue) && unitValue > 0 && unitValue < 10) {
                return tensValue + unitValue;
            }
        }
    }
    return null;
}

function parseChannelCreation(text, message) {
    const normalized = String(text || "").trim().replace(/[.!?]+$/g, "");
    const request = normalized.match(/^(?:(?:gas|please|tolong|coba|hey|can you|could you|bisa)\s+)*(?:buat(?:kan)?|bikin(?:in)?|buatin|buatkan|membuat|ciptakan|sediain|siapkan|tambah(?:in|kan)?|create|make|set\s+up|setup|add)\s+(.+)$/i);
    const wish = normalized.match(/^(?:(?:aku|saya|gue|gua|i|we)\s+)?(?:mau|ingin|butuh|need|want|would like(?:\s+to)?)\s+(.+)$/i);
    const nounRequest = normalized.match(/^(?:(?:a|an|new|baru|another|satu(?:\s+lagi)?|one\s+more)\s+)?(?:private\s+|pribadi\s+)?(?:temporary\s+|temp\s+)?(?:voice(?:\s+(?:channel|room))?|channel\s+voice|vc|room|ruangan|ruang\s+suara|tempat\s+(?:ngobrol|bicara|nongkrong))(?:\s+(?:baru|new|lagi|again|dong))*$/i);
    const tail = (request?.[1] || wish?.[1] || nounRequest?.[0] || "")
        .trim()
        .replace(/^(?:(?:me|us|a|an|new|baru|another|satu|one|lagi)\s+)+/i, "");
    if (!tail) return null;
    if (/^(?:temporary|temp)\s+voice\b|^voice\s+sementara\b/i.test(tail)) return null;
    if (/^(?:buat|bikin|create)\s+(?:(?:temporary|temp)\s+)?voice(?:\s+sementara)?(?:\s+(?:private|pribadi))?(?:\s+(?:bernama|dengan\s+nama)\s+.+)?$/i.test(normalized)) return null;
    const channelMatch = tail.match(/^(?:(private|pribadi|public|umum)\s+)?(?:(?:temporary|temp)\s+)?(?:voice(?:\s+(?:channel|room))?|channel\s+voice(?:\s+(?:channel|room))?|vc|room|ruangan|ruang\s+suara|tempat\s+(?:ngobrol|bicara|nongkrong)|(?:gaming|chill|mabar)\s+room)(.*)$/i);
    if (!channelMatch) return null;

    const suffix = channelMatch[2].trim();
    const categoryMention = message?.mentions?.channels?.first?.() || null;
    const categoryMatch = suffix.match(/(?:\bdi\s+(?:kategori|category)|\bin\s+(?:the\s+)?category)\s+(.+)$/i);
    const categoryName = categoryMatch ? categoryMatch[1].trim() : null;
    const explicitName = suffix.match(/(?:\bbernama\b|\bdengan\s+nama\b|\bwith\s+(?:the\s+)?name\b|\bnama\b|\bcalled\b|\bnamed\b)\s+(.+?)(?=\s+(?:di\s+(?:kategori|category)|in\s+(?:the\s+)?category)\b|$)/i);
    let name = explicitName?.[1]?.trim() || null;

    const nameSuffix = suffix.replace(/(?:\bdi\s+(?:kategori|category)|\bin\s+(?:the\s+)?category)\s+.+$/i, "").trim();
    if (!name && !categoryName && !/^(?:buat|untuk|for|purpose|AI)\b/i.test(nameSuffix) && !purposeIsAbsent(nameSuffix)) {
        name = nameSuffix
            .replace(/\b(?:baru|new|private|pribadi|public|umum|dong|please)\b/gi, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    const cleanChannelName = cleanName(name);
    return {
        type: "create_channel",
        name: cleanChannelName || undefined,
        categoryId: categoryMention?.id || null,
        categoryName,
        privacy: /^(?:private|pribadi)$/i.test(channelMatch[1] || "") ||
            /\b(?:private|pribadi)\b/i.test(suffix) ? "private" : "public",
        userLimit: 0
    };
}

function purposeIsAbsent(suffix) {
    return !suffix || /^(?:(?:baru|new|private|pribadi|public|umum|please|dong)\s*)*$/i.test(suffix);
}

function cleanName(value) {
    if (!value) return undefined;
    return value.trim()
        .replace(/^(["'])(.*)\1$/, "$2")
        .replace(/[,.!?]+$/g, "")
        .replace(/\s+(?:dong|please|ya)$/i, "")
        .trim();
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

    function getPendingKey(message) {
        return `${message.guild.id}:${message.author.id}`;
    }

    function getPendingCreate(message) {
        const key = getPendingKey(message);
        const pending = pendingChannelNames.get(key);
        if (!pending) return null;
        if (pending.expiresAt <= Date.now() || pending.channelId !== String(message.channel?.id ?? "")) {
            pendingChannelNames.delete(key);
            return null;
        }
        return { key, pending };
    }

    async function resolveCategory(guild, intent, message) {
        const mentioned = message.mentions?.channels?.first?.();
        const categoryId = intent.categoryId || mentioned?.id;
        if (categoryId) {
            const category = await guild.channels.fetch(categoryId).catch(() => null);
            if (!category || category.type !== ChannelType.GuildCategory ||
                String(category.guildId ?? category.guild?.id) !== String(guild.id)) {
                throw new Error("Kategori harus berupa category Discord di server ini. Mention category yang dimaksud.");
            }
            return category.id;
        }
        if (!intent.categoryName) return null;
        const name = intent.categoryName.replace(/^<#|>$/g, "").trim().toLocaleLowerCase();
        const matches = guild.channels.cache.filter(channel =>
            channel.type === ChannelType.GuildCategory &&
            channel.name.toLocaleLowerCase() === name
        );
        if (matches.size !== 1) {
            throw new Error(matches.size
                ? "Ada beberapa kategori dengan nama itu. Mention kategori yang dimaksud."
                : "Kategori itu tidak ditemukan. Mention kategori Discord atau pilih dari Dashboard.");
        }
        return matches.first().id;
    }

    return async function handleVoiceTag({ message, commandText }) {
        let intent = parseVoiceIntent(commandText, message);
        let pendingCreate = null;
        if (!intent) {
            pendingCreate = message.guild ? getPendingCreate(message) : null;
            const name = cleanName(commandText);
            if (pendingCreate && name && name.length <= 100 && !/\b(?:batal|cancel|stop|help|bantuan)\b/i.test(name)) {
                intent = { type: "create_channel", name };
            }
        }
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
            } else if (intent.type === "create_channel") {
                const pendingKey = getPendingKey(message);
                if (!intent.name) {
                    const now = Date.now();
                    for (const [key, pending] of pendingChannelNames) {
                        if (pending.expiresAt <= now) pendingChannelNames.delete(key);
                    }
                    pendingChannelNames.set(pendingKey, {
                        channelId: String(message.channel?.id ?? ""),
                        expiresAt: now + CHANNEL_NAME_TTL_MS,
                        categoryName: intent.categoryName || null,
                        categoryId: intent.categoryId || null,
                        privacy: intent.privacy || "public",
                        userLimit: intent.userLimit ?? 0
                    });
                    if (pendingChannelNames.size > 500) {
                        const oldest = pendingChannelNames.keys().next().value;
                        if (oldest) pendingChannelNames.delete(oldest);
                    }
                    await message.reply({
                        content: "Boleh. Mau pakai nama apa untuk voice channel-nya? Balas dengan `Castorice: <nama channel>` dalam 3 menit.",
                        allowedMentions: { parse: [] }
                    });
                    return true;
                }
                if (intent.name.length > 100) throw new Error("Nama voice channel maksimal 100 karakter.");
                if (pendingCreate) {
                    pendingChannelNames.delete(pendingCreate.key);
                    intent = {
                        ...intent,
                        categoryName: pendingCreate.pending.categoryName,
                        categoryId: pendingCreate.pending.categoryId,
                        privacy: pendingCreate.pending.privacy,
                        userLimit: pendingCreate.pending.userLimit
                    };
                }
                const categoryId = await resolveCategory(message.guild, intent, message);
                const channel = await service.createVoiceChannel(
                    message.guild,
                    message.guild.id,
                    member,
                    {
                        name: intent.name,
                        categoryId,
                        privacy: intent.privacy,
                        userLimit: intent.userLimit,
                        requestKey: message.id
                    }
                );
                await message.reply({
                    content: `Siap, voice channel <#${channel.id}> berhasil dibuat.`,
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
            logger.warn?.("[Voice Manager Tag Error]", {
                guildId: String(message.guild.id),
                action: intent.type,
                code: error?.code ?? "request_failed"
            });
            await message.reply({
                content: error.message || "Voice Manager gagal menjalankan permintaan.",
                allowedMentions: { parse: [] }
            });
            return true;
        }
    };
}

module.exports = { parseVoiceIntent, createVoiceTagRouter, parseChannelCreation };
