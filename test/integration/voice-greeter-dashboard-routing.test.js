const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Events } = require("discord.js");
const registerInteractionHandler = require("../../src/events/interactionCreate");
const voiceGreeter = require("../../src/voice-ai/greeter");
const { setFeatureEnabled } = require("../../src/features/feature-manager");

function makeGuildId() {
    return `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
}

function makeInteraction({ guildId, permitted, customId, modal = false, select = false, values = [] }) {
    const calls = {};
    return {
        calls,
        customId,
        guildId,
        values,
        message: { content: "Greeting text remains unchanged." },
        guild: { id: guildId },
        user: { id: "12345678901234567" },
        memberPermissions: { has: () => permitted },
        isChatInputCommand: () => false,
        isModalSubmit: () => modal,
        isButton: () => !modal && !select,
        isStringSelectMenu: () => select,
        reply: async payload => { calls.reply = payload; },
        update: async payload => { calls.updated = payload; },
        showModal: async payload => { calls.modal = payload.toJSON(); },
        deferReply: async () => { calls.deferred = true; },
        editReply: async payload => { calls.edited = payload; },
        fields: { getTextInputValue: () => "Welcome {user} to this server!" }
    };
}

test("Voice Greeter Dashboard requires Manage Server and persists submitted configuration", async t => {
    const guildId = makeGuildId();
    const guildDirectory = path.resolve(__dirname, "../../data/guilds", guildId);
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));

    const client = new EventEmitter();
    registerInteractionHandler(client);
    const onInteraction = client.listeners(Events.InteractionCreate)[0];

    const denied = makeInteraction({ guildId, permitted: false, customId: "castorice:greeter_configure" });
    await onInteraction(denied);
    assert.match(denied.calls.reply.content, /Manage Server/);
    assert.equal(denied.calls.modal, undefined);

    const open = makeInteraction({ guildId, permitted: true, customId: "castorice:greeter_configure" });
    await onInteraction(open);
    assert.equal(open.calls.modal.custom_id, "castorice:greeter_submit");
    assert.equal(open.calls.modal.components[0].components[0].value, voiceGreeter.DEFAULT_GREETING);

    const submit = makeInteraction({ guildId, permitted: true, customId: "castorice:greeter_submit", modal: true });
    await onInteraction(submit);
    assert.equal(submit.calls.deferred, true);
    assert.match(submit.calls.edited.content, /berhasil disimpan/i);
    assert.equal(await voiceGreeter.getGreeting(guildId), "Welcome {user} to this server!");
});

test("Voice Greeter Help Center navigates in the same message without admin permissions", async () => {
    const client = new EventEmitter();
    registerInteractionHandler(client);
    const onInteraction = client.listeners(Events.InteractionCreate)[0];
    const interaction = makeInteraction({
        guildId: makeGuildId(),
        permitted: false,
        customId: "castorice:voice_help_select",
        select: true,
        values: ["music"]
    });

    await onInteraction(interaction);

    assert.equal(interaction.calls.updated.content, interaction.message.content);
    assert.equal(interaction.calls.updated.embeds[0].data.title, "Help Center Castorice — Music dan Radio");
    assert.equal(interaction.calls.reply, undefined);
});

test("Voice Greeter settings modal rejects both open and submit while the feature is disabled", async t => {
    const guildId = makeGuildId();
    const guildDirectory = path.resolve(__dirname, "../../data/guilds", guildId);
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));
    await setFeatureEnabled(guildId, "voice_greeter", false);

    const client = new EventEmitter();
    registerInteractionHandler(client);
    const onInteraction = client.listeners(Events.InteractionCreate)[0];

    const open = makeInteraction({
        guildId,
        permitted: true,
        customId: "castorice:greeter_configure"
    });
    await onInteraction(open);
    assert.match(open.calls.reply.content, /dinonaktifkan/i);
    assert.equal(open.calls.modal, undefined);

    const submit = makeInteraction({
        guildId,
        permitted: true,
        customId: "castorice:greeter_submit",
        modal: true
    });
    await onInteraction(submit);
    assert.match(submit.calls.reply.content, /dinonaktifkan/i);
    assert.equal(submit.calls.deferred, undefined);
    assert.notEqual(await voiceGreeter.getGreeting(guildId), "Welcome {user} to this server!");
});
