const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { Events } = require("discord.js");
const { MessageFlags } = require("discord.js");

const registerInteractionHandler = require("../../src/events/interactionCreate");

const guildId = `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
const guildDirectory = path.resolve(__dirname, "../../data/guilds", guildId);

function registerHandlers(translatorFactory, lyricsSearch) {
    const handlers = new Map();
    const client = {
        user: { id: "123456789012345678" },
        on: (event, handler) => handlers.set(event, handler)
    };

    registerInteractionHandler(client, { translatorFactory, lyricsSearch });
    return handlers;
}

test("AI Tag translation routes to the translator and suppresses mentions", async t => {
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));
    let translatedInput;
    const handlers = registerHandlers(() => ({
        translate: async input => {
            translatedInput = input;
            return {
                translatedText: "halo @everyone",
                source: "auto",
                detectedLanguage: "en",
                target: input.target
            };
        }
    }));

    const sent = [];
    const message = {
        author: { bot: false, id: "234567890123456789" },
        guild: { id: guildId },
        content: "<@123456789012345678> terjemahkan hello ke id",
        mentions: { users: { has: () => true } },
        reply: async payload => sent.push(payload),
        channel: { send: async payload => sent.push(payload) }
    };

    await handlers.get(Events.MessageCreate)(message);

    assert.deepEqual(translatedInput, {
        text: "hello",
        source: "auto",
        target: "id"
    });
    assert.match(sent[0].content, /halo @\u200beveryone/);
    assert.deepEqual(sent[0].allowedMentions, { parse: [] });
});

test("Translator modal returns provider output ephemerally", async t => {
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));
    let input;
    const handlers = registerHandlers(() => ({
        translate: async values => {
            input = values;
            return {
                translatedText: "halo",
                source: "en",
                detectedLanguage: null,
                target: "id"
            };
        }
    }));

    const replies = [];
    const interaction = {
        customId: "castorice:translator_submit",
        guildId,
        deferred: false,
        replied: false,
        isChatInputCommand: () => false,
        isModalSubmit: () => true,
        fields: {
            getTextInputValue: id => ({
                translator_text: "hello",
                translator_source: "en",
                translator_target: "id"
            })[id]
        },
        deferReply: async options => {
            interaction.deferred = true;
            replies.push({ type: "defer", options });
        },
        editReply: async payload => replies.push({ type: "edit", payload }),
        followUp: async payload => replies.push({ type: "followUp", payload })
    };

    await handlers.get(Events.InteractionCreate)(interaction);

    assert.deepEqual(input, { text: "hello", source: "en", target: "id" });
    assert.equal(replies[0].options.flags, MessageFlags.Ephemeral);
    assert.match(replies[1].payload.content, /halo/);
});

test("Translator Dashboard loads language options and opens a modal with the selected target", async t => {
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));
    const languages = [
        { code: "en", name: "English", targets: ["id"] },
        { code: "id", name: "Indonesian", targets: ["en"] }
    ];
    const handlers = registerHandlers(() => ({
        getLanguages: async () => languages
    }));
    const onInteraction = handlers.get(Events.InteractionCreate);
    let panel;
    const openPicker = {
        guildId,
        customId: "castorice:translator_languages",
        isChatInputCommand: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        isButton: () => true,
        deferReply: async options => { openPicker.deferred = options; },
        editReply: async payload => { panel = payload; },
        reply: async payload => { openPicker.reply = payload; }
    };
    await onInteraction(openPicker);

    assert.equal(openPicker.deferred.flags, MessageFlags.Ephemeral);
    assert.equal(panel.components[0].components[0].toJSON().options[1].value, "id");

    let modal;
    const selectLanguage = {
        guildId,
        customId: "castorice:translator_language_select",
        values: ["id"],
        isChatInputCommand: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => true,
        isButton: () => false,
        showModal: async payload => { modal = payload.toJSON(); },
        reply: async payload => { selectLanguage.reply = payload; }
    };
    await onInteraction(selectLanguage);

    assert.equal(modal.custom_id, "castorice:translator_submit");
    assert.equal(modal.components[2].components[0].value, "id");
});

test("AI Tag translates current lyrics only for a member in the bot's voice channel", async t => {
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));
    const music = require("../../src/music/manager");
    const originalGetSession = music.getSession;
    const channelId = "345678901234567890";
    const session = {
        guildId,
        channelId,
        currentTrack: { title: "Example", artist: "Artist" },
        connection: {
            state: { status: "ready" },
            joinConfig: { channelId }
        }
    };
    music.getSession = () => session;
    t.after(() => { music.getSession = originalGetSession; });

    let translatedInput;
    const handlers = registerHandlers(
        () => ({
            maxLength: 100,
            translate: async input => {
                translatedInput = input;
                return { translatedText: "Halo", source: "en", target: input.target };
            }
        }),
        async () => ({ found: true, synced: true, lyrics: [{ time: 0, text: "Hello" }] })
    );
    const sent = [];
    const guild = {
        id: guildId,
        members: {
            fetch: async () => ({ guild: { id: guildId }, voice: { channelId } }),
            fetchMe: async () => ({ voice: { channelId } })
        }
    };
    const message = {
        author: { bot: false, id: "234567890123456789" },
        guild,
        content: "<@123456789012345678> terjemahkan lirik ke id",
        mentions: { users: { has: () => true } },
        reply: async payload => sent.push(payload),
        channel: { send: async payload => sent.push(payload) }
    };

    await handlers.get(Events.MessageCreate)(message);

    assert.equal(translatedInput.text, "Hello");
    assert.equal(translatedInput.target, "id");
    assert.match(sent[0].content, /Terjemahan Lirik \(id\)/);
});
