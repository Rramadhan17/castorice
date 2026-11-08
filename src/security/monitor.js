const { createHash } = require("node:crypto");
const { Events, PermissionFlagsBits } = require("discord.js");
const { checkFeature } = require("../core/feature-guard");

const DEFAULT_WINDOW_MS = 10_000;
const DEFAULT_DELETE_THRESHOLD = 5;
const DEFAULT_TIMEOUT_THRESHOLD = 8;
const DEFAULT_TIMEOUT_SECONDS = 60;
const MAX_TRACKED_PATTERNS = 5_000;
const MAX_TRACKED_TIMESTAMPS = 30;
const MAX_TIMEOUT_SECONDS = 28 * 24 * 60 * 60;

function parseBoundedInteger(value, fallback, min, max, name) {
    if (value === undefined || value === "") return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new TypeError(`${name} must be between ${min} and ${max}.`);
    }
    return parsed;
}

function parseSecurityMonitorConfig(environment = process.env) {
    const deleteThreshold = parseBoundedInteger(
        environment.SECURITY_SPAM_DELETE_THRESHOLD,
        DEFAULT_DELETE_THRESHOLD,
        3,
        20,
        "SECURITY_SPAM_DELETE_THRESHOLD"
    );

    const exemptUserIds = environment.SECURITY_SPAM_EXEMPT_IDS
        ? environment.SECURITY_SPAM_EXEMPT_IDS.split(",").map(value => value.trim()).filter(Boolean)
        : [];

    if (exemptUserIds.length > 100 ||
        exemptUserIds.some(userId => !/^\d{17,20}$/.test(userId)) ||
        new Set(exemptUserIds).size !== exemptUserIds.length) {
        throw new TypeError("SECURITY_SPAM_EXEMPT_IDS must contain up to 100 unique Discord user IDs.");
    }

    return {
        enabled: true,
        windowMs: parseBoundedInteger(
            environment.SECURITY_SPAM_WINDOW_MS,
            DEFAULT_WINDOW_MS,
            1_000,
            60_000,
            "SECURITY_SPAM_WINDOW_MS"
        ),
        deleteThreshold,
        exemptUserIds
    };
}
function hasPermission(member, channel, permission) {
    try {
        const resolved = member?.permissionsIn?.(channel) ||
            channel?.permissionsFor?.(member);
        return Boolean(resolved?.has?.(permission));
    } catch {
        return false;
    }
}

function isPrivilegedMember(member, guild, channel) {
    if (!member?.id || member.id === guild?.ownerId) return true;
    let effectivePermissions;
    try {
        effectivePermissions = member.permissionsIn?.(channel) ||
            channel?.permissionsFor?.(member);
    } catch {
        return true;
    }
    if (typeof effectivePermissions?.has !== "function") return true;
    return [
        PermissionFlagsBits.Administrator,
        PermissionFlagsBits.ManageGuild,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ModerateMembers
    ].some(permission => {
        try {
            return Boolean(effectivePermissions.has(permission));
        } catch {
            return true;
        }
    });
}

function canTimeout(botMember, member) {
    if (!member || typeof member.timeout !== "function" || member.manageable === false) return false;
    const botRole = botMember?.roles?.highest;
    const memberRole = member.roles?.highest;
    if (typeof botRole?.comparePositionTo !== "function" || !memberRole) return false;
    return botRole.comparePositionTo(memberRole) > 0;
}

