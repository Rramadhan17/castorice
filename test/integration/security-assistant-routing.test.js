const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Events, PermissionFlagsBits } = require("discord.js");
const fs = require("node:fs/promises");
const path = require("node:path");
const registerInteractionHandler = require("../../src/events/interactionCreate");
const { buildFeaturePanel } = require("../../src/dashboard/menu-panel");

function makeGuildId() { return `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`; }
function makeGuild(id, allowed = true) {
    return {
        id,
        members: { fetch: async userId => ({ id: userId, guild: { id }, permissions: { has: bit => allowed && bit === PermissionFlagsBits.ManageGuild } }) },
        roles: { cache: new Map(), fetch: async () => {} },
        channels: { cache: new Map(), fetch: async () => {} }
    };
}
function makeInteraction(guild, permitted = true, customId = "castorice:security_audit") {
    const calls = {};
    return {
        calls, guild, guildId: guild.id, user: { id: "23456789012345678" },
        customId, memberPermissions: { has: () => permitted },
        isChatInputCommand: () => false, isButton: () => true, isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        reply: async payload => { calls.reply = payload; },
        deferReply: async payload => { calls.deferred = payload; },
        editReply: async payload => { calls.edited = payload; },
        followUp: async payload => { calls.followUp = payload; }
    };
}

test("Security Assistant Dashboard button runs a permission-checked, private audit", async t => {
    const guild = makeGuild(makeGuildId());
    const directory = path.resolve(__dirname, "../../data/guilds", guild.id);
    t.after(async () => fs.rm(directory, { recursive: true, force: true }));
    const client = new EventEmitter();
    registerInteractionHandler(client);
    const onInteraction = client.listeners(Events.InteractionCreate)[0];
    const interaction = makeInteraction(guild);
    await onInteraction(interaction);
    assert.deepEqual(interaction.calls.deferred, { flags: 64 });
    assert.match(interaction.calls.edited.embeds[0].data.description, /tidak ada temuan/i);
    assert.match(interaction.calls.edited.embeds[0].data.description, /offline\/invisible/);
    assert.match(interaction.calls.edited.embeds[0].data.description, /tidak membuktikan bot mati/);

    const denied = makeInteraction(guild, false);
    await onInteraction(denied);
    assert.match(denied.calls.reply.content, /Manage Server/i);
});

test("Security Assistant Dashboard exposes a private, permission-checked audit history", async t => {
    const guild = makeGuild(makeGuildId());
    const directory = path.resolve(__dirname, "../../data/guilds", guild.id);
    t.after(async () => fs.rm(directory, { recursive: true, force: true }));
    const report = {
        id: "report-history",
        scannedAt: "2026-11-06T12:00:00.000Z",
        summary: { critical: 1, high: 0, medium: 0, low: 0, total: 1 }
    };
    const client = new EventEmitter();
    registerInteractionHandler(client, {
        securityAssistant: {
            audit: async () => report,
            listReports: async guildId => {
                assert.equal(guildId, guild.id);
                return [report];
            },
            listAuditLog: async guildId => {
                assert.equal(guildId, guild.id);
                return [{
                    at: "2026-11-06T12:01:00.000Z",
                    type: "spam_timeout_applied",
                    detail: "member=22345678901234567; count=8"
                }];
            }
        }
    });
    const onInteraction = client.listeners(Events.InteractionCreate)[0];
    const panelButtons = buildFeaturePanel("security_assistant").components
        .flatMap(row => row.components.map(component => component.toJSON()));
    assert.equal(panelButtons.some(button => button.custom_id === "castorice:security_history"), true);
    assert.match(buildFeaturePanel("security_assistant").embeds[0].data.description, /mode alert-only/i);
    assert.equal(panelButtons.some(button => button.custom_id === "castorice:security_spam_policy"), true);

    const interaction = makeInteraction(guild, true, "castorice:security_history");
    await onInteraction(interaction);
    assert.deepEqual(interaction.calls.deferred, { flags: 64 });
    assert.match(interaction.calls.edited.embeds[0].data.description, /report-history/);
    assert.match(interaction.calls.edited.embeds[0].data.description, /1 critical/);
    assert.match(interaction.calls.edited.embeds[0].data.description, /spam_timeout_applied/);

    const denied = makeInteraction(guild, false, "castorice:security_history");
    await onInteraction(denied);
    assert.match(denied.calls.reply.content, /Manage Server/i);
});

