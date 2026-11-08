const test = require("node:test");
const assert = require("node:assert/strict");
const { PermissionFlagsBits } = require("discord.js");
const { Events } = require("discord.js");
const { extractTrigger } = require("../../src/ai/natural-trigger");
const registerInteractionHandler = require("../../src/events/interactionCreate");
const { buildDashboard } = require("../../src/dashboard/menu-panel");
const {
    parseVoiceCenterIntent,
    createVoiceCenterTagRouter
} = require("../../src/voice-ai/center-tag-router");
const { createVoiceCenterInteractionHandler } = require("../../src/voice-ai/center-interactions");

const GUILD = "12345678901234567";
const USER = "22345678901234567";
const ROLE = "32345678901234567";
const CHANNEL = "42345678901234567";

function messageFixture(content, options = {}) {
    return {
        content,
        author: { id: USER, bot: false },
        member: {
            id: USER,
            guild: { id: GUILD },
            voice: { channelId: options.channelId || null },
            permissions: { has: permission => permission === PermissionFlagsBits.ManageGuild }
        },
        guild: { id: GUILD },
        mentions: {
            users: { first: () => options.user ? { id: options.user } : null },
            roles: { first: () => options.role ? { id: options.role } : null },
            channels: { first: () => options.channel ? { id: options.channel } : null }
        },
        reply: async payload => { messageFixture.lastReply = payload; }
    };
}

test("Voice Center intent parser covers Auto Kick, trusted lists, protected channels, and voice timers", () => {
    const message = messageFixture("", { channelId: CHANNEL, role: ROLE });
    assert.deepEqual(parseVoiceCenterIntent("aktifkan Auto Kick Voice", message), { action: "auto_toggle", enabled: true });
    assert.deepEqual(parseVoiceCenterIntent("nonaktifkan Auto Kick Voice", message), { action: "auto_toggle", enabled: false });
    assert.equal(parseVoiceCenterIntent("tambahkan member ini ke trusted members", message).targetId, USER);
    assert.equal(parseVoiceCenterIntent("kecualikan role ini dari Auto Kick", message).targetId, ROLE);
    assert.equal(parseVoiceCenterIntent("lindungi voice channel ini", message).targetId, CHANNEL);
    assert.equal(parseVoiceCenterIntent("keluar voice dalam 15 menit", message).durationMs, 900_000);
    assert.equal(parseVoiceCenterIntent("atur timer voice 30 menit", message).durationMs, 1_800_000);
    assert.equal(parseVoiceCenterIntent("tambah timer 10 menit", message).durationMs, 600_000);
    assert.equal(parseVoiceCenterIntent("atur auto disconnect 2 menit 10 detik", message).durationMs, 130_000);
    assert.equal(parseVoiceCenterIntent("batalkan timer voice", message).action, "timer_cancel");
    assert.equal(parseVoiceCenterIntent("reset timer keluar voice", message).action, "timer_reset");
    assert.equal(parseVoiceCenterIntent("cek auto disconnect", message).action, "timer_status");
    assert.equal(parseVoiceCenterIntent("tampilkan sisa timer voice", message).action, "timer_status");
    assert.equal(parseVoiceCenterIntent("berapa lama lagi kamu keluar voice?", message).action, "timer_status");
});

test("Trusted-member language variants resolve explicit member mentions without guessing", () => {
    const mentioned = messageFixture("", { user: "52345678901234567" });
    assert.deepEqual(parseVoiceCenterIntent("tambah <@52345678901234567> ke trusted list", mentioned), {
        action: "trusted_add",
        targetId: "52345678901234567"
    });
    assert.deepEqual(parseVoiceCenterIntent("hapus <@52345678901234567> dari trusted list", mentioned), {
        action: "trusted_remove",
        targetId: "52345678901234567"
    });
    assert.deepEqual(parseVoiceCenterIntent("apakah <@52345678901234567> trusted?", mentioned), {
        action: "trusted_check",
        targetId: "52345678901234567"
    });
    assert.equal(parseVoiceCenterIntent("tampilkan daftar trusted members", mentioned).action, "trusted_list");
    assert.equal(parseVoiceCenterIntent("clear trusted list", mentioned).action, "trusted_clear_confirm");
    assert.equal(parseVoiceCenterIntent("tambah member ke trusted list", messageFixture("")).targetId, null);
});

