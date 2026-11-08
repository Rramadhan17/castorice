const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Events, MessageFlags } = require("discord.js");
const registerInteractionHandler = require("../../src/events/interactionCreate");
const { SETTINGS_ACTION_IDS } = require("../../src/dashboard/menu-panel");

const CLIENT_ID = "123456789012345678";

function registerHandlers() {
    const client = new EventEmitter();
    client.user = { id: CLIENT_ID };
    registerInteractionHandler(client, {
        aiConversationService: {
            respond: async () => ({ text: "AI fallback must not claim this action." }),
            reset: () => true
        },
        aiProviderManager: null,
        isOwner: () => false
    });
    return client;
}

function makeInteraction(customId, { failUpdate = false } = {}) {
    const calls = [];
    return {
        calls,
        customId,
        guildId: "settings-test-guild",
        guild: { id: "settings-test-guild" },
        user: { id: "settings-test-user" },
        memberPermissions: { has: () => false },
        message: { content: "Settings panel" },
        replied: false,
        deferred: false,
        isChatInputCommand: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        isButton: () => true,
        async update(payload) {
            if (failUpdate) throw new Error("panel update failed");
            this.replied = true;
            calls.push({ type: "update", payload });
        },
        async reply(payload) {
            this.replied = true;
            calls.push({ type: "reply", payload });
        },
        async followUp(payload) {
            calls.push({ type: "followUp", payload });
        },
        async showModal(payload) {
            calls.push({ type: "modal", payload });
        }
    };
}

test("all four Settings Center buttons are registered and acknowledge without admin permissions", async () => {
    const client = registerHandlers();
    assert.equal(client.listenerCount(Events.InteractionCreate), 1);
    assert.equal(client.listenerCount(Events.MessageCreate), 1);
    const handler = client.listeners(Events.InteractionCreate)[0];

    for (const [action, customId] of Object.entries(SETTINGS_ACTION_IDS)) {
        const interaction = makeInteraction(customId);
        await handler(interaction);
        assert.equal(interaction.replied, true, `${action} was not acknowledged`);
        assert.equal(interaction.calls.length, 1, `${action} was acknowledged more than once`);
        assert.notEqual(interaction.calls[0].type, "modal", `${action} opened an unsupported input form`);

        if (action === "tutor") {
            assert.equal(interaction.calls[0].type, "update");
            assert.match(interaction.calls[0].payload.embeds[0].data.title, /Help Center/);
        } else {
            assert.equal(interaction.calls[0].type, "reply");
            assert.equal(interaction.calls[0].payload.flags, MessageFlags.Ephemeral);
            assert.match(interaction.calls[0].payload.content, /belum tersedia/i);
            assert.doesNotMatch(interaction.calls[0].payload.content, /(?:berhasil|telah)\s+(?:dikirim|disimpan|dilaporkan)/i);
        }
    }
});

test("returning from the Help Center reopens Settings in the same Dashboard message", async () => {
    const client = registerHandlers();
    const handler = client.listeners(Events.InteractionCreate)[0];
    const interaction = makeInteraction("castorice:settings");

    await handler(interaction);

    assert.equal(interaction.calls[0].type, "update");
    const buttonIds = interaction.calls[0].payload.components.flatMap(row =>
        row.components.map(component => component.toJSON().custom_id)
    );
    for (const customId of Object.values(SETTINGS_ACTION_IDS)) {
        assert.ok(buttonIds.includes(customId));
    }
});

test("Tutor button update errors fall back to an acknowledged ephemeral response", async () => {
    const client = registerHandlers();
    const handler = client.listeners(Events.InteractionCreate)[0];
    const interaction = makeInteraction(SETTINGS_ACTION_IDS.tutor, { failUpdate: true });

    await handler(interaction);

    assert.equal(interaction.replied, true);
    assert.equal(interaction.calls.length, 1);
    assert.equal(interaction.calls[0].type, "reply");
    assert.equal(interaction.calls[0].payload.flags, MessageFlags.Ephemeral);
    assert.match(interaction.calls[0].payload.content, /panel update failed/);
});

function makeMessage(content) {
    const replies = [];
    return {
        replies,
        message: {
            author: { id: "settings-test-user", bot: false },
            guild: { id: "settings-test-guild" },
            content,
            mentions: { users: { has: id => id === CLIENT_ID && content.includes(`<@${id}>`) } },
            reply: async payload => {
                replies.push(payload);
                return { edit: async replacement => replies.push(replacement) };
            },
            channel: { send: async payload => replies.push(payload) }
        }
    };
}

test("Castorice mention/name requests for unavailable feedback actions explain the limitation", async () => {
    const client = registerHandlers();
    const handler = client.listeners(Events.MessageCreate)[0];
    const cases = [
        ["Castorice: rate bot", /Rate Bot belum tersedia/i],
        ["Castorice: rate bot 99/10", /Rate Bot belum tersedia/i],
        ["Castorice, kirim saran fitur", /Suggestion belum tersedia/i],
        ["Castorice: kirim saran", /Suggestion belum tersedia/i],
        ["Hey Castorice laporkan bug", /Report Bug belum tersedia/i],
        ["Castorice: report bug", /Report Bug belum tersedia/i],
        [`<@${CLIENT_ID}> report bug`, /Report Bug belum tersedia/i]
    ];

    for (const [content, expected] of cases) {
        const { message, replies } = makeMessage(content);
        await handler(message);
        assert.equal(replies.length, 1);
        assert.match(replies[0].content, expected);
        assert.deepEqual(replies[0].allowedMentions, { parse: [] });
        assert.doesNotMatch(replies[0].content, /99\/10/);
    }
});

test("Tutor natural-language request opens the existing Help Center, not an action claim", async () => {
    const client = registerHandlers();
    const handler = client.listeners(Events.MessageCreate)[0];
    const { message, replies } = makeMessage("Castorice: tunjukkan tutorial fitur");

    await handler(message);

    assert.equal(replies.length, 1);
    assert.match(replies[0].embeds[0].data.title, /Help Center/);
    assert.equal(replies[0].components.at(-1).components[1].data.custom_id, "castorice:settings");
});