function createSecurityMonitor({
    enabled = true,
    windowMs = DEFAULT_WINDOW_MS,
    deleteThreshold = DEFAULT_DELETE_THRESHOLD,
    timeoutThreshold = DEFAULT_TIMEOUT_THRESHOLD,
    timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
    exemptUserIds = [],
    ownerId = null,
    featureGuard = checkFeature,
    getSpamPolicy = async () => ({ enabled: false }),
    recordAuditEvent,
    logger = console,
    clock = () => Date.now(),
    maxTrackedPatterns = MAX_TRACKED_PATTERNS,
    maxPendingMessages = 5_000,
    maxPendingPerPattern = 20
} = {}) {
    if (typeof enabled !== "boolean" ||
        !Number.isInteger(windowMs) || windowMs < 1_000 || windowMs > 60_000 ||
        !Number.isInteger(deleteThreshold) || deleteThreshold < 3 || deleteThreshold > 20 ||
        !Number.isInteger(timeoutThreshold) || timeoutThreshold <= deleteThreshold || timeoutThreshold > 30 ||
        !Number.isInteger(timeoutSeconds) || timeoutSeconds < 60 || timeoutSeconds > MAX_TIMEOUT_SECONDS ||
        !Array.isArray(exemptUserIds) || exemptUserIds.length > 100 ||
        exemptUserIds.some(userId => !/^\d{17,20}$/.test(userId)) ||
        typeof featureGuard !== "function" ||
        typeof getSpamPolicy !== "function" ||
        typeof recordAuditEvent !== "function" ||
        typeof clock !== "function" ||
        !Number.isInteger(maxTrackedPatterns) || maxTrackedPatterns < 1 ||
        !Number.isInteger(maxPendingMessages) || maxPendingMessages < 1 ||
        !Number.isInteger(maxPendingPerPattern) || maxPendingPerPattern < 1) {
        throw new TypeError("Security monitor configuration is invalid.");
    }

    const excludedUsers = new Set([...exemptUserIds, ownerId].filter(Boolean));
    const patterns = new Map();
    const queues = new Map();
    let pendingMessages = 0;
    let closed = false;

    async function audit(guildId, type, detail) {
        try {
            await recordAuditEvent(guildId, type, detail);
        } catch (error) {
            logger.error?.("[Security Monitor Audit Error]", error?.code || error?.name || "unknown");
            throw error;
        }
    }

    async function processMessage(message, key) {
        const now = clock();
        let pattern = patterns.get(key);
        if (!pattern || now < pattern.timestamps.at(-1) || now - pattern.timestamps.at(-1) > windowMs) {
            pattern = {
                timestamps: [],
                alertRecorded: false,
                alertAuditFailed: false,
                timeoutAttempted: false
            };
            patterns.set(key, pattern);
        }
        pattern.timestamps = pattern.timestamps.filter(timestamp => now - timestamp <= windowMs);
        if (pattern.timestamps.length >= MAX_TRACKED_TIMESTAMPS) pattern.timestamps.shift();
        pattern.timestamps.push(now);
        while (patterns.size > maxTrackedPatterns) {
            const oldestKey = patterns.keys().next().value;
            if (oldestKey === undefined || oldestKey === key) break;
            patterns.delete(oldestKey);
        }
        const count = pattern.timestamps.length;
        if (count < Math.min(deleteThreshold, 3)) return { action: "below_threshold" };
        if (pattern.alertAuditFailed) return { action: "audit_failed" };
        const spamPolicy = await getSpamPolicy(message.guild.id);
        const alertThreshold = spamPolicy?.enabled
            ? Math.min(deleteThreshold, spamPolicy.deleteThreshold)
            : deleteThreshold;
        if (count < alertThreshold) return { action: "below_threshold" };

        if (!pattern.alertRecorded) {
            try {
                await audit(
                    message.guild.id,
                    "spam_alert_observed",
                    `member=${message.author.id}; channel=${message.channel.id}; count=${count}`
                );
            } catch (error) {
                pattern.alertAuditFailed = true;
                throw error;
            }
            pattern.alertRecorded = true;
        }
        if (closed) return { action: "closed" };
        if (!spamPolicy?.enabled || count < spamPolicy.deleteThreshold) {
            return { action: "alert_only" };
        }

        const feature = await featureGuard(message.guild.id, "security_assistant");
        if (!feature?.allowed) {
            await audit(
                message.guild.id,
                "spam_action_blocked_feature_disabled",
                `member=${message.author.id}; channel=${message.channel.id}; count=${count}`
            );
            return { action: "feature_disabled" };
        }

        const botMember = message.guild.members?.me;
        if (!hasPermission(botMember, message.channel, PermissionFlagsBits.ManageMessages)) {
            await audit(
                message.guild.id,
                "spam_delete_blocked_permission",
                `member=${message.author.id}; channel=${message.channel.id}; count=${count}`
            );
            return { action: "permission_blocked" };
        }

        if (typeof message.delete !== "function") {
            await audit(
                message.guild.id,
                "spam_delete_blocked_unavailable",
                `member=${message.author.id}; channel=${message.channel.id}; count=${count}`
            );
            return { action: "delete_unavailable" };
        }

        await audit(
            message.guild.id,
            "spam_message_delete_requested",
            `member=${message.author.id}; channel=${message.channel.id}; count=${count}`
        );
        if (closed) return { action: "closed" };
        try {
            await message.delete();
        } catch (error) {
            logger.warn?.("[Security Monitor Delete Error]", error?.code || error?.name || "unknown");
            await audit(
                message.guild.id,
                "spam_delete_failed",
                `member=${message.author.id}; channel=${message.channel.id}; count=${count}`
            );
            return { action: "delete_failed" };
        }
        await audit(
            message.guild.id,
            "spam_message_deleted",
            `member=${message.author.id}; channel=${message.channel.id}; count=${count}`
        );

        if (count < spamPolicy.timeoutThreshold || pattern.timeoutAttempted) {
            return { action: "message_deleted" };
        }
        pattern.timeoutAttempted = true;

        const botCanTimeout = hasPermission(botMember, message.channel, PermissionFlagsBits.ModerateMembers);
        if (!botCanTimeout || !canTimeout(botMember, message.member)) {
            await audit(
                message.guild.id,
                "spam_timeout_blocked_permission",
                `member=${message.author.id}; channel=${message.channel.id}; count=${count}`
            );
            return { action: "timeout_blocked" };
        }

        await audit(
            message.guild.id,
            "spam_timeout_requested",
            `member=${message.author.id}; channel=${message.channel.id}; count=${count}; durationSeconds=${spamPolicy.timeoutSeconds}`
        );
        if (closed) return { action: "closed" };
        try {
            await message.member.timeout(
                spamPolicy.timeoutSeconds * 1_000,
                "Repeated identical spam messages"
            );
        } catch (error) {
            logger.warn?.("[Security Monitor Timeout Error]", error?.code || error?.name || "unknown");
            await audit(
                message.guild.id,
                "spam_timeout_failed",
                `member=${message.author.id}; channel=${message.channel.id}; count=${count}`
            );
            return { action: "timeout_failed" };
        }
        await audit(
            message.guild.id,
            "spam_timeout_applied",
            `member=${message.author.id}; channel=${message.channel.id}; count=${count}; durationSeconds=${spamPolicy.timeoutSeconds}`
        );
        return { action: "timeout_applied" };
    }

    async function handleMessage(message) {
        if (closed || !enabled || !message?.guild?.id || !message.author?.id ||
            message.author.bot || message.webhookId ||
            typeof message.content !== "string" ||
            !message.content.trim() || message.content.length > 2_000 ||
            !message.channel?.id || !message.member?.id ||
            message.member.id !== message.author.id ||
            excludedUsers.has(message.author.id) ||
            isPrivilegedMember(message.member, message.guild, message.channel)) {
            return { action: "ignored" };
        }

        const normalized = message.content.normalize("NFKC").trim().toLocaleLowerCase();
        const fingerprint = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
        const key = `${message.guild.id}:${message.channel.id}:${message.author.id}:${fingerprint}`;
        let queue = queues.get(key);
        if (!queue && queues.size >= maxTrackedPatterns) {
            return { action: "busy" };
        }
        if (pendingMessages >= maxPendingMessages ||
            (queue && queue.items.length >= maxPendingPerPattern)) {
            return { action: "busy" };
        }
        if (!queue) {
            queue = { items: [], running: false };
            queues.set(key, queue);
        }
        pendingMessages += 1;
        return new Promise(resolve => {
            queue.items.push({ message, resolve });
            if (!queue.running) void drainQueue(key, queue);
        });
    }

    async function drainQueue(key, queue) {
        queue.running = true;
        while (queue.items.length && !closed) {
            const item = queue.items.shift();
            pendingMessages -= 1;
            try {
                item.resolve(await processMessage(item.message, key));
            } catch (error) {
                logger.error?.("[Security Monitor Error]", error?.code || error?.name || "unknown");
                item.resolve({ action: "audit_failed", error });
            }
        }
        for (const item of queue.items.splice(0)) {
            pendingMessages -= 1;
            item.resolve({ action: "closed" });
        }
        if (queues.get(key) === queue) queues.delete(key);
    }

    function clear() {
        closed = true;
        patterns.clear();
        for (const queue of queues.values()) {
            for (const item of queue.items.splice(0)) {
                pendingMessages -= 1;
                item.resolve({ action: "closed" });
            }
        }
        queues.clear();
    }

    return {
        handleMessage,
        clear,
        getTrackedPatternCount: () => patterns.size,
        getTrackedTimestampCount: () => [...patterns.values()]
            .reduce((total, pattern) => total + pattern.timestamps.length, 0),
        getPendingMessageCount: () => pendingMessages
    };
}

