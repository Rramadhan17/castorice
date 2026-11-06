const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { Events } = require("discord.js");
const musicPanelUpdater = require("../../src/music/panel-updater");
const registerInteractionHandler = require("../../src/events/interactionCreate");

const guildId = `${Date.now()}${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
const guildDirectory = path.resolve(__dirname, "../../data/guilds", guildId);

test("natural Radio Discovery search results route into the Music Engine", async t => {
    const handlers = new Map();
    const selectedStations = [];
    const station = {
        title: "Test Radio",
        country: "Testland",
        codec: "MP3",
        bitrate: 128,
        streamUrl: "https://stream.example/live"
    };
    const client = {
        user: { id: "123456789012345678" },
        on: (event, handler) => handlers.set(event, handler)
    };
    registerInteractionHandler(client, {
        radioDiscovery: {
            async search(query) {
                assert.equal(query, "BBC World Service");
                return [station];
            }
        },
        musicManager: {
            async addRadioStation(guild, member, selected) {
                selectedStations.push({ guildId: guild.id, memberId: member.id, selected });
                return {
                    started: true,
                    track: { title: selected.title }
                };
            }
        }
    });

    let response;
    const message = {
        author: { bot: false, id: "234567890123456789" },
        guild: { id: guildId },
        content: "Castorice: cari radio BBC World Service",
        mentions: { users: { has: () => false } },
        reply: async payload => {
            response = {
                id: "radio-results-message",
                initial: payload,
                edited: null,
                async edit(next) { this.edited = next; }
            };
            return response;
        }
    };

    await handlers.get(Events.MessageCreate)(message);
    assert.equal(response.edited.embeds[0].data.title, "Castorice | Radio Discovery");

    const playerMessageId = "radio-player-message";
    t.after(async () => {
        musicPanelUpdater.stop(playerMessageId);
        await fs.rm(guildDirectory, { recursive: true, force: true });
    });

    const interaction = {
        customId: "castorice:music_radio_select",
        guildId,
        guild: {
            id: guildId,
            members: {
                fetch: async id => ({ id, voice: { channel: { id: "voice-channel" } } })
            }
        },
        user: { id: "234567890123456789" },
        values: ["0"],
        message: { id: response.id, delete: async () => {} },
        channelId: "text-channel",
        client,
        channel: {
            send: async () => ({ id: playerMessageId })
        },
        isChatInputCommand: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => true,
        isButton: () => false,
        deferUpdate: async () => {},
        followUp: async payload => { throw new Error(payload.content); }
    };

    await handlers.get(Events.InteractionCreate)(interaction);
    assert.equal(selectedStations.length, 1);
    assert.equal(selectedStations[0].guildId, guildId);
    assert.equal(selectedStations[0].memberId, interaction.user.id);
    assert.equal(selectedStations[0].selected, station);
});
