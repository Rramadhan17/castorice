const test = require("node:test");
const assert = require("node:assert/strict");
const { Collection } = require("discord.js");
const { createVoiceInteractions } = require("../../src/voice-ai/interactions");

const G = "12345678901234567";
const U = "22345678901234567";

function baseInteraction(customId) {
    const interaction = {
        customId,
        guildId: G,
        guild: {
            id: G,
            members: { fetch: async id => ({ id, guild: { id: G }, voice: { channel: { id: "32345678901234567" } } }) }
        },
        user: { id: U },
        replied: false,
        deferred: false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        reply: async payload => { interaction.replyPayload = payload; interaction.replied = true; },
        update: async payload => { interaction.updatePayload = payload; },
        showModal: async modal => { interaction.modal = modal; }
    };
    return interaction;
}

function interactionFor(customId) {
    return baseInteraction(customId);
}

test("Voice Manager create route calls the service and shows real resulting state", async () => {
    let created = 0;
    const stateStore = {
        getGuildState: async () => ({
            temporaryVoices: created
                ? { channel: { channelId: "32345678901234567", ownerId: U, status: "active", isLocked: false, userLimit: 0 } }
                : {}
        })
    };
    const service = {
        createTemporaryVoice: async (_guild, guildId, member) => {
            assert.equal(guildId, G);
            assert.equal(member.id, U);
            created += 1;
        }
    };
    const handler = createVoiceInteractions({
        service,
        stateStore,
        featureGuard: async () => ({ allowed: true })
    });
    const interaction = interactionFor("voice:create");

    assert.equal(await handler(interaction), true);
    assert.equal(created, 1);
    assert.match(interaction.updatePayload.content, /berhasil dibuat/i);
    assert.match(interaction.updatePayload.embeds[0].data.description, /<#[0-9]+>/);
});

test("Voice Manager dashboard includes general voice-channel creation", async () => {
    const { buildVoicePanel } = require("../../src/voice-ai/interactions");
    const panel = buildVoicePanel();
    const ids = panel.components.flatMap(row => row.components.map(component => component.toJSON().custom_id));
    assert.ok(ids.includes("voice:create_channel"));
});

test("Voice Manager create-channel flow previews and confirms a guild-scoped request", async () => {
    let created;
    const handler = createVoiceInteractions({
        service: {
            createVoiceChannel: async (_guild, guildId, member, options) => {
                created = { guildId, userId: member.id, options };
                return { id: "32345678901234567" };
            }
        },
        stateStore: {},
        featureGuard: async () => ({ allowed: true })
    });

    const submit = baseInteraction("voice:create_channel_submit");
    submit.customId = `voice:create_channel_submit:${U}:none`;
    submit.isModalSubmit = () => true;
    submit.id = "72345678901234567";
    submit.fields = {
        getTextInputValue: key => ({
            name: "Study Room",
            privacy: "private",
            limit: "4"
        })[key]
    };
    assert.equal(await handler(submit), true);
    assert.match(submit.replyPayload.content, /Study Room/);
    const confirmId = submit.replyPayload.components[0].components[0].toJSON().custom_id;

    const confirm = baseInteraction(confirmId);
    assert.equal(await handler(confirm), true);
    assert.equal(created.guildId, G);
    assert.equal(created.userId, U);
    assert.equal(created.options.name, "Study Room");
    assert.equal(created.options.privacy, "private");
    assert.equal(created.options.userLimit, 4);
    assert.equal(created.options.requestKey, submit.id);
    assert.match(confirm.updatePayload.content, /berhasil dibuat/);
});

test("Voice Manager create-channel modal opens from the dashboard", async () => {
    const handler = createVoiceInteractions({
        service: {},
        stateStore: {},
        featureGuard: async () => ({ allowed: true })
    });
    const interaction = interactionFor("voice:create_channel");
    assert.equal(await handler(interaction), true);
    assert.equal(interaction.modal.toJSON().custom_id, `voice:create_channel_submit:${U}:none`);
    assert.equal(interaction.modal.toJSON().components.length, 3);
});

test("Voice Manager create-channel flow offers only guild categories", async () => {
    const category = { id: "32345678901234567", name: "Hangout", type: 4, guildId: G };
    const handler = createVoiceInteractions({
        service: {},
        stateStore: {},
        featureGuard: async () => ({ allowed: true })
    });
    const interaction = interactionFor("voice:create_channel");
    interaction.guild.channels = { cache: new Collection([[category.id, category]]) };

    assert.equal(await handler(interaction), true);
    const menu = interaction.updatePayload.components[0].components[0].toJSON();
    assert.equal(menu.custom_id, `voice:create_channel_category:${U}`);
    assert.ok(menu.options.some(option => option.value === category.id));
    assert.ok(menu.options.some(option => option.value === "none"));
});

test("Voice Manager category selection is validated against the interaction guild", async () => {
    const category = { id: "32345678901234567", name: "Hangout", type: 4, guildId: G };
    const handler = createVoiceInteractions({
        service: {},
        stateStore: {},
        featureGuard: async () => ({ allowed: true })
    });
    const interaction = interactionFor(`voice:create_channel_category:${U}`);
    interaction.isStringSelectMenu = () => true;
    interaction.values = [category.id];
    interaction.guild.channels = { fetch: async id => id === category.id ? category : null };

    assert.equal(await handler(interaction), true);
    assert.equal(interaction.modal.toJSON().custom_id, `voice:create_channel_submit:${U}:${category.id}`);
});

test("Voice Manager denies disabled feature before executing an action", async () => {
    let calls = 0;
    const handler = createVoiceInteractions({
        service: { createTemporaryVoice: async () => { calls += 1; } },
        stateStore: { getGuildState: async () => ({ temporaryVoices: {} }) },
        featureGuard: async () => ({ allowed: false, reason: "Voice Manager disabled" })
    });
    const interaction = interactionFor("voice:create");

    await handler(interaction);
    assert.equal(calls, 0);
    assert.match(interaction.replyPayload.content, /disabled/i);
});

test("Voice Manager rename control opens a bounded modal", async () => {
    const handler = createVoiceInteractions({
        service: {},
        stateStore: {},
        featureGuard: async () => ({ allowed: true })
    });
    const interaction = interactionFor("voice:rename");

    await handler(interaction);
    assert.equal(interaction.modal.toJSON().custom_id, "voice:rename_submit");
    assert.equal(interaction.modal.toJSON().components[0].components[0].max_length, 100);
});

test("Voice Manager reports create failure without a success panel", async () => {
    const handler = createVoiceInteractions({
        service: { createTemporaryVoice: async () => { throw new Error("Move Members permission is missing."); } },
        stateStore: { getGuildState: async () => ({ temporaryVoices: {} }) },
        featureGuard: async () => ({ allowed: true }),
        logger: { error() {} }
    });
    const interaction = interactionFor("voice:create");

    await handler(interaction);
    assert.match(interaction.replyPayload.content, /Move Members permission/i);
    assert.equal(interaction.updatePayload, undefined);
});

test("Voice Manager tag deletion confirmation is bound to its requesting owner", async () => {
    let deletes = 0;
    const handler = createVoiceInteractions({
        service: { deleteOwned: async () => { deletes += 1; } },
        stateStore: { getGuildState: async () => ({ temporaryVoices: {} }) },
        featureGuard: async () => ({ allowed: true })
    });
    const interaction = interactionFor("voice:delete_confirm:32345678901234567");

    await handler(interaction);
    assert.equal(deletes, 0);
    assert.match(interaction.replyPayload.content, /Hanya pemilik voice/);
});
