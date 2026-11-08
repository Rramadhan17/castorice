const { PermissionFlagsBits, ChannelType } = require("discord.js");
const { randomUUID } = require("node:crypto");
const { JsonGuildStore } = require("../storage/json-guild-store");

const SCHEMA_VERSION = 1;
const ID = /^\d{17,20}$/;
const VOICE_CHANNEL_TYPES = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
const MAX_GRACE_MS = 5 * 60 * 1000;
const MIN_TIMER_MS = 60 * 1000;
const MAX_TIMER_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVITY_EVENTS = 100;

function assertId(value, label) {
    const id = String(value ?? "");
    if (!ID.test(id)) throw new Error(`${label} tidak valid.`);
    return id;
}

function createDefaultConfig(guildId) {
    return {
        guildId,
        autoKick: {
            enabled: false,
            gracePeriodMs: 10_000,
            exemptAdmins: true,
            exemptOwner: true,
            exemptRoleIds: []
        },
        trustedMemberIds: [],
        trustedRoleIds: [],
        protectedVoiceChannelIds: [],
        voiceTimer: null,
        activity: []
    };
}

function isValidIdList(value) {
    return Array.isArray(value) && value.length <= 1000 &&
        value.every(id => typeof id === "string" && ID.test(id)) &&
        new Set(value).size === value.length;
}

function validateConfig(config, { guildId } = {}) {
    return Boolean(
        config &&
        typeof config === "object" &&
        config.guildId === guildId &&
        config.autoKick &&
        typeof config.autoKick.enabled === "boolean" &&
        Number.isInteger(config.autoKick.gracePeriodMs) &&
        config.autoKick.gracePeriodMs >= 0 &&
        config.autoKick.gracePeriodMs <= MAX_GRACE_MS &&
        typeof config.autoKick.exemptAdmins === "boolean" &&
        typeof config.autoKick.exemptOwner === "boolean" &&
        isValidIdList(config.autoKick.exemptRoleIds) &&
        isValidIdList(config.trustedMemberIds) &&
        isValidIdList(config.trustedRoleIds) &&
        isValidIdList(config.protectedVoiceChannelIds) &&
        (config.voiceTimer === null || (
            config.voiceTimer &&
            ID.test(config.voiceTimer.channelId) &&
            Number.isFinite(config.voiceTimer.deadlineAt) &&
            Number.isInteger(config.voiceTimer.durationMs) &&
            config.voiceTimer.durationMs >= MIN_TIMER_MS &&
            config.voiceTimer.durationMs <= MAX_TIMER_MS
        )) &&
        Array.isArray(config.activity) &&
        config.activity.length <= MAX_ACTIVITY_EVENTS &&
        config.activity.every(event =>
            event && typeof event.type === "string" &&
            event.type.length <= 64 &&
            Number.isFinite(event.at) &&
            (event.actorId === null || ID.test(event.actorId)) &&
            typeof event.detail === "string" &&
            event.detail.length <= 160
        )
    );
}

