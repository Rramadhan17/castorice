const { randomUUID } = require("node:crypto");
const { PermissionFlagsBits } = require("discord.js");
const { JsonGuildStore } = require("../storage/json-guild-store");

const COLLECTION = "security_reports";
const SCHEMA_VERSION = 1;
const MAX_REPORTS = 20;
const MAX_FINDINGS = 100;
const MAX_AUDIT_EVENTS = 200;
const POLICY_SCHEMA_VERSION = 1;
const DEFAULT_OFFLINE_POLICY = Object.freeze({
    enabled: false,
    thresholdMinutes: 15,
    maxObservationGapMinutes: 5,
    excludedBotIds: []
});
const DEFAULT_SPAM_POLICY = Object.freeze({
    enabled: false,
    deleteThreshold: 5,
    timeoutThreshold: 8,
    timeoutSeconds: 60
});

const RISK_PERMISSIONS = [
    { key: "Administrator", flag: PermissionFlagsBits.Administrator, severity: "critical" },
    { key: "ManageGuild", flag: PermissionFlagsBits.ManageGuild, severity: "high" },
    { key: "ManageRoles", flag: PermissionFlagsBits.ManageRoles, severity: "high" },
    { key: "ManageChannels", flag: PermissionFlagsBits.ManageChannels, severity: "high" },
    { key: "BanMembers", flag: PermissionFlagsBits.BanMembers, severity: "high" },
    { key: "KickMembers", flag: PermissionFlagsBits.KickMembers, severity: "medium" },
    { key: "ManageWebhooks", flag: PermissionFlagsBits.ManageWebhooks, severity: "high" },
    { key: "MentionEveryone", flag: PermissionFlagsBits.MentionEveryone, severity: "medium" }
];

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function valuesOf(collection) {
    if (!collection) return [];
    if (typeof collection.values === "function") return [...collection.values()];
    if (Array.isArray(collection)) return collection;
    return Object.values(collection);
}

function summarizeBotPresence(guild) {
    const summary = {
        cachedBots: 0,
        online: 0,
        idle: 0,
        dnd: 0,
        offlineOrInvisible: 0,
        unknown: 0
    };

    for (const member of valuesOf(guild.members?.cache)) {
        if (!member.user?.bot) continue;
        summary.cachedBots += 1;
        const status = member.presence?.status;
        if (status === "online") summary.online += 1;
        else if (status === "idle") summary.idle += 1;
        else if (status === "dnd") summary.dnd += 1;
        else if (status === "offline") summary.offlineOrInvisible += 1;
        else summary.unknown += 1;
    }

    return summary;
}

function hasFlag(bitfield, flag) {
    try { return (BigInt(bitfield) & flag) === flag; }
    catch { return false; }
}

function assertManageGuild(guild, actor) {
    if (!guild?.id || !actor?.guild?.id || actor.guild.id !== guild.id) {
        throw new Error("Aktor harus berasal dari server yang sama.");
    }
    if (!actor.permissions?.has(PermissionFlagsBits.ManageGuild)) {
        throw new Error("Kamu membutuhkan izin Manage Server untuk menjalankan audit keamanan.");
    }
}

async function refreshGuildSnapshot(guild) {
    const requests = [];
    if (typeof guild.roles?.fetch === "function") requests.push(guild.roles.fetch());
    if (typeof guild.channels?.fetch === "function") requests.push(guild.channels.fetch());
    await Promise.all(requests);
}

