const test = require("node:test");
const assert = require("node:assert/strict");
const { Events, PermissionFlagsBits } = require("discord.js");
const {
    createSecurityMonitor,
    parseSecurityMonitorConfig,
    registerSecurityMonitor
} = require("../../src/security/monitor");

const guildId = "12345678901234567";
const userId = "22345678901234567";
const channelId = "32345678901234567";

function createPermissionSet(permissions) {
    const granted = new Set(permissions);
    return { has: permission => granted.has(permission) };
}

function createFixture(options = {}) {
    const events = [];
    let deletes = 0;
    let timeouts = 0;
    const member = {
        id: userId,
        permissions: createPermissionSet([]),
        permissionsIn: () => options.memberChannelPermissions || createPermissionSet([]),
        manageable: true,
        roles: {
            highest: { comparePositionTo: () => 1 }
        },
        timeout: async (duration, reason) => {
            timeouts += 1;
            options.onTimeout?.(duration, reason);
        }
    };
    const botMember = {
        permissions: createPermissionSet(
            options.botPermissions || [
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.ModerateMembers
            ]
        ),
        roles: { highest: { comparePositionTo: () => 1 } }
    };
    const channel = {
        id: channelId,
        permissionsFor: target => target === botMember
            ? botMember.permissions
            : target?.permissionsIn?.(channel) || target?.permissions
    };
    const monitor = createSecurityMonitor({
        enabled: true,
        windowMs: 10_000,
        deleteThreshold: 5,
        timeoutThreshold: 8,
        timeoutSeconds: 60,
        clock: () => options.now ?? 100_000,
        featureGuard: options.featureGuard || (async () => ({ allowed: true })),
        getSpamPolicy: options.getSpamPolicy || (async () => ({
            enabled: true,
            deleteThreshold: 5,
            timeoutThreshold: 8,
            timeoutSeconds: 60
        })),
        recordAuditEvent: async (_guild, type, detail) => {
            if (options.auditFailure) throw new Error("audit unavailable");
            events.push({ type, detail });
        },
        logger: { error() {}, warn() {} },
        ...options.monitorOptions
    });

    function makeMessage(content = "duplicate") {
        return {
            guild: {
                id: guildId,
                ownerId: "42345678901234567",
                members: { me: botMember }
            },
            channel,
            author: { id: userId, bot: false },
            member,
            content,
            delete: async () => { deletes += 1; }
        };
    }

    return {
        monitor,
        events,
        member,
        makeMessage,
        get deletes() { return deletes; },
        get timeouts() { return timeouts; }
    };
}

test("security monitor deletes repeated identical spam and applies one bounded timeout", async () => {
    let timeoutRequest;
    const fixture = createFixture({
        onTimeout: (duration, reason) => { timeoutRequest = { duration, reason }; }
    });
    const results = await Promise.all(
        Array.from({ length: 8 }, () => fixture.monitor.handleMessage(fixture.makeMessage()))
    );

    assert.equal(fixture.deletes, 4);
    assert.equal(fixture.timeouts, 1);
    assert.deepEqual(timeoutRequest, {
        duration: 60_000,
        reason: "Repeated identical spam messages"
    });
    assert.equal(results.at(-1).action, "timeout_applied");
    assert.equal(fixture.events.filter(event => event.type === "spam_message_deleted").length, 4);
    assert.equal(fixture.events.filter(event => event.type === "spam_timeout_applied").length, 1);
    assert.ok(fixture.events.every(event => !event.detail.includes("duplicate")));
});

