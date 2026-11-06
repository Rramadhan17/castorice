const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { Events } = require("discord.js");
const registerInteractionHandler = require("../../src/events/interactionCreate");
const music = require("../../src/music/manager");
const musicPanelUpdater = require("../../src/music/panel-updater");

const guildId = `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
const guildDirectory = path.resolve(__dirname, "../../data/guilds", guildId);

test("lyrics panel button translates lyrics and refresh state keeps the result", async t => {
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));
    const originalGetSession = music.getSession;
    const channelId = "345678901234567890";
    const session = {
        guildId,
        channelId,
        currentTrack: { title: "Example", artist: "Artist" },
        connection: {
            state: { status: "ready" },
            joinConfig: { channelId }
        },
        player: { state: { status: "idle" } },
        history: [],
        queue: []
    };
    music.getSession = () => session;
    t.after(() => { music.getSession = originalGetSession; });

    const callbacks = new Map();
    const client = {
        channels: { fetch: async () => null },
        on: (event, callback) => callbacks.set(event, callback)
    };
    const translatorInput = [];
    registerInteractionHandler(client, {
        lyricsSearch: async () => ({
            found: true,
            synced: false,
            plainLyrics: "Hello world"
        }),
        translatorFactory: () => ({
            maxLength: 100,
            translate: async input => {
                translatorInput.push(input);
                return {
                    translatedText: "Halo dunia",
                    source: "en",
                    target: input.target
                };
            }
        })
    });

    const edits = [];
    const userId = "234567890123456789";
    const guild = {
        id: guildId,
        members: {
            fetch: async () => ({ guild: { id: guildId }, voice: { channelId } }),
            fetchMe: async () => ({ voice: { channelId } })
        }
    };
    const interaction = {
        customId: "castorice:lyrics_translate",
        guildId,
        guild,
        user: { id: userId },
        message: { id: "456789012345678901", edit: async payload => edits.push(payload) },
        client,
        channelId: "567890123456789012",
        isChatInputCommand: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => false,
        isButton: () => true,
        reply: async () => {},
        deferUpdate: async () => {},
        followUp: async () => {}
    };

    await callbacks.get(Events.InteractionCreate)(interaction);
    musicPanelUpdater.stop(interaction.message.id);

    assert.deepEqual(translatorInput, [{ text: "Hello world", source: "auto", target: "id" }]);
    assert.equal(edits[0].embeds.length, 2);
    assert.match(edits[0].embeds[1].data.description, /Halo dunia/);
});