test("AI Tag Voice Center request reaches backend before any AI Chat fallback", async () => {
    const calls = [];
    const service = {
        isAuthorized: () => true,
        configureAutoKick: async (_guild, _actor, updates) => (calls.push(updates), { enabled: updates.enabled }),
        getConfig: async () => ({ autoKick: { enabled: true, gracePeriodMs: 10_000 }, protectedVoiceChannelIds: [] }),
        listTrustedMembers: async () => ({ memberIds: [], roleIds: [] }),
        getVoiceTimer: async () => null
    };
    const handlers = new Map();
    const client = {
        user: { id: "123456789012345678" },
        on: (event, handler) => handlers.set(event, handler)
    };
    registerInteractionHandler(client, {
        voiceCenterService: service,
        globalAISettings: { getSettings: async () => ({ enabled: false, providerOrder: null, failoverEnabled: null }) },
        logger: { warn() {}, error() {} }
    });
    const message = messageFixture("Castorice, aktifkan Auto Kick Voice");
    await handlers.get(Events.MessageCreate)(message);
    assert.deepEqual(calls, [{ enabled: true }]);
    assert.match(messageFixture.lastReply.content, /ON/);
});

test("AI Tag router rejects ambiguous targets and enforces administrator authorization", async () => {
    const calls = [];
    const service = {
        isAuthorized: () => true,
        addTrustedMember: async (...args) => { calls.push(args); return [USER]; }
    };
    const handle = createVoiceCenterTagRouter({ service, logger: { warn() {} } });
    const ambiguous = messageFixture("", {});
    await handle({ message: ambiguous, commandText: "tambahkan member ke trusted members" });
    assert.equal(calls.length, 0);
    assert.match(messageFixture.lastReply.content, /mention satu member/i);

    service.isAuthorized = () => false;
    const denied = messageFixture("");
    await handle({ message: denied, commandText: "aktifkan Auto Kick Voice" });
    assert.equal(calls.length, 0);
    assert.match(messageFixture.lastReply.content, /Manage Server/);
});

test("Trusted member lists are sent privately rather than exposed in the public channel", async () => {
    const dms = [];
    const replies = [];
    const message = messageFixture("Castorice: show trusted members");
    message.author.send = async payload => dms.push(payload);
    message.reply = async payload => replies.push(payload);
    const handle = createVoiceCenterTagRouter({
        service: {
            isAuthorized: () => true,
            listTrustedMembers: async () => ({
                memberIds: [USER],
                roleIds: [ROLE]
            })
        },
        logger: { warn() {} }
    });

    await handle({ message, commandText: "show trusted members" });

    assert.match(dms[0].content, /<@22345678901234567>/);
    assert.match(dms[0].content, /<@&32345678901234567>/);
    assert.equal(dms[0].allowedMentions.parse.length, 0);
    assert.equal(replies.length, 0);
});

test("Trusted member list DM failure returns only a generic public notice", async () => {
    const replies = [];
    const warnings = [];
    const message = messageFixture("Castorice: show trusted members");
    message.author.send = async () => {
        throw new Error("DM unavailable");
    };
    message.reply = async payload => replies.push(payload);
    const handle = createVoiceCenterTagRouter({
        service: {
            isAuthorized: () => true,
            listTrustedMembers: async () => ({
                memberIds: [USER],
                roleIds: [ROLE]
            })
        },
        logger: { warn: (...args) => warnings.push(args) }
    });

    await handle({ message, commandText: "show trusted members" });

    assert.equal(replies.length, 1);
    assert.match(replies[0].content, /hanya dikirim lewat DM/i);
    assert.doesNotMatch(replies[0].content, /22345678901234567|32345678901234567/);
    assert.deepEqual(warnings, [["[Voice Center Private List Error]", "dm_unavailable"]]);
});

test("Dashboard includes a unique Voice AI Center control and respects component row limits", () => {
    const payload = buildDashboard({
        id: GUILD,
        voiceStates: { cache: { filter: () => ({ size: 0 }) } },
        channels: { cache: { filter: () => ({ size: 0 }) } },
        members: { me: { voice: { channel: null } } }
    });
    const buttons = payload.components.flatMap(row => row.components.map(component => component.toJSON()));
    const ids = buttons.map(item => item.custom_id);
    const labels = buttons.map(item => item.label);
    assert.equal(ids.includes("voicecenter:open"), true);
    assert.equal(ids.includes("voice:open"), true);
    assert.equal(labels.includes("Music"), true);
    assert.equal(labels.includes("AI"), true);
    assert.equal(labels.includes("Translator"), true);
    assert.equal(labels.includes("Settings"), true);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(payload.components.every(row => row.components.length <= 5), true);
});