test("spam moderation Dashboard requires preview, requester confirmation, and Manage Server", async () => {
    const guild = makeGuild(makeGuildId());
    const defaultPolicy = {
        enabled: false,
        deleteThreshold: 5,
        timeoutThreshold: 8,
        timeoutSeconds: 60
    };
    let saved = 0;
    const client = new EventEmitter();
    registerInteractionHandler(client, {
        securityAssistant: {
            audit: async () => ({ summary: { critical: 0, high: 0, medium: 0, low: 0 }, findings: [] }),
            getSpamPolicy: async () => defaultPolicy,
            setSpamPolicy: async (targetGuild, actor, policy) => {
                assert.equal(targetGuild.id, guild.id);
                assert.equal(actor.id, "23456789012345678");
                saved += 1;
                return policy;
            }
        }
    });
    const onInteraction = client.listeners(Events.InteractionCreate)[0];
    const open = makeInteraction(guild, true, "castorice:security_spam_policy");
    let modal;
    open.showModal = async value => { modal = value.toJSON(); };
    await onInteraction(open);
    assert.equal(modal.custom_id, "castorice:security_spam_policy_submit");

    let preview;
    const submit = {
        ...makeInteraction(guild),
        customId: "castorice:security_spam_policy_submit",
        isButton: () => false,
        isModalSubmit: () => true,
        fields: {
            getTextInputValue: key => ({
                security_spam_enabled: "ON",
                security_spam_delete_threshold: "4",
                security_spam_timeout_threshold: "9",
                security_spam_timeout_seconds: "120"
            })[key]
        },
        reply: async payload => { preview = payload; }
    };
    await onInteraction(submit);
    assert.equal(preview.flags, 64);
    assert.match(preview.embeds[0].data.description, /AKTIF setelah konfirmasi/);
    assert.equal(saved, 0);

    const confirmationId = preview.components[0].components[0].toJSON().custom_id;
    const confirm = makeInteraction(guild, true, confirmationId);
    await onInteraction(confirm);
    assert.equal(saved, 1);
    assert.match(confirm.calls.edited.content, /diaktifkan/);
});

