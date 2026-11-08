const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { PermissionFlagsBits } = require("discord.js");
const { JsonGuildStore } = require("../../src/storage/json-guild-store");
const {
    DEFAULT_SPAM_POLICY,
    createSecurityAssistant,
    validateSpamPolicy
} = require("../../src/security/assistant");

const guildId = "12345678901234567";
const actor = { guild: { id: guildId }, permissions: { has: bit => bit === PermissionFlagsBits.ManageGuild } };

test("security audit finds risky roles and channel overwrites and persists a report", async t => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "castorice-security-"));
    t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
    const everyone = { id: guildId, name: "@everyone", managed: false, permissions: { bitfield: 0n } };
    const admin = { id: "role-admin", name: "Admins", managed: false, permissions: { bitfield: PermissionFlagsBits.Administrator } };
    const guild = {
        id: guildId,
        roles: { cache: new Map([[everyone.id, everyone], [admin.id, admin]]), fetch: async () => {} },
        members: { cache: new Map([
            ["bot-online", { user: { bot: true }, presence: { status: "online" } }],
            ["bot-hidden", { user: { bot: true }, presence: { status: "offline" } }],
            ["bot-unknown", { user: { bot: true }, presence: null }],
            ["human", { user: { bot: false }, presence: { status: "online" } }]
        ]) },
        channels: { cache: new Map([[
            "channel-public",
            { id: "channel-public", name: "public", permissionOverwrites: { cache: new Map([["everyone", { id: guildId, type: 0, allow: { bitfield: PermissionFlagsBits.ManageChannels } }]]) } }
        ]]), fetch: async () => {} }
    };
    const service = createSecurityAssistant({ store: new JsonGuildStore({ rootDir }), now: () => "2026-01-01T00:00:00.000Z" });
    const report = await service.audit(guild, actor);
    assert.equal(report.summary.critical, 2);
    assert.equal(report.automatedActions.length, 0);
    assert.deepEqual(report.botPresence, {
        cachedBots: 3,
        online: 1,
        idle: 0,
        dnd: 0,
        offlineOrInvisible: 1,
        unknown: 1
    });
    assert.equal((await service.listReports(guildId))[0].id, report.id);
});

test("presence summary never treats unavailable cache entries as offline", () => {
    const { summarizeBotPresence } = require("../../src/security/assistant");
    const result = summarizeBotPresence({
        members: {
            cache: new Map([
                ["unknown", { user: { bot: true }, presence: null }],
                ["human", { user: { bot: false }, presence: null }]
            ])
        }
    });
    assert.deepEqual(result, {
        cachedBots: 1,
        online: 0,
        idle: 0,
        dnd: 0,
        offlineOrInvisible: 0,
        unknown: 1
    });
});

test("security audit requires a same-guild Manage Server actor", async () => {
    const service = createSecurityAssistant();
    await assert.rejects(service.audit({ id: guildId }, { guild: { id: guildId }, permissions: { has: () => false } }), /Manage Server/i);
    await assert.rejects(service.audit({ id: guildId }, { guild: { id: guildId }, permissions: { has: () => false } }), /Manage Server/i);
    await assert.rejects(service.audit({ id: guildId }, { guild: { id: "other" }, permissions: { has: () => true } }), /server yang sama/i);
});