function scanGuild(guild, { now = () => new Date().toISOString(), id = randomUUID } = {}) {
    const roles = valuesOf(guild.roles?.cache);
    const channels = valuesOf(guild.channels?.cache);
    const roleById = new Map(roles.map(role => [role.id, role]));
    const findings = [];
    const seen = new Set();

    function addFinding(finding) {
        const key = `${finding.code}:${finding.subjectId || ""}:${finding.channelId || ""}:${finding.permission || ""}`;
        if (seen.has(key) || findings.length >= MAX_FINDINGS) return;
        seen.add(key);
        findings.push({ id: id(), ...finding });
    }

    for (const role of roles) {
        if (role.managed) continue;
        for (const permission of RISK_PERMISSIONS) {
            if (!hasFlag(role.permissions?.bitfield, permission.flag)) continue;
            addFinding({
                code: "privileged_role",
                severity: permission.severity,
                title: permission.key === "Administrator"
                    ? "Role memiliki akses Administrator"
                    : `Role memiliki izin ${permission.key}`,
                detail: `Role '${role.name}' memberikan izin ${permission.key}.`,
                subjectId: role.id,
                subjectName: role.name,
                permission: permission.key
            });
        }
    }

    for (const channel of channels) {
        const overwrites = valuesOf(channel.permissionOverwrites?.cache);
        for (const overwrite of overwrites) {
            const role = roleById.get(overwrite.id);
            if (Number(overwrite.type) !== 0 || !role) continue;
            for (const permission of RISK_PERMISSIONS) {
                if (!hasFlag(overwrite.allow?.bitfield, permission.flag)) continue;
                const isEveryone = role.id === guild.id;
                addFinding({
                    code: isEveryone ? "everyone_channel_permission" : "channel_role_permission",
                    severity: isEveryone && permission.severity !== "medium"
                        ? "critical"
                        : permission.severity,
                    title: isEveryone
                        ? `@everyone memiliki ${permission.key} di channel`
                        : `Izin ${permission.key} diberikan di channel`,
                    detail: isEveryone
                        ? `Channel '${channel.name}' memberikan ${permission.key} kepada seluruh anggota.`
                        : `Channel '${channel.name}' memberikan ${permission.key} kepada role '${role.name}'.`,
                    subjectId: role.id,
                    subjectName: role.name,
                    channelId: channel.id,
                    channelName: channel.name,
                    permission: permission.key
                });
            }
        }
    }

    findings.sort((a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        a.title.localeCompare(b.title) ||
        a.detail.localeCompare(b.detail)
    );

    const summary = { critical: 0, high: 0, medium: 0, low: 0, total: findings.length };
    for (const finding of findings) summary[finding.severity] += 1;
    return {
        id: id(),
        guildId: guild.id,
        scannedAt: now(),
        summary,
        botPresence: summarizeBotPresence(guild),
        findings,
        automatedActions: []
    };
}

function validateReportCollection(value) {
    return Boolean(
        value &&
        typeof value === "object" &&
        Array.isArray(value.reports) &&
        value.reports.length <= MAX_REPORTS &&
        value.reports.every(report =>
            report &&
            typeof report.id === "string" &&
            typeof report.guildId === "string" &&
            Number.isFinite(Date.parse(report.scannedAt)) &&
            (report.botPresence === undefined ||
                (report.botPresence &&
                    ["cachedBots", "online", "idle", "dnd", "offlineOrInvisible", "unknown"]
                        .every(key => Number.isInteger(report.botPresence[key]) && report.botPresence[key] >= 0) &&
                    report.botPresence.online + report.botPresence.idle + report.botPresence.dnd +
                        report.botPresence.offlineOrInvisible + report.botPresence.unknown === report.botPresence.cachedBots)) &&
            Array.isArray(report.findings) &&
            report.findings.length <= MAX_FINDINGS &&
            report.findings.every(finding =>
                finding &&
                typeof finding.id === "string" &&
                typeof finding.code === "string" &&
                ["critical", "high", "medium", "low"].includes(finding.severity) &&
                typeof finding.title === "string" &&
                typeof finding.detail === "string"
            )
        )
    );
}

function validateOfflinePolicy(input) {
    if (!input || typeof input !== "object" || typeof input.enabled !== "boolean") {
        throw new Error("Status kebijakan harus berupa ON atau OFF.");
    }
    const { thresholdMinutes, maxObservationGapMinutes } = input;
    if (!Number.isInteger(thresholdMinutes) || thresholdMinutes < 5 || thresholdMinutes > 10080) {
        throw new Error("Threshold offline harus antara 5 sampai 10080 menit.");
    }
    if (!Number.isInteger(maxObservationGapMinutes) ||
        maxObservationGapMinutes < 1 ||
        maxObservationGapMinutes > 60 ||
        maxObservationGapMinutes >= thresholdMinutes) {
        throw new Error("Jarak sampel harus antara 1-60 menit dan lebih kecil dari threshold offline.");
    }
    if (!Array.isArray(input.excludedBotIds) || input.excludedBotIds.length > 100) {
        throw new Error("Whitelist harus berisi maksimal 100 ID bot.");
    }
    const excludedBotIds = [...new Set(input.excludedBotIds.map(String))];
    if (excludedBotIds.some(id => !/^\d{17,20}$/.test(id))) {
        throw new Error("Setiap ID whitelist harus berupa Discord Snowflake.");
    }
    return {
        enabled: input.enabled,
        thresholdMinutes,
        maxObservationGapMinutes,
        excludedBotIds
    };
}

function validateSpamPolicy(input) {
    if (!input || typeof input !== "object" || typeof input.enabled !== "boolean") {
        throw new Error("Status moderasi spam harus berupa ON atau OFF.");
    }
    if (!Number.isInteger(input.deleteThreshold) ||
        input.deleteThreshold < 3 || input.deleteThreshold > 20) {
        throw new Error("Threshold hapus harus antara 3 sampai 20 pesan.");
    }
    if (!Number.isInteger(input.timeoutThreshold) ||
        input.timeoutThreshold <= input.deleteThreshold || input.timeoutThreshold > 30) {
        throw new Error("Threshold timeout harus di atas threshold hapus dan maksimal 30 pesan.");
    }
    if (!Number.isInteger(input.timeoutSeconds) ||
        input.timeoutSeconds < 60 || input.timeoutSeconds > 28 * 24 * 60 * 60) {
        throw new Error("Durasi timeout harus antara 60 detik sampai 28 hari.");
    }
    return {
        enabled: input.enabled,
        deleteThreshold: input.deleteThreshold,
        timeoutThreshold: input.timeoutThreshold,
        timeoutSeconds: input.timeoutSeconds
    };
}

function validateAuditLog(value) {
    return Boolean(
        value &&
        typeof value === "object" &&
        Array.isArray(value.events) &&
        value.events.length <= MAX_AUDIT_EVENTS &&
        value.events.every(event =>
            event &&
            typeof event.type === "string" &&
            typeof event.guildId === "string" &&
            Number.isFinite(Date.parse(event.at)) &&
            typeof event.detail === "string"
        )
    );
}

function createSecurityAssistant({ store = new JsonGuildStore(), now, id } = {}) {
    const scanOptions = { now, id };
    const getNow = now || (() => new Date().toISOString());
    const presenceEvaluationQueues = new Map();

    async function appendAuditEvent(guildId, type, detail, actorId = null) {
        const event = {
            id: (id || randomUUID)(),
            guildId,
            at: getNow(),
            type,
            detail,
            ...(actorId ? { actorId } : {})
        };
        await store.update(guildId, "security_audit_log", data => {
            const log = data || { events: [] };
            log.events.unshift(event);
            log.events = log.events.slice(0, MAX_AUDIT_EVENTS);
            return log;
        }, {
            schemaVersion: POLICY_SCHEMA_VERSION,
            defaultValue: { events: [] },
            validate: validateAuditLog
        });
        return event;
    }

    async function recordMonitorEvent(guildId, type, detail) {
        if (typeof type !== "string" || !/^spam_[a-z_]{1,60}$/.test(type) ||
            typeof detail !== "string" || detail.length > 512) {
            throw new TypeError("Security monitor audit event is invalid.");
        }
        return appendAuditEvent(guildId, type, detail);
    }

    async function getPolicy(guildId) {
        return store.read(guildId, "security_offline_policy", {
            schemaVersion: POLICY_SCHEMA_VERSION,
            defaultValue: structuredClone(DEFAULT_OFFLINE_POLICY),
            validate: value => {
                try {
                    validateOfflinePolicy(value);
                    return true;
                } catch {
                    return false;
                }
            }
        });
    }

    async function getSpamPolicy(guildId) {
        return store.read(guildId, "security_spam_policy", {
            schemaVersion: POLICY_SCHEMA_VERSION,
            defaultValue: structuredClone(DEFAULT_SPAM_POLICY),
            validate: value => {
                try {
                    validateSpamPolicy(value);
                    return true;
                } catch {
                    return false;
                }
            }
        });
    }

    async function setSpamPolicy(guild, actor, input) {
        assertManageGuild(guild, actor);
        const policy = validateSpamPolicy(input);
        await appendAuditEvent(
            guild.id,
            "spam_policy_change_authorized",
            `Administrator approved spam moderation policy; enabled=${policy.enabled}; deleteThreshold=${policy.deleteThreshold}; timeoutThreshold=${policy.timeoutThreshold}; timeoutSeconds=${policy.timeoutSeconds}.`,
            actor.id
        );
        await store.update(guild.id, "security_spam_policy", () => policy, {
            schemaVersion: POLICY_SCHEMA_VERSION,
            defaultValue: structuredClone(DEFAULT_SPAM_POLICY),
            validate: value => {
                try {
                    validateSpamPolicy(value);
                    return true;
                } catch {
                    return false;
                }
            }
        });
        return policy;
    }

    async function setPolicy(guild, actor, input) {
        assertManageGuild(guild, actor);
        const policy = validateOfflinePolicy(input);
        await store.update(guild.id, "security_offline_policy", () => policy, {
            schemaVersion: POLICY_SCHEMA_VERSION,
            defaultValue: structuredClone(DEFAULT_OFFLINE_POLICY),
            validate: value => {
                try {
                    validateOfflinePolicy(value);
                    return true;
                } catch {
                    return false;
                }
            }
        });
        if (!policy.enabled) {
            await store.update(guild.id, "security_offline_state", () => ({ bots: {} }), {
                schemaVersion: POLICY_SCHEMA_VERSION,
                defaultValue: { bots: {} },
                validate: value => Boolean(value && typeof value === "object" && value.bots && typeof value.bots === "object")
            });
        }
        await appendAuditEvent(
            guild.id,
            policy.enabled ? "offline_policy_activated" : "offline_policy_disabled",
            `Offline monitoring policy ${policy.enabled ? "enabled" : "disabled"}; threshold=${policy.thresholdMinutes}m; maxGap=${policy.maxObservationGapMinutes}m; exclusions=${policy.excludedBotIds.length}.`,
            actor.id
        );
        return policy;
    }

    async function evaluateOfflinePolicyLocked(guild, report) {
        const policy = await getPolicy(guild.id);
        const members = valuesOf(guild.members?.cache).filter(member => member.user?.bot);
        const observedAt = report.scannedAt;
        const currentTime = Date.parse(observedAt);
        const state = await store.read(guild.id, "security_offline_state", {
            schemaVersion: POLICY_SCHEMA_VERSION,
            defaultValue: { bots: {} },
            validate: value => Boolean(value && typeof value === "object" && value.bots && typeof value.bots === "object")
        });
        const nextBots = { ...state.bots };
        const decisions = [];
        const excluded = new Set(policy.excludedBotIds);

        const decide = async (member, type, detail) => {
            decisions.push({
                botId: member.id,
                botName: member.user.username || member.displayName || member.id,
                type,
                detail
            });
            await appendAuditEvent(guild.id, type, `${member.id}: ${detail}`);
        };

        if (!policy.enabled) {
            await appendAuditEvent(guild.id, "offline_policy_not_enabled", "No offline policy evaluation was activated.");
            return { enabled: false, decisions };
        }

        for (const member of members) {
            if (excluded.has(member.id)) {
                delete nextBots[member.id];
                await decide(member, "offline_policy_excluded", "bot is on the configured exclusion list");
                continue;
            }
            const status = member.presence?.status;
            if (status !== "offline") {
                delete nextBots[member.id];
                await decide(
                    member,
                    status === "online" || status === "idle" || status === "dnd"
                        ? "offline_policy_active"
                        : "offline_policy_unknown",
                    status
                        ? `Discord cache reports status '${status}'; no offline action suggested`
                        : "presence is unavailable; offline status cannot be established"
                );
                continue;
            }

            const previous = nextBots[member.id];
            const previousTime = Date.parse(previous?.lastObservedAt || "");
            const gapLimitMs = policy.maxObservationGapMinutes * 60_000;
            const continuous = Number.isFinite(previousTime) &&
                currentTime >= previousTime &&
                currentTime - previousTime <= gapLimitMs;
            const firstObservedAt = continuous ? previous.firstObservedAt : observedAt;
            nextBots[member.id] = { firstObservedAt, lastObservedAt: observedAt };
            const durationMs = currentTime - Date.parse(firstObservedAt);
            const thresholdMet = Number.isFinite(durationMs) &&
                durationMs >= policy.thresholdMinutes * 60_000;
            await decide(
                member,
                thresholdMet ? "offline_policy_alert_candidate" : "offline_policy_observation",
                thresholdMet
                    ? `explicit cached offline observations span ${Math.floor(durationMs / 60_000)} minutes; alert-only review candidate, no member action`
                    : `explicit cached offline status observed; threshold is ${policy.thresholdMinutes} minutes`
            );
        }

        await store.update(guild.id, "security_offline_state", () => ({ bots: nextBots }), {
            schemaVersion: POLICY_SCHEMA_VERSION,
            defaultValue: { bots: {} },
            validate: value => Boolean(value && typeof value === "object" && value.bots && typeof value.bots === "object")
        });
        return { enabled: true, decisions };
    }

    async function evaluateOfflinePolicy(guild, report) {
        const previous = presenceEvaluationQueues.get(guild.id) || Promise.resolve();
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const queued = previous.then(() => gate);
        presenceEvaluationQueues.set(guild.id, queued);
        await previous;
        try {
            return await evaluateOfflinePolicyLocked(guild, report);
        } finally {
            release();
            if (presenceEvaluationQueues.get(guild.id) === queued) {
                presenceEvaluationQueues.delete(guild.id);
            }
        }
    }

    async function audit(guild, actor) {
        assertManageGuild(guild, actor);
        await refreshGuildSnapshot(guild);
        const report = scanGuild(guild, scanOptions);
        report.offlinePolicy = await evaluateOfflinePolicy(guild, report);
        await store.update(guild.id, COLLECTION, data => {
            const collection = data || { reports: [] };
            collection.reports.unshift(report);
            collection.reports = collection.reports.slice(0, MAX_REPORTS);
            return collection;
        }, {
            schemaVersion: SCHEMA_VERSION,
            defaultValue: { reports: [] },
            validate: validateReportCollection
        });
        return structuredClone(report);
    }

    async function listReports(guildId) {
        const collection = await store.read(guildId, COLLECTION, {
            schemaVersion: SCHEMA_VERSION,
            defaultValue: { reports: [] },
            validate: validateReportCollection
        });
        return collection.reports;
    }

    async function listAuditLog(guildId, limit = 50) {
        const log = await store.read(guildId, "security_audit_log", {
            schemaVersion: POLICY_SCHEMA_VERSION,
            defaultValue: { events: [] },
            validate: validateAuditLog
        });
        return log.events.slice(0, Math.max(1, Math.min(Number(limit) || 50, MAX_AUDIT_EVENTS)));
    }

    return {
        audit,
        listReports,
        getPolicy,
        setPolicy,
        getSpamPolicy,
        setSpamPolicy,
        listAuditLog,
        recordMonitorEvent
    };
}

module.exports = {
    COLLECTION,
    MAX_REPORTS,
    MAX_FINDINGS,
    MAX_AUDIT_EVENTS,
    DEFAULT_OFFLINE_POLICY,
    DEFAULT_SPAM_POLICY,
    RISK_PERMISSIONS,
    createSecurityAssistant,
    scanGuild,
    validateReportCollection,
    validateOfflinePolicy,
    validateSpamPolicy,
    validateAuditLog,
    assertManageGuild,
    summarizeBotPresence
};