test("Security policy requires preview, requester confirmation, and Manage Server at activation", async () => {
    const guild = makeGuild(makeGuildId());
    const policy = {
        enabled: false,
        thresholdMinutes: 15,
        maxObservationGapMinutes: 5,
        excludedBotIds: []
    };
    let saved = 0;
    const client = new EventEmitter();
    registerInteractionHandler(client, {
        featureGuard: async () => ({ allowed: true }),
        securityAssistant: {
            audit: async () => assert.fail("policy flow must not start an audit"),
            listReports: async () => [],
            getPolicy: async () => policy,
            setPolicy: async (targetGuild, actor, nextPolicy) => {
                assert.equal(targetGuild.id, guild.id);
                assert.equal(actor.id, "23456789001234567");
                assert.equal(nextPolicy.enabled, true);
                saved += 1;
                return nextPolicy;
            }
        }
    });
    const onInteraction = client.listeners(Events.InteractionCreate)[0];
    const buttons = buildFeaturePanel("security_assistant").components
        .flatMap(row => row.components.map(component => component.toJSON()));
    assert.equal(buttons.some(button => button.custom_id === "castorice:security_policy"), true);

    let modal;
    const open = {
        guild,
        guildId: guild.id,
        user: { id: "23456789001234567" },
        customId: "castorice:security_policy",
        memberPermissions: { has: () => true },
        isChatInputCommand: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        isButton: () => true,
        showModal: async value => { modal = value.toJSON(); },
        reply: async payload => { open.response = payload; }
    };
    await onInteraction(open);
    assert.equal(modal.custom_id, "castorice:security_policy_submit");

    let preview;
    const submit = {
        guild,
        guildId: guild.id,
        user: { id: "23456789001234567" },
        customId: "castorice:security_policy_submit",
        memberPermissions: { has: () => true },
        isChatInputCommand: () => false,
        isModalSubmit: () => true,
        isStringSelectMenu: () => false,
        isButton: () => false,
        fields: {
            getTextInputValue: key => ({
                security_policy_enabled: "ON",
                security_policy_threshold: "15",
                security_policy_gap: "5",
                security_policy_excluded: ""
            })[key]
        },
        reply: async payload => { preview = payload; }
    };
    await onInteraction(submit);
    assert.equal(preview.flags, 64);
    assert.match(preview.embeds[0].data.description, /tidak akan dikeluarkan, diban, atau diubah/i);
    const confirmId = preview.components[0].components[0].toJSON().custom_id;
    assert.equal(saved, 0);

    const confirm = {
        guild,
        guildId: guild.id,
        user: { id: "23456789001234567" },
        customId: confirmId,
        memberPermissions: { has: () => true },
        isChatInputCommand: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        isButton: () => true,
        deferReply: async () => { confirm.deferred = true; },
        editReply: async payload => { confirm.response = payload; },
        reply: async payload => { confirm.denied = payload; }
    };
    const wrongRequester = {
        ...confirm,
        user: { id: "23456789001234568" },
        denied: null,
        reply: async payload => { wrongRequester.denied = payload; }
    };
    await onInteraction(wrongRequester);
    assert.match(wrongRequester.denied.content, /hanya dapat digunakan oleh pemintanya/i);
    assert.equal(saved, 0);

    const unauthorized = {
        ...confirm,
        memberPermissions: { has: () => false },
        denied: null,
        reply: async payload => { unauthorized.denied = payload; }
    };
    await onInteraction(unauthorized);
    assert.match(unauthorized.denied.content, /Manage Server/i);
    assert.equal(saved, 0);

    await onInteraction(confirm);
    assert.equal(confirm.deferred, true);
    assert.equal(saved, 1);
    assert.match(confirm.response.content, /Tidak ada tindakan otomatis/);
});

test("Security Assistant AI Tag routes an audit request", async t => {
    const guild = makeGuild(makeGuildId());
    const directory = path.resolve(__dirname, "../../data/guilds", guild.id);
    t.after(async () => fs.rm(directory, { recursive: true, force: true }));
    const client = new EventEmitter();
    client.user = { id: "34567890123456789" };
    registerInteractionHandler(client);
    const onMessage = client.listeners(Events.MessageCreate)[0];
    let reply;
    await onMessage({
        author: { id: "23456789012345678", bot: false }, guild,
        mentions: { users: new Map([[client.user.id, client.user]]) },
        content: `<@${client.user.id}> cek keamanan`,
        reply: async payload => { reply = payload; }
    });
    assert.match(reply.content, /Security audit selesai/i);
    assert.match(reply.content, /Bot di cache: 0/);
    assert.match(reply.content, /bukan bukti bot mati/);
    assert.deepEqual(reply.allowedMentions, { parse: [] });

    let history;
    await onMessage({
        author: { id: "234567890012345678", bot: false },
        guild,
        mentions: { users: new Map([[client.user.id, client.user]]) },
        content: `<@${client.user.id}> riwayat audit`,
        reply: async payload => { history = payload; }
    });
    assert.match(history.content, /Riwayat audit keamanan terbaru/);
    assert.match(history.content, /critical, 0 high/);
});
