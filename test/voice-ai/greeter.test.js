const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { AudioPlayerStatus, StreamType, VoiceConnectionStatus } = require("@discordjs/voice");

const registerGreeter = require("../../src/voice-ai/greeter");

const guildId = `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
const guildDirectory = path.resolve(__dirname, "../../data/guilds", guildId);

test("Voice Greeter sends one mention-safe greeting for concurrent join events", async t => {
    t.after(async () => {
        await fs.rm(guildDirectory, { recursive: true, force: true });
    });

    const sent = [];
    const channel = {
        async send(payload) {
            sent.push(payload);
        }
    };
    const member = { user: { bot: false } };
    const state = {
        channelId: "voice-channel",
        channel,
        guild: { id: guildId },
        member,
        id: "12345678901234567"
    };

    await Promise.all([
        registerGreeter.handleVoiceStateUpdate({ channelId: null }, state),
        registerGreeter.handleVoiceStateUpdate({ channelId: null }, state)
    ]);

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].allowedMentions.users, [state.id]);
    assert.match(sent[0].content, new RegExp(state.id));
});

test("Voice Greeter ignores bots and non-join transitions", async () => {
    let sends = 0;
    const state = {
        channelId: "voice-channel",
        channel: { async send() { sends += 1; } },
        guild: { id: guildId },
        member: { user: { bot: true } },
        id: "12345678901234567"
    };

    await registerGreeter.handleVoiceStateUpdate({ channelId: null }, state);
    await registerGreeter.handleVoiceStateUpdate({ channelId: "old" }, state);
    assert.equal(sends, 0);
});

test("Voice Greeter sends text first and speaks the personalized greeting through the configured provider", async t => {
    t.after(async () => { await fs.rm(guildDirectory, { recursive: true, force: true }); });
    const order = [];
    const player = new EventEmitter();
    player.play = resource => {
        order.push("audio");
        player.resource = resource;
        player.emit("stateChange", { status: AudioPlayerStatus.Idle }, { status: AudioPlayerStatus.Playing });
        player.emit("stateChange", { status: AudioPlayerStatus.Playing }, { status: AudioPlayerStatus.Idle });
    };
    player.stop = () => {};
    const connection = { subscribe() {}, destroy() {} };
    const guild = {
        id: guildId,
        voiceAdapterCreator: {},
        members: { me: { voice: { channelId: null } } }
    };
    const member = { id: "55555555555555555", displayName: "Codi", user: { bot: false, username: "Codi" } };
    const state = {
        id: "55555555555555555",
        channelId: "voice-channel",
        channel: {
            id: "voice-channel",
            permissionsFor: () => ({ has: () => true }),
            async send() { order.push("text"); }
        },
        guild,
        member
    };
    let spokenText;
    await registerGreeter.handleVoiceStateUpdate({ channelId: null }, state, {
        ttsProvider: { async synthesize(text) { spokenText = text; return Buffer.from("ogg-opus"); } },
        voiceRuntime: {
            getMusicSession: () => null,
            getVoiceConnection: () => null,
            joinVoiceChannel: () => connection,
            entersState: async (actual, status) => {
                assert.strictEqual(actual, connection);
                assert.equal(status, VoiceConnectionStatus.Ready);
            },
            createAudioPlayer: () => player,
            createAudioResource: (stream, options) => ({ stream, options }),
            streamType: StreamType.OggOpus
        }
    });

    assert.deepEqual(order, ["text", "audio"]);
    assert.match(spokenText, /Haii Codi/);
    assert.doesNotMatch(spokenText, /<@/);
});