test("security monitor ignores privileged, exempt, bot, and webhook messages", async () => {
    const fixture = createFixture({
        monitorOptions: { exemptUserIds: [userId] }
    });
    const exempt = fixture.makeMessage();
    const bot = { ...fixture.makeMessage(), author: { id: userId, bot: true } };
    const webhook = { ...fixture.makeMessage(), webhookId: "webhook" };
    const admin = {
        ...fixture.makeMessage(),
        member: {
            ...fixture.member,
            permissionsIn: () => createPermissionSet([PermissionFlagsBits.ManageGuild])
        }
    };

    await Promise.all(
        Array.from({ length: 10 }, () => fixture.monitor.handleMessage(exempt))
    );
    await Promise.all(
        Array.from({ length: 10 }, () => fixture.monitor.handleMessage(bot))
    );
    await Promise.all(
        Array.from({ length: 10 }, () => fixture.monitor.handleMessage(webhook))
    );
    await Promise.all(
        Array.from({ length: 10 }, () => fixture.monitor.handleMessage(admin))
    );
    assert.equal(fixture.deletes, 0);
    assert.equal(fixture.timeouts, 0);
});

test("security monitor fails closed when member permissions are unavailable", async () => {
    const fixture = createFixture();
    const message = fixture.makeMessage();
    message.member = { id: userId, timeout: async () => assert.fail("unknown member must not be timed out") };
    for (let index = 0; index < 10; index += 1) {
        await fixture.monitor.handleMessage(message);
    }
    assert.equal(fixture.deletes, 0);
    assert.equal(fixture.timeouts, 0);
});

test("security monitor fails closed without permissions or when feature is disabled", async () => {
    const noPermission = createFixture({ botPermissions: [] });
    for (let index = 0; index < 5; index += 1) {
        await noPermission.monitor.handleMessage(noPermission.makeMessage());
    }
    assert.equal(noPermission.deletes, 0);
    assert.ok(noPermission.events.some(event => event.type === "spam_delete_blocked_permission"));

    const disabled = createFixture({
        featureGuard: async () => ({ allowed: false })
    });
    for (let index = 0; index < 5; index += 1) {
        await disabled.monitor.handleMessage(disabled.makeMessage());
    }
    assert.equal(disabled.deletes, 0);
    assert.ok(disabled.events.some(event => event.type === "spam_action_blocked_feature_disabled"));
});

test("security monitor keeps bounded state and validates deployment policy", async () => {
    const fixture = createFixture({
        monitorOptions: {
            deleteThreshold: 5,
            timeoutThreshold: 8,
            maxTrackedPatterns: 2
        }
    });
    for (const text of ["one", "two", "three", "four"]) {
        await fixture.monitor.handleMessage(fixture.makeMessage(text));
    }
    assert.ok(fixture.monitor.getTrackedPatternCount() <= 2);

    assert.deepEqual(parseSecurityMonitorConfig({}), {
        enabled: true,
        windowMs: 10_000,
        deleteThreshold: 5,
        exemptUserIds: []
    });
    assert.equal(parseSecurityMonitorConfig({
        SECURITY_SPAM_DELETE_THRESHOLD: "20"
    }).deleteThreshold, 20);
    assert.throws(() => parseSecurityMonitorConfig({
        SECURITY_SPAM_EXEMPT_IDS: "invalid"
    }), /SECURITY_SPAM_EXEMPT_IDS/);

    const legacyConfig = parseSecurityMonitorConfig({
        SECURITY_AUTO_MODERATION: "yes",
        SECURITY_SPAM_TIMEOUT_THRESHOLD: "4",
        SECURITY_SPAM_TIMEOUT_SECONDS: "invalid"
    });
    assert.equal(legacyConfig.enabled, true);
    assert.equal(legacyConfig.deleteThreshold, 5);
    assert.equal(Object.hasOwn(legacyConfig, "timeoutThreshold"), false);
    assert.equal(Object.hasOwn(legacyConfig, "timeoutSeconds"), false);
});

test("Security Monitor automatically records alert-only observations without a guild policy", async () => {
    const fixture = createFixture({
        getSpamPolicy: async () => ({
            enabled: false,
            deleteThreshold: 5,
            timeoutThreshold: 8,
            timeoutSeconds: 60
        })
    });
    const results = [];
    for (let index = 0; index < 8; index += 1) {
        results.push(await fixture.monitor.handleMessage(fixture.makeMessage()));
    }
    assert.equal(fixture.deletes, 0);
    assert.equal(fixture.timeouts, 0);
    assert.equal(fixture.events.filter(event => event.type === "spam_alert_observed").length, 1);
    assert.equal(results.at(-1).action, "alert_only");
});

