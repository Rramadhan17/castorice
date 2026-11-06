const test = require("node:test");
const assert = require("node:assert/strict");
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