test("offline policy requires explicit offline samples, continuity, exclusions, and logs decisions", async t => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "castorice-security-policy-"));
    t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
    let time = Date.parse("2026-11-06T10:00:00.000Z");
    let sequence = 0;
    const service = createSecurityAssistant({
        store: new JsonGuildStore({ rootDir }),
        now: () => new Date(time).toISOString(),
        id: () => `id-${++sequence}`
    });

    test("spam moderation policy is guild-scoped, disabled by default, and audit-confirmed", async t => {
        const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "castorice-security-spam-policy-"));
        t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
        const service = createSecurityAssistant({ store: new JsonGuildStore({ rootDir }) });
        const otherGuildId = "62345678901234567";
        const guild = { id: guildId };
        const admin = {
            id: "52345678901234567",
            guild: { id: guildId },
            permissions: { has: flag => flag === PermissionFlagsBits.ManageGuild }
        };

        assert.deepEqual(await service.getSpamPolicy(guildId), DEFAULT_SPAM_POLICY);
        const policy = await service.setSpamPolicy(guild, admin, {
            enabled: true,
            deleteThreshold: 4,
            timeoutThreshold: 9,
            timeoutSeconds: 120
        });
        assert.equal(policy.enabled, true);
        assert.deepEqual(await service.getSpamPolicy(otherGuildId), DEFAULT_SPAM_POLICY);
        const events = await service.listAuditLog(guildId);
        assert.equal(events[0].type, "spam_policy_change_authorized");
        assert.equal(events[0].actorId, admin.id);
        assert.throws(() => validateSpamPolicy({
            enabled: true,
            deleteThreshold: 9,
            timeoutThreshold: 8,
            timeoutSeconds: 60
        }), /threshold timeout/i);
        await assert.rejects(service.setSpamPolicy(guild, {
            ...admin,
            permissions: { has: () => false }
        }, policy), /Manage Server/i);
    });

    test("spam moderation policy fails closed when authorization audit cannot be persisted", async () => {
        let policyWrites = 0;
        const service = createSecurityAssistant({
            store: {
                update: async (_guildId, collection) => {
                    if (collection === "security_audit_log") throw new Error("audit write failure");
                    if (collection === "security_spam_policy") policyWrites += 1;
                }
            }
        });
        const guild = { id: guildId };
        await assert.rejects(service.setSpamPolicy(guild, actor, {
            enabled: true,
            deleteThreshold: 5,
            timeoutThreshold: 8,
            timeoutSeconds: 60
        }), /audit write failure/);
        assert.equal(policyWrites, 0);
    });
    const bot = {
        id: "32345678901234567",
        user: { bot: true, username: "ObservedBot" },
        presence: { status: "offline" }
    };
    const exempt = {
        id: "42345678901234567",
        user: { bot: true, username: "ExcludedBot" },
        presence: { status: "offline" }
    };
    const guild = {
        id: guildId,
        roles: { cache: new Map(), fetch: async () => {} },
        channels: { cache: new Map(), fetch: async () => {} },
        members: { cache: new Map([[bot.id, bot], [exempt.id, exempt]]) }
    };
    const admin = { id: "52345678901234567", guild: { id: guildId }, permissions: { has: flag => flag === PermissionFlagsBits.ManageGuild } };

    await assert.rejects(
        service.setPolicy(guild, admin, {
            enabled: true,
            thresholdMinutes: 5,
            maxObservationGapMinutes: 5,
            excludedBotIds: []
        }),
        /lebih kecil/
    );
    const policy = await service.setPolicy(guild, admin, {
        enabled: true,
        thresholdMinutes: 10,
        maxObservationGapMinutes: 5,
        excludedBotIds: [exempt.id]
    });
    assert.equal(policy.enabled, true);

    const first = await service.audit(guild, admin);
    assert.equal(first.offlinePolicy.decisions.find(item => item.botId === bot.id).type, "offline_policy_observation");
    assert.equal(first.offlinePolicy.decisions.find(item => item.botId === exempt.id).type, "offline_policy_excluded");

    time += 5 * 60_000;
    const second = await service.audit(guild, admin);
    assert.equal(second.offlinePolicy.decisions.find(item => item.botId === bot.id).type, "offline_policy_observation");

    time += 5 * 60_000;
    const third = await service.audit(guild, admin);
    assert.equal(third.offlinePolicy.decisions.find(item => item.botId === bot.id).type, "offline_policy_alert_candidate");
    assert.deepEqual(third.automatedActions, []);

    bot.presence = null;
    time += 5 * 60_000;
    const unknown = await service.audit(guild, admin);
    assert.equal(unknown.offlinePolicy.decisions.find(item => item.botId === bot.id).type, "offline_policy_unknown");

    const auditLog = await service.listAuditLog(guildId);
    assert.ok(auditLog.some(event => event.type === "offline_policy_activated" && event.actorId === admin.id));
    assert.ok(auditLog.some(event => event.type === "offline_policy_alert_candidate"));
    assert.ok(auditLog.some(event => event.type === "offline_policy_unknown"));
});