test("Security Monitor applies channel-effective moderator exclusions", async () => {
    const fixture = createFixture({
        memberChannelPermissions: createPermissionSet([PermissionFlagsBits.ManageMessages])
    });
    for (let index = 0; index < 10; index += 1) {
        await fixture.monitor.handleMessage(fixture.makeMessage());
    }
    assert.equal(fixture.deletes, 0);
    assert.equal(fixture.timeouts, 0);

    const unknownPermissions = createFixture();
    const message = unknownPermissions.makeMessage();
    message.member = { id: userId, permissions: createPermissionSet([]) };
    message.channel.permissionsFor = target => target === message.guild.members.me
        ? message.guild.members.me.permissions
        : undefined;
    for (let index = 0; index < 10; index += 1) {
        await unknownPermissions.monitor.handleMessage(message);
    }
    assert.equal(unknownPermissions.deletes, 0);
});

test("Security Monitor fails closed before destructive actions when audit persistence fails", async () => {
    const fixture = createFixture({ auditFailure: true });
    for (let index = 0; index < 5; index += 1) {
        await fixture.monitor.handleMessage(fixture.makeMessage());
    }
    assert.equal(fixture.deletes, 0);
    assert.equal(fixture.timeouts, 0);
});

test("Security Monitor bounds timestamps and queued messages during bursts", async () => {
    const fixture = createFixture({
        monitorOptions: {
            maxPendingMessages: 8,
            maxPendingPerPattern: 2
        }
    });
    for (let index = 0; index < 1_000; index += 1) {
        await fixture.monitor.handleMessage(fixture.makeMessage());
    }
    assert.ok(fixture.monitor.getTrackedTimestampCount() <= 30);

    let releaseAudit;
    const blockedFixture = createFixture({
        monitorOptions: {
            maxPendingMessages: 8,
            maxPendingPerPattern: 2
        },
        getSpamPolicy: async () => new Promise(resolve => {
            releaseAudit = () => resolve({
                enabled: false,
                deleteThreshold: 5,
                timeoutThreshold: 8,
                timeoutSeconds: 60
            });
        })
    });
    const pending = Array.from({ length: 10 }, () =>
        blockedFixture.monitor.handleMessage(blockedFixture.makeMessage())
    );
    assert.ok(blockedFixture.monitor.getPendingMessageCount() <= 8);
    blockedFixture.monitor.clear();
    releaseAudit?.();
    await Promise.all(pending);
    assert.equal(blockedFixture.monitor.getPendingMessageCount(), 0);
});

test("security monitor will not timeout a member above the bot role", async () => {
    const fixture = createFixture();
    const first = fixture.makeMessage();
    first.guild.members.me.roles.highest.comparePositionTo = () => -1;
    await fixture.monitor.handleMessage(first);
    for (let index = 0; index < 7; index += 1) {
        await fixture.monitor.handleMessage(fixture.makeMessage());
    }
    assert.equal(fixture.deletes, 4);
    assert.equal(fixture.timeouts, 0);
    assert.ok(fixture.events.some(event => event.type === "spam_timeout_blocked_permission"));
});

test("security monitor registration attaches one message listener and can close cleanly", async () => {
    const handlers = new Map();
    const client = {
        on: (event, handler) => handlers.set(event, handler),
        off: (event, handler) => {
            if (handlers.get(event) === handler) handlers.delete(event);
        }
    };
    const registration = registerSecurityMonitor(client, {
        securityAssistant: {
            recordMonitorEvent: async () => {},
            getSpamPolicy: async () => ({
                enabled: false,
                deleteThreshold: 5,
                timeoutThreshold: 8,
                timeoutSeconds: 60
            })
        },
        environment: {},
        logger: { error() {}, warn() {} }
    });
    assert.equal(registration.enabled, true);
    assert.equal(handlers.has(Events.MessageCreate), true);
    registration.close();
    assert.equal(handlers.has(Events.MessageCreate), false);
});
