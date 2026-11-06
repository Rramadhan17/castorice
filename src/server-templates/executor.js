const { ChannelType } = require("discord.js");

function normalizeName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function valuesOf(collection) {
    if (!collection) return [];
    if (typeof collection.values === "function") return [...collection.values()];
    if (Array.isArray(collection)) return collection;
    return Object.values(collection);
}

function getChannelKey(channel) {
    return `${normalizeName(channel.parentName)}|${channel.type}|${normalizeName(channel.name)}`;
}

function snapshotOverwrite(overwrite) {
    return {
        id: overwrite.id,
        type: Number(overwrite.type),
        allow: String(overwrite.allow?.bitfield ?? 0),
        deny: String(overwrite.deny?.bitfield ?? 0)
    };
}

function getChannelRollbackState(channel) {
    return {
        name: channel.name,
        type: channel.type,
        parent: channel.parentId || null,
        position: Number(channel.rawPosition ?? channel.position) || 0,
        permissionOverwrites: valuesOf(channel.permissionOverwrites?.cache).map(snapshotOverwrite),
        ...(typeof channel.topic === "string" ? { topic: channel.topic } : {}),
        ...(typeof channel.nsfw === "boolean" ? { nsfw: channel.nsfw } : {}),
        ...(Number.isInteger(channel.rateLimitPerUser) ? { rateLimitPerUser: channel.rateLimitPerUser } : {}),
        ...(Number.isInteger(channel.bitrate) ? { bitrate: channel.bitrate } : {}),
        ...(Number.isInteger(channel.userLimit) ? { userLimit: channel.userLimit } : {})
    };
}

function findRole(guild, name) {
    return valuesOf(guild.roles?.cache).find(role => normalizeName(role.name) === normalizeName(name));
}

function findRoleById(guild, id) {
    return valuesOf(guild.roles?.cache).find(role => role.id === id);
}

function findChannel(guild, definition) {
    const key = getChannelKey(definition);
    return valuesOf(guild.channels?.cache).find(channel => {
        if (channel.type !== definition.type || normalizeName(channel.name) !== normalizeName(definition.name)) return false;
        const parentName = channel.parent?.name || null;
        return normalizeName(parentName) === normalizeName(definition.parentName);
    }) || (valuesOf(guild.channels?.cache).find(channel => getChannelKey({
        name: channel.name,
        type: channel.type,
        parentName: channel.parent?.name || null
    }) === key));
}

function resolveRoleOverwrites(guild, definition, { preserveMemberOverwrites = false, existingChannel = null } = {}) {
    const desired = [];
    for (const overwrite of definition.permissionOverwrites || []) {
        const role = findRole(guild, overwrite.roleName);
        if (!role) continue;
        desired.push({
            id: role.id,
            type: 0,
            allow: BigInt(overwrite.allow),
            deny: BigInt(overwrite.deny)
        });
    }
    if (preserveMemberOverwrites && existingChannel) {
        desired.push(...valuesOf(existingChannel.permissionOverwrites?.cache)
            .filter(overwrite => Number(overwrite.type) === 1)
            .map(overwrite => {
                const snapshot = snapshotOverwrite(overwrite);
                return { ...snapshot, allow: BigInt(snapshot.allow), deny: BigInt(snapshot.deny) };
            }));
    }
    return desired;
}

function roleOptions(definition) {
    return {
        name: definition.name,
        color: definition.color,
        hoist: definition.hoist,
        mentionable: definition.mentionable,
        permissions: BigInt(definition.permissions),
        position: definition.position
    };
}

function channelOptions(guild, definition, existingChannel = null) {
    const parent = definition.parentName
        ? valuesOf(guild.channels?.cache).find(channel =>
            channel.type === ChannelType.GuildCategory &&
            normalizeName(channel.name) === normalizeName(definition.parentName))
        : null;
    return {
        name: definition.name,
        type: definition.type,
        parent: parent?.id || null,
        position: definition.position,
        permissionOverwrites: resolveRoleOverwrites(guild, definition, {
            preserveMemberOverwrites: Boolean(existingChannel),
            existingChannel
        }),
        ...(definition.topic !== undefined ? { topic: definition.topic } : {}),
        ...(definition.nsfw !== undefined ? { nsfw: definition.nsfw } : {}),
        ...(definition.rateLimitPerUser !== undefined ? { rateLimitPerUser: definition.rateLimitPerUser } : {}),
        ...(definition.bitrate !== undefined ? { bitrate: definition.bitrate } : {}),
        ...(definition.userLimit !== undefined ? { userLimit: definition.userLimit } : {})
    };
}

