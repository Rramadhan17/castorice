const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { EventEmitter } = require("node:events");
const { Events, MessageFlags, PermissionFlagsBits } = require("discord.js");
const { setFeatureEnabled, getFeatureState } = require("../../src/features/feature-manager");
const registerInteractionHandler = require("../../src/events/interactionCreate");

const ownerId = "234567890123456789";
const adminId = "334567890123456789";
const memberId = "434567890123456789";
const guildId = `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
const secondGuildId = `${Date.now() + 1}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;

function createGlobalSettings() {
    const state = { enabled: false };
    return {
        state,
        getSettings: async () => ({ ...state }),
        setEnabled: async enabled => {
            state.enabled = enabled;
            return { ...state };
        },
    };
}

function makeInteraction(customId, userId, { admin = false, values = null } = {}) {
    const calls = [];
    return {
        calls,
        customId,
        guildId,
        guild: { id: guildId },
        user: { id: userId },
        memberPermissions: {
            has: permission => admin && permission === PermissionFlagsBits.ManageGuild
        },
        message: { content: "Settings" },
        replied: false,
        deferred: false,
        values,
        isChatInputCommand: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => customId === "castorice:ai_provider_order",
        isButton: () => customId !== "castorice:ai_provider_order",
        async update(payload) {
            this.replied = true;
            calls.push({ type: "update", payload });
        },
        async reply(payload) {
            this.replied = true;
            calls.push({ type: "reply", payload });
        },
        async followUp(payload) {
            calls.push({ type: "followUp", payload });
        }
    };
}

function createMessage(guild, content) {
    const replies = [];
    return {
        replies,
        message: {
            author: { id: memberId, bot: false },
            guild: { id: guild },
            content,
            mentions: { users: { has: () => false } },
            reply: async payload => {
                replies.push(payload);
                return { edit: async replacement => replies.push(replacement) };
            },
            channel: { send: async payload => replies.push(payload) }
        }
    };
}

function textOf(payload) {
    return typeof payload === "string" ? payload : payload?.content || "";
}

test("owner, server admin, and member AI controls enforce global and guild scope", async t => {
    const guildDirectories = [
        path.resolve(__dirname, "../../data/guilds", guildId),
        path.resolve(__dirname, "../../data/guilds", secondGuildId)
    ];
    t.after(async () => Promise.all(guildDirectories.map(directory =>
        fs.rm(directory, { recursive: true, force: true })
    )));

    const client = new EventEmitter();
    client.user = { id: "123456789012345678" };
    const globalSettings = createGlobalSettings();
    let responses = 0;
    registerInteractionHandler(client, {
        isOwner: id => id === ownerId,
        globalAISettings: globalSettings,
        aiProvider: { generate: async () => ({ text: "Gemini response" }) },
        aiConversationService: {
            respond: async () => {
                responses += 1;
                return { text: "AI diizinkan" };
            },
            reset: () => true
        }
    });
    const onButton = client.listeners(Events.InteractionCreate)[0];
    const onMessage = client.listeners(Events.MessageCreate)[0];

    const deniedGlobal = makeInteraction("castorice:ai_global_toggle", adminId, { admin: true });
    await onButton(deniedGlobal);
    assert.equal(deniedGlobal.calls[0].payload.flags, MessageFlags.Ephemeral);
    assert.match(deniedGlobal.calls[0].payload.content, /hanya tersedia untuk pemilik/);
    assert.equal(globalSettings.state.enabled, false);

    const blockedAdminEnable = makeInteraction("castorice:ai_server_toggle", adminId, { admin: true });
    await onButton(blockedAdminEnable);
    assert.match(blockedAdminEnable.calls[0].payload.content, /AI global sedang nonaktif/);
    assert.equal((await getFeatureState(guildId, "ai_chat")).enabled, false);

    const ownerOpen = makeInteraction("castorice:ai_global_open", ownerId);
    await onButton(ownerOpen);
    assert.equal(ownerOpen.calls[0].type, "update");
    const globalPanelText = ownerOpen.calls[0].payload.embeds[0].data.description;
    assert.match(globalPanelText, /Gemini: dikonfigurasi; koneksi belum diverifikasi live/);
    assert.doesNotMatch(globalPanelText, /OpenAI|OpenRouter|failover|prioritas provider/i);
    assert.doesNotMatch(globalPanelText, /(?:api[_ -]?key|secret)\s*[:=]/i);

    const ownerEnable = makeInteraction("castorice:ai_global_toggle", ownerId);
    await onButton(ownerEnable);
    assert.equal(globalSettings.state.enabled, true);

    const retiredPriorityControl = makeInteraction("castorice:ai_provider_order", ownerId, {
        values: ["openai,openrouter"]
    });
    await onButton(retiredPriorityControl);
    const retiredFailoverControl = makeInteraction("castorice:ai_failover_toggle", ownerId);
    await onButton(retiredFailoverControl);
    assert.deepEqual(globalSettings.state, { enabled: true });

    const enableServer = makeInteraction("castorice:ai_server_toggle", adminId, { admin: true });
    await onButton(enableServer);
    assert.equal((await getFeatureState(guildId, "ai_chat")).enabled, true);
    assert.equal((await getFeatureState(secondGuildId, "ai_chat")).enabled, false);

    const memberMessage = createMessage(guildId, "Castorice: explain this");
    await onMessage(memberMessage.message);
    assert.equal(responses, 1);
    assert.match(textOf(memberMessage.replies[0]), /AI diizinkan/);

    const otherGuildMessage = createMessage(secondGuildId, "Castorice: explain this");
    await onMessage(otherGuildMessage.message);
    assert.equal(responses, 1);
    assert.match(textOf(otherGuildMessage.replies[0]), /dinonaktifkan oleh pengaturan server/);

    const ownerDisable = makeInteraction("castorice:ai_global_toggle", ownerId);
    await onButton(ownerDisable);
    const globallyBlocked = createMessage(guildId, "Castorice: explain this");
    await onMessage(globallyBlocked.message);
    assert.equal(responses, 1);
    assert.match(textOf(globallyBlocked.replies[0]), /dinonaktifkan secara global/);
});

test("members cannot use feature-selection controls even when a button is forged", async t => {
    const directory = path.resolve(__dirname, "../../data/guilds", guildId);
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const client = new EventEmitter();
    client.user = { id: "123456789012345678" };
    registerInteractionHandler(client, {
        isOwner: id => id === ownerId,
        globalAISettings: createGlobalSettings()
    });
    const interaction = makeInteraction("castorice:feature_selection", memberId);

    await client.listeners(Events.InteractionCreate)[0](interaction);

    assert.equal(interaction.calls.length, 1);
    assert.equal(interaction.calls[0].type, "reply");
    assert.equal(interaction.calls[0].payload.flags, MessageFlags.Ephemeral);
    assert.match(interaction.calls[0].payload.content, /Manage Server/);
});
