const { randomUUID } = require("node:crypto");
const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { JsonGuildStore } = require("../storage/json-guild-store");

const COLLECTION = "server_templates";
const SCHEMA_VERSION = 1;
const MAX_TEMPLATES = 25;
const SUPPORTED_CHANNEL_TYPES = new Set([
    ChannelType.GuildCategory,
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildVoice,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum,
    ChannelType.GuildMedia
].filter(Number.isInteger));

function normalizeName(name) {
    return String(name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function validateTemplateName(name) {
    const value = String(name || "").trim().replace(/\s+/g, " ");
    if (!value || value.length > 50) {
        throw new Error("Nama template harus berisi 1 sampai 50 karakter.");
    }
    return value;
}

function assertManageGuild(guild, actor) {
    if (!guild?.id || !actor?.guild?.id || actor.guild.id !== guild.id) {
        throw new Error("Aktor harus berasal dari server yang sama.");
    }
    if (!actor.permissions?.has(PermissionFlagsBits.ManageGuild)) {
        throw new Error("Kamu membutuhkan izin Manage Server untuk mengelola template.");
    }
}

function valuesOf(collection) {
    if (!collection) return [];
    if (typeof collection.values === "function") return [...collection.values()];
    if (Array.isArray(collection)) return collection;
    return Object.values(collection);
}

async function refreshGuildSnapshotData(guild) {
    const requests = [];
    if (typeof guild.roles?.fetch === "function") requests.push(guild.roles.fetch());
    if (typeof guild.channels?.fetch === "function") requests.push(guild.channels.fetch());
    await Promise.all(requests);
}

function serializeRole(role) {
    return {
        name: role.name,
        color: role.color || 0,
        hoist: Boolean(role.hoist),
        mentionable: Boolean(role.mentionable),
        permissions: String(role.permissions?.bitfield ?? 0),
        position: Number(role.position) || 0
    };
}

function serializeChannel(channel, categoryById, roleNameById) {
    const overwriteEntries = valuesOf(channel.permissionOverwrites?.cache);
    const permissionOverwrites = overwriteEntries
        .filter(overwrite => Number(overwrite.type) === 0)
        .map(overwrite => ({
            roleName: roleNameById.get(overwrite.id) || null,
            sourceRoleId: overwrite.id,
            allow: String(overwrite.allow?.bitfield ?? 0),
            deny: String(overwrite.deny?.bitfield ?? 0)
        }))
        .filter(overwrite => overwrite.roleName);

    return {
        name: channel.name,
        type: channel.type,
        parentName: channel.parentId ? categoryById.get(channel.parentId) || null : null,
        position: Number(channel.rawPosition ?? channel.position) || 0,
        permissionOverwrites,
        ...(typeof channel.topic === "string" ? { topic: channel.topic } : {}),
        ...(typeof channel.nsfw === "boolean" ? { nsfw: channel.nsfw } : {}),
        ...(Number.isInteger(channel.rateLimitPerUser) ? { rateLimitPerUser: channel.rateLimitPerUser } : {}),
        ...(Number.isInteger(channel.bitrate) ? { bitrate: channel.bitrate } : {}),
        ...(Number.isInteger(channel.userLimit) ? { userLimit: channel.userLimit } : {})
    };
}

function serializeGuildSnapshot(guild) {
    if (!guild?.id) throw new Error("Guild tidak valid.");
    const roles = valuesOf(guild.roles?.cache)
        .filter(role => role.id !== guild.id && !role.managed)
        .map(serializeRole)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

    const sourceChannels = valuesOf(guild.channels?.cache)
        .filter(channel => SUPPORTED_CHANNEL_TYPES.has(channel.type));
    const categoryById = new Map(sourceChannels
        .filter(channel => channel.type === ChannelType.GuildCategory)
        .map(channel => [channel.id, channel.name]));
    const roleNameById = new Map(valuesOf(guild.roles?.cache).map(role => [role.id, role.name]));
    const channels = sourceChannels
        .map(channel => serializeChannel(channel, categoryById, roleNameById))
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const roleNameCounts = new Map();
    for (const role of roles) {
        const key = normalizeName(role.name);
        roleNameCounts.set(key, (roleNameCounts.get(key) || 0) + 1);
    }

    return {
        sourceGuildId: guild.id,
        roles,
        channels,
        warnings: [
            "Member-specific permission overwrites are omitted because member IDs cannot be cloned safely.",
            `${valuesOf(guild.channels?.cache).filter(channel => !SUPPORTED_CHANNEL_TYPES.has(channel.type)).length} unsupported or thread channels are omitted.`,
            ...roles.filter(role => roleNameCounts.get(normalizeName(role.name)) > 1)
                .map(role => `Role name '${role.name}' is duplicated; permission-overwrite mapping needs review.`),
            ...roles.filter(role => {
                try { return (BigInt(role.permissions) & PermissionFlagsBits.Administrator) !== 0n; }
                catch { return false; }
            }).map(role => `Role '${role.name}' includes Administrator permission and needs explicit review.`)
        ]
    };
}

function validateTemplateCollection(value) {
    return Boolean(
        value &&
        typeof value === "object" &&
        Array.isArray(value.templates) &&
        value.templates.length <= MAX_TEMPLATES &&
        value.templates.every(template =>
            template &&
            typeof template.id === "string" && template.id.length > 0 && template.id.length <= 128 &&
            typeof template.name === "string" && template.name.trim().length > 0 && template.name.length <= 50 &&
            /^\d{17,20}$/.test(String(template.sourceGuildId || "")) &&
            Number.isFinite(Date.parse(template.createdAt)) &&
            Array.isArray(template.roles) && template.roles.every(role =>
                role && typeof role.name === "string" && role.name.length > 0 && role.name.length <= 100 &&
                /^\d+$/.test(role.permissions) && Number.isFinite(role.position)
            ) &&
            Array.isArray(template.channels) && template.channels.every(channel =>
                channel && typeof channel.name === "string" && channel.name.length > 0 && channel.name.length <= 100 &&
                Number.isInteger(channel.type) && SUPPORTED_CHANNEL_TYPES.has(channel.type) &&
                (channel.parentName === null || typeof channel.parentName === "string") &&
                Array.isArray(channel.permissionOverwrites) && channel.permissionOverwrites.every(overwrite =>
                    overwrite && typeof overwrite.roleName === "string" &&
                    /^\d+$/.test(overwrite.allow) && /^\d+$/.test(overwrite.deny)
                )
            ) &&
            Array.isArray(template.warnings) && template.warnings.every(warning => typeof warning === "string")
        )
    );
}

function getChannelKey(channel) {
    return `${normalizeName(channel.parentName)}|${channel.type}|${normalizeName(channel.name)}`;
}

function buildMergePlan(template, currentSnapshot, mode = "smart_merge") {
    if (!["create", "rebuild", "clone", "smart_merge"].includes(mode)) {
        throw new Error("Mode template tidak valid.");
    }

    const existingRoles = new Map(currentSnapshot.roles.map(role => [normalizeName(role.name), role]));
    const wantedRoles = new Set(template.roles.map(role => normalizeName(role.name)));
    const roles = [];

    for (const role of template.roles) {
        const key = normalizeName(role.name);
        const current = existingRoles.get(key);
        if (!current) roles.push({ action: "create", name: role.name, definition: role });
        else if (mode === "smart_merge" || mode === "rebuild") {
            roles.push({ action: "update", name: role.name, definition: role });
        } else {
            roles.push({ action: "preserve", name: role.name });
        }
    }

    if (mode === "rebuild") {
        for (const role of currentSnapshot.roles) {
            if (!wantedRoles.has(normalizeName(role.name))) {
                roles.push({ action: "preserve", name: role.name });
            }
        }
    }

    const existingChannels = new Map(currentSnapshot.channels.map(channel => [getChannelKey(channel), channel]));
    const wantedChannels = new Set(template.channels.map(getChannelKey));
    const channels = [];

    for (const channel of template.channels) {
        const key = getChannelKey(channel);
        const current = existingChannels.get(key);
        if (!current) channels.push({ action: "create", name: channel.name, type: channel.type, definition: channel });
        else if (mode === "smart_merge" || mode === "rebuild") {
            channels.push({ action: "update", name: channel.name, type: channel.type, definition: channel });
        } else {
            channels.push({ action: "preserve", name: channel.name, type: channel.type });
        }
    }

    if (mode === "rebuild") {
        for (const channel of currentSnapshot.channels) {
            if (!wantedChannels.has(getChannelKey(channel))) {
                channels.push({ action: "delete", name: channel.name, type: channel.type, definition: channel });
            }
        }
    }

    const summary = { create: 0, update: 0, delete: 0, preserve: 0 };
    for (const item of [...roles, ...channels]) summary[item.action] += 1;

    return {
        dryRun: true,
        mode,
        templateId: template.id,
        templateName: template.name,
        roles,
        channels,
        summary,
        warnings: [...new Set([
            ...(template.warnings || []),
            ...currentSnapshot.warnings,
            ...(mode === "rebuild"
                ? ["Rebuild preserves target roles to avoid losing role assignments and external permission references."]
                : [])
        ])]
    };
}

function createServerTemplateService({ store = new JsonGuildStore(), now = () => new Date().toISOString(), id = randomUUID } = {}) {
    async function readCollection(guildId) {
        return store.read(guildId, COLLECTION, {
            schemaVersion: SCHEMA_VERSION,
            defaultValue: { templates: [] },
            validate: validateTemplateCollection
        });
    }

    async function create(guild, actor, name) {
        assertManageGuild(guild, actor);
        name = validateTemplateName(name);
        await refreshGuildSnapshotData(guild);
        const snapshot = serializeGuildSnapshot(guild);
        let created;

        await store.update(guild.id, COLLECTION, data => {
            const collection = data || { templates: [] };
            if (collection.templates.some(template => normalizeName(template.name) === normalizeName(name))) {
                throw new Error("Nama template tersebut sudah digunakan di server ini.");
            }
            if (collection.templates.length >= MAX_TEMPLATES) {
                throw new Error(`Maksimal ${MAX_TEMPLATES} template per server.`);
            }
            created = {
                id: id(),
                name,
                createdAt: now(),
                ...snapshot
            };
            collection.templates.push(created);
            return collection;
        }, {
            schemaVersion: SCHEMA_VERSION,
            defaultValue: { templates: [] },
            validate: validateTemplateCollection
        });

        return structuredClone(created);
    }

    async function list(guildId) {
        const collection = await readCollection(guildId);
        return collection.templates.map(({ id: templateId, name, createdAt, sourceGuildId, roles, channels }) => ({
            id: templateId,
            name,
            createdAt,
            sourceGuildId,
            roleCount: roles.length,
            channelCount: channels.length
        }));
    }

    async function get(guildId, templateId) {
        const collection = await readCollection(guildId);
        const template = collection.templates.find(item => item.id === templateId);
        if (!template) throw new Error("Template tidak ditemukan.");
        return template;
    }

    async function remove(guild, actor, templateId) {
        assertManageGuild(guild, actor);
        let removed = false;
        await store.update(guild.id, COLLECTION, data => {
            const collection = data || { templates: [] };
            const index = collection.templates.findIndex(item => item.id === templateId);
            if (index >= 0) {
                collection.templates.splice(index, 1);
                removed = true;
            }
            return collection;
        }, {
            schemaVersion: SCHEMA_VERSION,
            defaultValue: { templates: [] },
            validate: validateTemplateCollection
        });
        return removed;
    }

    async function preview({ sourceGuild, targetGuild, sourceActor, targetActor, templateId, mode = "smart_merge" } = {}) {
        assertManageGuild(sourceGuild, sourceActor);
        assertManageGuild(targetGuild, targetActor);
        const template = await get(sourceGuild.id, templateId);
        await refreshGuildSnapshotData(targetGuild);
        return {
            ...buildMergePlan(template, serializeGuildSnapshot(targetGuild), mode),
            sourceGuildId: sourceGuild.id,
            targetGuildId: targetGuild.id
        };
    }

    return { create, list, get, remove, preview };
}

module.exports = {
    COLLECTION,
    MAX_TEMPLATES,
    createServerTemplateService,
    serializeGuildSnapshot,
    buildMergePlan,
    validateTemplateName,
    validateTemplateCollection,
    assertManageGuild
};