function createVoiceCenterService({
    store = new JsonGuildStore(),
    botOwnerId = null,
    timers = globalThis,
    clock = () => Date.now(),
    idFactory = randomUUID,
    getVoiceSession = guild => {
        const channelId = guild.members?.me?.voice?.channelId;
        return channelId ? { channelId, identity: null } : null;
    },
    disconnectVoiceSession = async () => false,
    logger = console
} = {}) {
    if (!store || typeof store.read !== "function" || typeof store.update !== "function") {
        throw new TypeError("Voice Center membutuhkan JsonGuildStore yang valid.");
    }

    const pendingKicks = new Map();
    const voiceTimers = new Map();
    const disconnecting = new Set();
    const memberGenerations = new Map();
    let disposed = false;

    function assertGuild(guild, guildId = guild?.id) {
        const id = assertId(guildId, "Guild ID");
        if (!guild || String(guild.id) !== id) throw new Error("Guild tidak cocok.");
        return id;
    }

    function isAuthorized(guild, actor) {
        const actorId = String(actor?.id ?? "");
        const actorGuildId = String(actor?.guild?.id ?? actor?.guildId ?? "");
        return Boolean(
            guild?.id &&
            actorId &&
            actorGuildId === String(guild.id) &&
            (actorId === String(guild.ownerId) ||
                (botOwnerId && actorId === String(botOwnerId)) ||
                actor?.permissions?.has?.(PermissionFlagsBits.ManageGuild))
        );
    }

    function assertAuthorized(guild, actor) {
        if (!actor || String(actor.guild?.id ?? actor.guildId ?? "") !== String(guild?.id)) {
            throw new Error("Anggota harus berasal dari server yang sama.");
        }
        if (!isAuthorized(guild, actor)) {
            throw new Error("Hanya pemilik server atau administrator dengan izin Manage Server yang dapat mengubah Voice AI Center.");
        }
        return assertId(actor.id, "Member ID");
    }

    function configOptions(guildId) {
        return {
            schemaVersion: SCHEMA_VERSION,
            defaultValue: createDefaultConfig(guildId),
            validate: (value, context) => validateConfig(value, context)
        };
    }

    async function getConfig(guildId) {
        guildId = assertId(guildId, "Guild ID");
        return store.read(guildId, "voice_center", configOptions(guildId));
    }

    async function updateConfig(guildId, updater) {
        guildId = assertId(guildId, "Guild ID");
        return store.update(guildId, "voice_center", updater, configOptions(guildId));
    }

    async function recordActivity(guildId, type, detail, actorId = null) {
        await updateConfig(guildId, config => {
            config.activity.unshift({
                id: idFactory(),
                type,
                detail: String(detail).slice(0, 160),
                actorId,
                at: clock()
            });
            config.activity = config.activity.slice(0, MAX_ACTIVITY_EVENTS);
            return config;
        });
    }

    async function fetchMember(guild, memberId) {
        const id = assertId(memberId, "Member ID");
        const member = await guild.members.fetch(id).catch(() => null);
        if (!member || String(member.guild?.id ?? member.guildId) !== String(guild.id)) {
            throw new Error("Member tidak ditemukan di server ini.");
        }
        return member;
    }

    async function fetchRole(guild, roleId) {
        const id = assertId(roleId, "Role ID");
        const role = await guild.roles.fetch(id).catch(() => null);
        if (!role || String(role.guild?.id ?? role.guildId) !== String(guild.id)) {
            throw new Error("Role tidak ditemukan di server ini.");
        }
        return role;
    }

    async function fetchVoiceChannel(guild, channelId) {
        const id = assertId(channelId, "Voice channel ID");
        const channel = await guild.channels.fetch(id).catch(() => null);
        if (!channel || String(channel.guildId ?? channel.guild?.id) !== String(guild.id) ||
            !VOICE_CHANNEL_TYPES.has(channel.type)) {
            throw new Error("Voice channel tidak ditemukan di server ini.");
        }
        return channel;
    }

    async function configureAutoKick(guild, actor, updates) {
        const guildId = assertGuild(guild);
        const actorId = assertAuthorized(guild, actor);
        if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
            throw new Error("Pengaturan Auto Kick Voice tidak valid.");
        }
        const allowed = new Set(["enabled", "gracePeriodMs", "exemptAdmins", "exemptOwner"]);
        for (const [key, value] of Object.entries(updates)) {
            if (!allowed.has(key)) throw new Error("Pengaturan Auto Kick Voice tidak dikenal.");
            if (key === "enabled" || key === "exemptAdmins" || key === "exemptOwner") {
                if (typeof value !== "boolean") throw new Error("Nilai pengaturan harus ON atau OFF.");
            } else if (!Number.isInteger(value) || value < 0 || value > MAX_GRACE_MS) {
                throw new Error("Grace period harus antara 0 sampai 300 detik.");
            }
        }
        const saved = await updateConfig(guildId, config => {
            Object.assign(config.autoKick, updates);
            return config;
        });
        await recordActivity(guildId, "auto_kick_configured", "Pengaturan Auto Kick Voice diperbarui.", actorId);
        return saved.autoKick;
    }

    async function updateIdList(guild, actor, listName, value, operation) {
        const guildId = assertGuild(guild);
        const actorId = assertAuthorized(guild, actor);
        const id = assertId(value, "ID");
        const config = await updateConfig(guildId, current => {
            const list = current[listName];
            current[listName] = operation === "add"
                ? [...new Set([...list, id])]
                : list.filter(item => item !== id);
            return current;
        });
        return { config, actorId, id };
    }

    async function addTrustedMember(guild, actor, memberId) {
        const member = await fetchMember(guild, memberId);
        const { config, actorId, id } = await updateIdList(guild, actor, "trustedMemberIds", member.id, "add");
        await recordActivity(guild.id, "trusted_member_added", `Trusted member ${id} ditambahkan.`, actorId);
        return config.trustedMemberIds;
    }

    async function removeTrustedMember(guild, actor, memberId) {
        const { config, actorId, id } = await updateIdList(guild, actor, "trustedMemberIds", memberId, "remove");
        await recordActivity(guild.id, "trusted_member_removed", `Trusted member ${id} dihapus.`, actorId);
        return config.trustedMemberIds;
    }

    async function clearTrustedMembers(guild, actor) {
        const guildId = assertGuild(guild);
        const actorId = assertAuthorized(guild, actor);
        await updateConfig(guildId, config => {
            config.trustedMemberIds = [];
            config.trustedRoleIds = [];
            return config;
        });
        await recordActivity(guildId, "trusted_list_cleared", "Daftar trusted member dan role dikosongkan.", actorId);
    }

    async function addTrustedRole(guild, actor, roleId) {
        const role = await fetchRole(guild, roleId);
        const { config, actorId, id } = await updateIdList(guild, actor, "trustedRoleIds", role.id, "add");
        await recordActivity(guild.id, "trusted_role_added", `Trusted role ${id} ditambahkan.`, actorId);
        return config.trustedRoleIds;
    }

    async function removeTrustedRole(guild, actor, roleId) {
        const { config, actorId, id } = await updateIdList(guild, actor, "trustedRoleIds", roleId, "remove");
        await recordActivity(guild.id, "trusted_role_removed", `Trusted role ${id} dihapus.`, actorId);
        return config.trustedRoleIds;
    }

    async function addExemptRole(guild, actor, roleId) {
        const guildId = assertGuild(guild);
        const actorId = assertAuthorized(guild, actor);
        const role = await fetchRole(guild, roleId);
        const config = await updateConfig(guildId, current => {
            current.autoKick.exemptRoleIds = [...new Set([...current.autoKick.exemptRoleIds, role.id])];
            return current;
        });
        await recordActivity(guildId, "auto_kick_exempt_role_added", `Role ${role.id} dikecualikan dari Auto Kick Voice.`, actorId);
        return config.autoKick.exemptRoleIds;
    }

    async function removeExemptRole(guild, actor, roleId) {
        const guildId = assertGuild(guild);
        const actorId = assertAuthorized(guild, actor);
        const id = assertId(roleId, "Role ID");
        const config = await updateConfig(guildId, current => {
            current.autoKick.exemptRoleIds = current.autoKick.exemptRoleIds.filter(role => role !== id);
            return current;
        });
        await recordActivity(guildId, "auto_kick_exempt_role_removed", `Role ${id} tidak lagi dikecualikan.`, actorId);
        return config.autoKick.exemptRoleIds;
    }

    async function addProtectedChannel(guild, actor, channelId) {
        const guildId = assertGuild(guild);
        const actorId = assertAuthorized(guild, actor);
        const channel = await fetchVoiceChannel(guild, channelId);
        const config = await updateConfig(guildId, current => {
            current.protectedVoiceChannelIds = [...new Set([...current.protectedVoiceChannelIds, channel.id])];
            return current;
        });
        await recordActivity(guildId, "voice_channel_protected", `Voice channel ${channel.id} dilindungi.`, actorId);
        return config.protectedVoiceChannelIds;
    }

    async function removeProtectedChannel(guild, actor, channelId) {
        const guildId = assertGuild(guild);
        const actorId = assertAuthorized(guild, actor);
        const id = assertId(channelId, "Voice channel ID");
        const config = await updateConfig(guildId, current => {
            current.protectedVoiceChannelIds = current.protectedVoiceChannelIds.filter(channel => channel !== id);
            return current;
        });
        await recordActivity(guildId, "voice_channel_unprotected", `Voice channel ${id} tidak lagi dilindungi.`, actorId);
        return config.protectedVoiceChannelIds;
    }

    function clearPendingKick(key) {
        const pending = pendingKicks.get(key);
        if (pending) {
            pending.cancelled = true;
            timers.clearTimeout(pending.timer);
        }
        pendingKicks.delete(key);
    }

    async function isMemberExempt(member, guild, config) {
        const memberId = String(member.id);
        if (member.user?.bot) return true;
        if (config.trustedMemberIds.includes(memberId)) return true;
        if (member.roles?.cache?.some?.(role => config.trustedRoleIds.includes(role.id))) return true;
        if (config.autoKick.exemptRoleIds.some(roleId => member.roles?.cache?.has?.(roleId))) return true;
        if (config.autoKick.exemptOwner && memberId === String(guild.ownerId)) return true;
        if (config.autoKick.exemptOwner && botOwnerId && memberId === String(botOwnerId)) return true;
        if (config.autoKick.exemptAdmins && member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
        return false;
    }

    async function enforceAutoKick(guild, guildId, memberId, channelId, key, pending) {
        if (pendingKicks.get(key) === pending) pendingKicks.delete(key);
        if (disposed || pending.cancelled ||
            memberGenerations.get(key) !== pending.generation ||
            disconnecting.has(key)) return;
        disconnecting.add(key);
        try {
            const config = await getConfig(guildId);
            if (!config.autoKick.enabled || !config.protectedVoiceChannelIds.includes(channelId)) return;
            const member = await fetchMember(guild, memberId).catch(() => null);
            if (!member || member.voice?.channelId !== channelId || await isMemberExempt(member, guild, config)) return;
            const channel = await guild.channels.fetch(channelId).catch(() => null);
            const botPermissions = channel?.permissionsFor?.(guild.members?.me);
            if (!channel || String(channel.guildId ?? channel.guild?.id) !== guildId ||
                !VOICE_CHANNEL_TYPES.has(channel.type) ||
                !botPermissions?.has?.(PermissionFlagsBits.MoveMembers)) {
                await recordActivity(guildId, "auto_kick_permission_denied", `Bot tidak memiliki Move Members untuk channel ${channelId}.`);
                logger.warn?.("[Voice Center] Auto Kick Voice dibatalkan: bot tidak memiliki Move Members.");
                return;
            }
            if (typeof member.voice?.disconnect !== "function") {
                await recordActivity(guildId, "auto_kick_failed", `API disconnect tidak tersedia untuk member ${memberId}.`);
                logger.warn?.("[Voice Center] Auto Kick Voice gagal: API voice disconnect tidak tersedia.");
                return;
            }
            const latestConfig = await getConfig(guildId);
            const latestMember = await fetchMember(guild, memberId).catch(() => null);
            if (pending.cancelled || memberGenerations.get(key) !== pending.generation ||
                !latestConfig.autoKick.enabled ||
                !latestConfig.protectedVoiceChannelIds.includes(channelId) ||
                !latestMember || latestMember.voice?.channelId !== channelId ||
                await isMemberExempt(latestMember, guild, latestConfig)) return;
            await latestMember.voice.disconnect("Not trusted in a protected voice channel");
            await recordActivity(guildId, "auto_kick_voice_disconnected", `Member ${memberId} dikeluarkan dari voice ${channelId}.`);
        } catch (error) {
            logger.warn?.("[Voice Center] Auto Kick Voice gagal.", {
                guildId,
                memberId,
                code: error?.code ?? "operation_failed"
            });
            await recordActivity(guildId, "auto_kick_failed", `Disconnect member ${memberId} gagal.`).catch(auditError => {
                logger.error?.("[Voice Center] Activity log gagal disimpan.", { guildId, code: auditError?.code ?? "storage_error" });
            });
        } finally {
            disconnecting.delete(key);
        }
    }

    async function onVoiceStateUpdate(oldState, newState) {
        if (disposed) return;
        const guild = newState?.guild || oldState?.guild;
        const guildId = String(guild?.id ?? "");
        const member = newState?.member || oldState?.member;
        const memberId = String(member?.id ?? "");
        if (!ID.test(guildId) || !ID.test(memberId)) return;
        const oldChannelId = oldState?.channelId ? String(oldState.channelId) : null;
        const newChannelId = newState?.channelId ? String(newState.channelId) : null;
        if (oldChannelId === newChannelId) return;
        if (member?.user?.bot) {
            if (memberId !== String(guild.members?.me?.id ?? "")) return;
            const config = await getConfig(guildId);
            if (config.voiceTimer && config.voiceTimer.channelId === oldChannelId) {
                clearVoiceTimer(guildId);
                await saveVoiceTimer(guildId, null);
                await recordActivity(guildId, "voice_timer_cancelled", "Timer dibersihkan karena Castorice keluar atau berpindah channel.");
            }
            return;
        }
        const key = `${guildId}:${memberId}`;
        if (!oldChannelId && newChannelId && pendingKicks.get(key)?.channelId === newChannelId) return;
        const generation = (memberGenerations.get(key) || 0) + 1;
        memberGenerations.set(key, generation);
        clearPendingKick(key);
        if (!newChannelId) return;

        const config = await getConfig(guildId);
        if (!config.autoKick.enabled || !config.protectedVoiceChannelIds.includes(newChannelId) ||
            await isMemberExempt(member, guild, config)) return;

        const pending = { cancelled: false, timer: null, channelId: newChannelId, generation };
        pending.timer = timers.setTimeout(() => {
            void enforceAutoKick(guild, guildId, memberId, newChannelId, key, pending);
        }, config.autoKick.gracePeriodMs);
        pending.timer?.unref?.();
        pendingKicks.set(key, pending);
    }

    function clearVoiceTimer(guildId) {
        const active = voiceTimers.get(guildId);
        if (active) timers.clearTimeout(active.timer);
        voiceTimers.delete(guildId);
    }

    async function saveVoiceTimer(guildId, timerValue) {
        return updateConfig(guildId, config => {
            config.voiceTimer = timerValue;
            return config;
        });
    }

    function scheduleVoiceTimer(guild, savedTimer, identity) {
        const guildId = String(guild.id);
        clearVoiceTimer(guildId);
        const token = { timer: null, deadlineAt: savedTimer.deadlineAt, channelId: savedTimer.channelId, identity };
        token.timer = timers.setTimeout(() => {
            void expireVoiceTimer(guild, token).catch(error => {
                logger.error?.("[Voice Center] Voice timer gagal.", { guildId, code: error?.code ?? "operation_failed" });
            });
        }, Math.max(0, savedTimer.deadlineAt - clock()));
        token.timer?.unref?.();
        voiceTimers.set(guildId, token);
    }

    async function expireVoiceTimer(guild, token) {
        const guildId = String(guild.id);
        if (disposed || voiceTimers.get(guildId) !== token) return false;
        const config = await getConfig(guildId);
        const stored = config.voiceTimer;
        if (!stored || stored.deadlineAt !== token.deadlineAt || stored.channelId !== token.channelId) return false;
        const session = await getVoiceSession(guild);
        if (!session || String(session.channelId) !== token.channelId ||
            (token.identity && session.identity !== token.identity)) {
            clearVoiceTimer(guildId);
            await saveVoiceTimer(guildId, null);
            await recordActivity(guildId, "voice_timer_cancelled", "Timer dibatalkan karena sesi voice berubah.");
            return false;
        }
        clearVoiceTimer(guildId);
        await saveVoiceTimer(guildId, null);
        let disconnected = false;
        try {
            disconnected = await disconnectVoiceSession({
                guild,
                channelId: token.channelId,
                identity: token.identity,
                session
            });
        } catch (error) {
            logger.warn?.("[Voice Center] Disconnect timer gagal.", {
                guildId,
                code: error?.code ?? "disconnect_failed"
            });
        }
        await recordActivity(
            guildId,
            disconnected ? "voice_timer_disconnected" : "voice_timer_disconnect_failed",
            disconnected
                ? `Bot keluar dari sesi voice ${token.channelId}.`
                : `Bot tidak dapat keluar dari sesi voice ${token.channelId}.`
        );
        return Boolean(disconnected);
    }

    async function setVoiceTimer(guild, actor, durationMs) {
        const guildId = assertGuild(guild);
        const actorId = assertAuthorized(guild, actor);
        if (!Number.isInteger(durationMs) || durationMs < MIN_TIMER_MS || durationMs > MAX_TIMER_MS) {
            throw new Error("Timer voice harus antara 1 menit sampai 24 jam.");
        }
        const session = await getVoiceSession(guild);
        if (!session?.channelId) throw new Error("Castorice tidak sedang berada di voice channel.");
        const timerValue = {
            channelId: assertId(session.channelId, "Voice channel ID"),
            deadlineAt: clock() + durationMs,
            durationMs
        };
        await saveVoiceTimer(guildId, timerValue);
        scheduleVoiceTimer(guild, timerValue, session.identity ?? null);
        await recordActivity(guildId, "voice_timer_set", `Timer voice diatur untuk ${timerValue.channelId}.`, actorId);
        return getVoiceTimer(guild);
    }

    async function getVoiceTimer(guild) {
        const config = await getConfig(assertGuild(guild));
        const saved = config.voiceTimer;
        if (!saved) return null;
        const runtime = voiceTimers.get(String(guild.id));
        const session = await getVoiceSession(guild);
        const valid = Boolean(runtime) &&
            saved.deadlineAt > clock() &&
            session?.channelId === saved.channelId &&
            (!runtime.identity || runtime.identity === session.identity);
        if (!valid) return null;
        return {
            channelId: saved.channelId,
            deadlineAt: saved.deadlineAt,
            durationMs: saved.durationMs,
            remainingMs: Math.max(0, saved.deadlineAt - clock())
        };
    }

    async function cancelVoiceTimer(guild, actor) {
        const guildId = assertGuild(guild);
        const actorId = assertAuthorized(guild, actor);
        const exists = (await getConfig(guildId)).voiceTimer !== null;
        clearVoiceTimer(guildId);
        await saveVoiceTimer(guildId, null);
        if (exists) await recordActivity(guildId, "voice_timer_cancelled", "Timer voice dibatalkan.", actorId);
        return exists;
    }

    async function extendVoiceTimer(guild, actor, extensionMs) {
        const guildId = assertGuild(guild);
        const actorId = assertAuthorized(guild, actor);
        if (!Number.isInteger(extensionMs) || extensionMs < MIN_TIMER_MS || extensionMs > MAX_TIMER_MS) {
            throw new Error("Durasi tambahan harus antara 1 menit sampai 24 jam.");
        }
        const current = await getVoiceTimer(guild);
        if (!current) throw new Error("Tidak ada timer voice aktif yang dapat diperpanjang.");
        const deadlineAt = current.deadlineAt + extensionMs;
        if (deadlineAt - clock() > MAX_TIMER_MS) throw new Error("Timer tidak boleh melebihi 24 jam.");
        const session = await getVoiceSession(guild);
        const timerValue = { channelId: current.channelId, deadlineAt, durationMs: deadlineAt - clock() };
        await saveVoiceTimer(guildId, timerValue);
        scheduleVoiceTimer(guild, timerValue, session.identity ?? null);
        await recordActivity(guildId, "voice_timer_extended", "Timer voice diperpanjang.", actorId);
        return getVoiceTimer(guild);
    }

    async function resetVoiceTimer(guild, actor) {
        const guildId = assertGuild(guild);
        const actorId = assertAuthorized(guild, actor);
        const current = await getVoiceTimer(guild);
        if (!current) throw new Error("Tidak ada timer voice aktif yang dapat direset.");
        const session = await getVoiceSession(guild);
        const timerValue = {
            channelId: current.channelId,
            deadlineAt: clock() + current.durationMs,
            durationMs: current.durationMs
        };
        await saveVoiceTimer(guildId, timerValue);
        scheduleVoiceTimer(guild, timerValue, session.identity ?? null);
        await recordActivity(guildId, "voice_timer_reset", "Timer voice direset.", actorId);
        return getVoiceTimer(guild);
    }

    async function recoverTimers(guilds) {
        for (const guild of guilds.values()) {
            const config = await getConfig(String(guild.id));
            if (!config.voiceTimer) continue;
            if (config.voiceTimer.deadlineAt <= clock()) {
                await saveVoiceTimer(String(guild.id), null);
                await recordActivity(String(guild.id), "voice_timer_expired_on_restart", "Timer kedaluwarsa saat Castorice offline.");
            } else {
                await saveVoiceTimer(String(guild.id), null);
                await recordActivity(String(guild.id), "voice_timer_cancelled_on_restart", "Timer dibatalkan saat startup agar sesi voice lama tidak memutus sesi baru.");
            }
        }
    }

    async function listTrustedMembers(guildId) {
        const config = await getConfig(guildId);
        return {
            memberIds: [...config.trustedMemberIds],
            roleIds: [...config.trustedRoleIds]
        };
    }

    async function checkMemberStatus(guild, memberId) {
        const member = await fetchMember(guild, memberId);
        const config = await getConfig(String(guild.id));
        return {
            trusted: config.trustedMemberIds.includes(member.id) ||
                member.roles?.cache?.some?.(role => config.trustedRoleIds.includes(role.id)) === true,
            memberId: member.id
        };
    }

    async function getActivity(guildId) {
        const config = await getConfig(guildId);
        return config.activity.map(({ type, detail, actorId, at }) => ({ type, detail, actorId, at }));
    }

    function dispose() {
        disposed = true;
        for (const pending of pendingKicks.values()) {
            pending.cancelled = true;
            timers.clearTimeout(pending.timer);
        }
        pendingKicks.clear();
        for (const guildId of voiceTimers.keys()) clearVoiceTimer(guildId);
    }

    return {
        getConfig,
        configureAutoKick,
        addTrustedMember,
        removeTrustedMember,
        clearTrustedMembers,
        addTrustedRole,
        removeTrustedRole,
        addExemptRole,
        removeExemptRole,
        addProtectedChannel,
        removeProtectedChannel,
        listTrustedMembers,
        checkMemberStatus,
        getActivity,
        onVoiceStateUpdate,
        setVoiceTimer,
        getVoiceTimer,
        cancelVoiceTimer,
        extendVoiceTimer,
        resetVoiceTimer,
        recoverTimers,
        isAuthorized,
        dispose,
        get pendingKickCount() { return pendingKicks.size; },
        get voiceTimerCount() { return voiceTimers.size; }
    };
}

module.exports = {
    createVoiceCenterService,
    createDefaultConfig,
    validateConfig,
    MAX_GRACE_MS,
    MIN_TIMER_MS,
    MAX_TIMER_MS
};