test("Voice AI Center panel exposes controls only to an authorized admin and backend rechecks actions", async () => {
    const guild = { id: GUILD, ownerId: "32345678901234568", members: { me: { voice: { channelId: CHANNEL } } } };
    const config = {
        guildId: GUILD,
        autoKick: { enabled: false, gracePeriodMs: 10_000, exemptAdmins: true, exemptOwner: true, exemptRoleIds: [] },
        trustedMemberIds: [], trustedRoleIds: [], protectedVoiceChannelIds: [], voiceTimer: null, activity: []
    };
    let enabled = false;
    const service = {
        isAuthorized: (_guild, member) => member.permissions.has(PermissionFlagsBits.ManageGuild),
        getConfig: async () => ({ ...config, autoKick: { ...config.autoKick, enabled } }),
        getVoiceTimer: async () => null,
        configureAutoKick: async (_guild, _member, updates) => { enabled = updates.enabled; }
    };
    const handler = createVoiceCenterInteractionHandler({ service, logger: { warn() {} } });
    const admin = {
        id: USER, guild, permissions: { has: permission => permission === PermissionFlagsBits.ManageGuild }
    };
    const reply = async payload => { reply.payload = payload; };
    await handler({
        customId: "voicecenter:open", guild, member: admin, user: { id: USER },
        reply, isButton: () => true
    });
    const controls = reply.payload.components.flatMap(row => row.components.map(component => component.toJSON()));
    assert.equal(controls.some(item => item.custom_id === "voicecenter:auto_toggle"), true);

    let updatedPayload;
    await handler({
        customId: "voicecenter:auto_toggle", guild, member: admin, user: { id: USER },
        update: async payload => { updatedPayload = payload; },
        isButton: () => true
    });
    assert.equal(enabled, true);
    assert.match(updatedPayload.embeds[0].data.description, /Auto Kick Voice diaktifkan/);
});

test("Voice Center dashboard confirmation and modal submissions call guarded services", async () => {
    const guild = { id: GUILD, ownerId: "32345678901234568", members: { me: { voice: { channelId: CHANNEL } } } };
    const config = {
        guildId: GUILD,
        autoKick: { enabled: false, gracePeriodMs: 10_000, exemptAdmins: true, exemptOwner: true, exemptRoleIds: [] },
        trustedMemberIds: [], trustedRoleIds: [], protectedVoiceChannelIds: [], voiceTimer: null, activity: []
    };
    const calls = [];
    const service = {
        isAuthorized: () => true,
        getConfig: async () => config,
        getVoiceTimer: async () => null,
        configureAutoKick: async (_guild, _actor, updates) => calls.push(["configure", updates]),
        clearTrustedMembers: async () => calls.push(["clear"])
    };
    const handler = createVoiceCenterInteractionHandler({ service, logger: { warn() {} } });
    const admin = {
        id: USER, guild, permissions: { has: permission => permission === PermissionFlagsBits.ManageGuild }
    };
    let updatedPayload;
    await handler({
        customId: "voicecenter:trusted_clear", guild, member: admin, user: { id: USER },
        update: async payload => { updatedPayload = payload; },
        isButton: () => true
    });
    assert.equal(updatedPayload.components[0].components[0].data.custom_id, "voicecenter:clear_confirm");
    assert.equal(calls.length, 0);

    await handler({
        customId: "voicecenter:clear_confirm", guild, member: admin, user: { id: USER },
        update: async payload => { updatedPayload = payload; },
        isButton: () => true
    });
    assert.deepEqual(calls, [["clear"]]);
    assert.match(updatedPayload.embeds[0].data.description, /Trusted member dan role sudah dihapus/);

    await handler({
        customId: `voicecenter:ai_clear_confirm:${USER}`, guild, member: admin, user: { id: USER },
        update: async payload => { updatedPayload = payload; },
        isButton: () => true
    });
    assert.deepEqual(calls.at(-1), ["clear"]);
    assert.equal(updatedPayload.embeds.length, 0);

    let shownModal;
    await handler({
        customId: "voicecenter:grace_modal", guild, member: admin, user: { id: USER },
        showModal: async modal => { shownModal = modal; }
    });
    assert.equal(shownModal.data.custom_id, "voicecenter:grace_submit");

    await handler({
        customId: "voicecenter:grace_submit", guild, member: admin, user: { id: USER },
        fields: { getTextInputValue: () => "30 detik" },
        isModalSubmit: () => true,
        update: async payload => { updatedPayload = payload; }
    });
    assert.deepEqual(calls.at(-1), ["configure", { gracePeriodMs: 30_000 }]);
});