function createDiscordMutationAdapter() {
    async function applyRole(action, guild) {
        const existing = findRole(guild, action.name);
        if (action.action === "preserve") return async () => {};
        if (action.action === "create") {
            const created = await guild.roles.create(roleOptions(action.definition));
            return async () => { await created.delete("Rollback Server Template"); };
        }
        if (action.action === "update") {
            if (!existing) throw new Error(`Role '${action.name}' tidak ditemukan saat eksekusi.`);
            const previous = {
                name: existing.name,
                color: existing.color,
                hoist: existing.hoist,
                mentionable: existing.mentionable,
                permissions: BigInt(existing.permissions.bitfield),
                position: existing.position
            };
            await existing.edit(roleOptions(action.definition));
            return async () => { await existing.edit(previous); };
        }
        if (action.action === "delete") {
            if (!existing) return async () => {};
            const previous = {
                name: existing.name,
                color: existing.color,
                hoist: existing.hoist,
                mentionable: existing.mentionable,
                permissions: BigInt(existing.permissions.bitfield),
                position: existing.position
            };
            await existing.delete("Server Template Rebuild");
            return async () => { await guild.roles.create(previous); };
        }
        throw new Error(`Operasi role '${action.action}' tidak didukung.`);
    }

    async function applyChannel(action, guild) {
        const existing = findChannel(guild, action.definition || action);
        if (action.action === "preserve") return async () => {};
        if (action.action === "create") {
            const created = await guild.channels.create(channelOptions(guild, action.definition));
            return async () => { await created.delete("Rollback Server Template"); };
        }
        if (action.action === "update") {
            if (!existing) throw new Error(`Channel '${action.name}' tidak ditemukan saat eksekusi.`);
            const previous = getChannelRollbackState(existing);
            await existing.edit(channelOptions(guild, action.definition, existing));
            return async () => {
                const restore = { ...previous };
                restore.permissionOverwrites = previous.permissionOverwrites.map(overwrite => ({
                    ...overwrite,
                    allow: BigInt(overwrite.allow),
                    deny: BigInt(overwrite.deny)
                }));
                await existing.edit(restore);
            };
        }
        if (action.action === "delete") {
            if (!existing) return async () => {};
            const previous = getChannelRollbackState(existing);
            const definition = {
                ...previous,
                parentName: existing.parent?.name || null,
                permissionOverwrites: valuesOf(existing.permissionOverwrites?.cache)
                    .filter(overwrite => Number(overwrite.type) === 0)
                    .map(overwrite => ({
                        roleName: overwrite.role?.name || findRoleById(guild, overwrite.id)?.name,
                        allow: String(overwrite.allow?.bitfield ?? 0),
                        deny: String(overwrite.deny?.bitfield ?? 0)
                    }))
                    .filter(overwrite => overwrite.roleName)
            };
            await existing.delete("Server Template Rebuild");
            return async () => { await guild.channels.create(channelOptions(guild, definition)); };
        }
        throw new Error(`Operasi channel '${action.action}' tidak didukung.`);
    }

    return { applyRole, applyChannel };
}

function hashTemplatePlan(plan) {
    return require("node:crypto").createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function getConfirmationPhrase(mode, templateName) {
    return `APPLY ${String(mode).toUpperCase()} ${templateName}`;
}

function orderChannelActions(actions) {
    const createsAndUpdates = actions.filter(action => action.action !== "delete")
        .sort((a, b) => Number(a.type !== ChannelType.GuildCategory) - Number(b.type !== ChannelType.GuildCategory));
    const deletes = actions.filter(action => action.action === "delete")
        .sort((a, b) => Number(a.type === ChannelType.GuildCategory) - Number(b.type === ChannelType.GuildCategory));
    return [...createsAndUpdates, ...deletes];
}

function createServerTemplateExecutor({ service, adapter = createDiscordMutationAdapter() } = {}) {
    if (!service || typeof service.preview !== "function" || typeof service.get !== "function") {
        throw new TypeError("Server Template service is required.");
    }
    if (typeof adapter.applyRole !== "function" || typeof adapter.applyChannel !== "function") {
        throw new TypeError("Mutation adapter must implement applyRole and applyChannel.");
    }

    async function execute(input = {}) {
        const { sourceGuild, targetGuild, sourceActor, targetActor, templateId, mode = "smart_merge" } = input;
        const plan = await service.preview({ sourceGuild, targetGuild, sourceActor, targetActor, templateId, mode });
        const planHash = hashTemplatePlan(plan);
        if (input.expectedPlanHash !== planHash) {
            throw new Error("Rencana template sudah berubah. Buat preview baru sebelum menerapkan perubahan.");
        }
        const template = await service.get(sourceGuild.id, templateId);
        const confirmationPhrase = getConfirmationPhrase(mode, template.name);
        if (input.confirmation !== confirmationPhrase) {
            throw new Error(`Konfirmasi harus sama persis: ${confirmationPhrase}`);
        }

        const undo = [];
        const completed = [];
        const target = targetGuild;

        try {
            for (const operation of plan.roles.filter(item => item.action !== "delete")) {
                const rollback = await adapter.applyRole(operation, target, template);
                undo.push(rollback);
                completed.push({ kind: "role", action: operation.action, name: operation.name });
            }
            for (const operation of orderChannelActions(plan.channels)) {
                const rollback = await adapter.applyChannel(operation, target, template);
                undo.push(rollback);
                completed.push({ kind: "channel", action: operation.action, name: operation.name });
            }
            for (const operation of plan.roles.filter(item => item.action === "delete")) {
                const rollback = await adapter.applyRole(operation, target, template);
                undo.push(rollback);
                completed.push({ kind: "role", action: operation.action, name: operation.name });
            }
        } catch (error) {
            const rollbackErrors = [];
            for (const rollback of undo.reverse()) {
                try { await rollback(); }
                catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
            }
            const failure = new Error(
                rollbackErrors.length
                    ? `Template gagal diterapkan dan rollback tidak lengkap: ${rollbackErrors.join("; ")}`
                    : `Template gagal diterapkan; perubahan yang selesai sudah dibatalkan. ${error.message}`
            );
            failure.cause = error;
            failure.completedBeforeRollback = completed;
            failure.rollbackErrors = rollbackErrors;
            throw failure;
        }

        return {
            applied: true,
            dryRun: false,
            mode,
            templateId,
            targetGuildId: targetGuild.id,
            planHash,
            completed
        };
    }

    return { execute };
}

module.exports = {
    createServerTemplateExecutor,
    createDiscordMutationAdapter,
    hashTemplatePlan,
    getConfirmationPhrase,
    orderChannelActions,
    getChannelRollbackState
};