function registerSecurityMonitor(client, {
    securityAssistant,
    ownerId = null,
    environment = process.env,
    featureGuard = checkFeature,
    logger = console,
    clock
} = {}) {
    if (!client || typeof client.on !== "function") {
        throw new TypeError("Discord client is required for Security Monitor.");
    }
    if (!securityAssistant || typeof securityAssistant.recordMonitorEvent !== "function") {
        throw new TypeError("Security Assistant audit service is required.");
    }
    if (typeof securityAssistant.getSpamPolicy !== "function") {
        throw new TypeError("Security Assistant spam policy service is required.");
    }

    const config = parseSecurityMonitorConfig(environment);
    const monitor = createSecurityMonitor({
        ...config,
        ownerId,
        featureGuard,
        getSpamPolicy: guildId => securityAssistant.getSpamPolicy(guildId),
        recordAuditEvent: (guildId, type, detail) =>
            securityAssistant.recordMonitorEvent(guildId, type, detail),
        logger,
        clock
    });
    const listener = message => {
        monitor.handleMessage(message).catch(error => {
            logger.error?.("[Security Monitor Error]", error?.code || error?.name || "unknown");
        });
    };
    client.on(Events.MessageCreate, listener);

    return {
        enabled: config.enabled,
        close() {
            if (typeof client.off === "function") client.off(Events.MessageCreate, listener);
            else if (typeof client.removeListener === "function") {
                client.removeListener(Events.MessageCreate, listener);
            }
            monitor.clear();
        }
    };
}

module.exports = {
    DEFAULT_WINDOW_MS,
    DEFAULT_DELETE_THRESHOLD,
    DEFAULT_TIMEOUT_THRESHOLD,
    DEFAULT_TIMEOUT_SECONDS,
    parseSecurityMonitorConfig,
    createSecurityMonitor,
    registerSecurityMonitor,
    hasPermission,
    isPrivilegedMember
};
