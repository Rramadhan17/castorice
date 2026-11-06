const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const { AudioPlayerStatus, StreamType, VoiceConnectionStatus } = require("@discordjs/voice");
const { loadTtsProvider, playTtsGreeting } = require("../../src/voice-ai/greeter-tts");

function makeContext() {
    const botMember = { voice: { channelId: null } };
    const guild = { id: "12345678901234567", voiceAdapterCreator: {}, members: { me: botMember } };
    const channel = { id: "voice-1", permissionsFor: () => ({ has: permissions => permissions.includes("Connect") && permissions.includes("Speak") }) };
    const member = { id: "23456789012345678" };
    return { guild, channel, member };
}

function makeRuntime() {
    const player = new EventEmitter();
    let destroyed = 0;
    let stopped = 0;
    let subscribed = 0;
    const connection = {
        subscribe() { subscribed += 1; },
        destroy() { destroyed += 1; }
    };
    player.play = resource => {
        player.resource = resource;
        player.emit("stateChange", { status: AudioPlayerStatus.Idle }, { status: AudioPlayerStatus.Playing });
        player.emit("stateChange", { status: AudioPlayerStatus.Playing }, { status: AudioPlayerStatus.Idle });
    };
    player.stop = () => { stopped += 1; };
    return {
        player,
        connection,
        get destroyed() { return destroyed; },
        get stopped() { return stopped; },
        get subscribed() { return subscribed; },
        runtime: {
            getMusicSession: () => null,
            getVoiceConnection: () => null,
            joinVoiceChannel: options => {
                assert.equal(options.guildId, "12345678901234567");
                assert.equal(options.channelId, "voice-1");
                return connection;
            },
            entersState: async (actual, status) => {
                assert.strictEqual(actual, connection);
                assert.equal(status, VoiceConnectionStatus.Ready);
            },
            createAudioPlayer: () => player,
            createAudioResource: (stream, options) => ({ stream, options }),
            streamType: StreamType.OggOpus
        }
    };
}

test("TTS provider loading is optional and validates the module contract", () => {
    assert.equal(loadTtsProvider(""), null);
    assert.throws(() => loadTtsProvider("./package.json"), /must export synthesize/i);
});

test("TTS playback connects with permissions, plays Ogg/Opus, and destroys its voice connection", async () => {
    const context = makeContext();
    const harness = makeRuntime();
    let synthesized;
    const result = await playTtsGreeting({
        ...context,
        text: "Welcome, Codi",
        provider: { async synthesize(text, ids) { synthesized = { text, ids }; return Buffer.from("ogg-opus-data"); } },
        runtime: harness.runtime
    });

    assert.deepEqual(result, { spoken: true });
    assert.equal(synthesized.text, "Welcome, Codi");
    assert.equal(synthesized.ids.guildId, context.guild.id);
    assert.equal(synthesized.ids.memberId, context.member.id);
    assert.ok(synthesized.ids.signal instanceof AbortSignal);
    assert.ok(harness.player.resource.stream instanceof Readable);
    assert.equal(harness.player.resource.options.inputType, StreamType.OggOpus);
    assert.equal(harness.subscribed, 1);
    assert.equal(harness.stopped, 1);
    assert.equal(harness.destroyed, 1);
});

test("TTS does not connect over an active Music session or without Connect/Speak", async () => {
    const context = makeContext();
    let syntheses = 0;
    let joins = 0;
    const provider = { async synthesize() { syntheses += 1; return Buffer.from("audio"); } };
    const runtime = { getMusicSession: () => ({}), joinVoiceChannel: () => { joins += 1; } };
    assert.deepEqual(await playTtsGreeting({ ...context, text: "hello", provider, runtime }), { spoken: false, reason: "voice_busy" });
    assert.equal(syntheses, 0);
    assert.equal(joins, 0);

    const noPermission = { ...context, channel: { ...context.channel, permissionsFor: () => ({ has: () => false }) } };
    assert.deepEqual(await playTtsGreeting({ ...noPermission, text: "hello", provider, runtime: { getMusicSession: () => null } }), { spoken: false, reason: "missing_permissions" });
    assert.equal(syntheses, 0);
});

test("TTS synthesis timeout aborts the provider request and releases the guild reservation", async () => {
    const context = makeContext();
    const never = { synthesize: (_text, { signal }) => new Promise(() => signal.addEventListener("abort", () => {}, { once: true })) };
    await assert.rejects(
        playTtsGreeting({ ...context, text: "hello", provider: never, runtime: { synthesisTimeoutMs: 5, getMusicSession: () => null } }),
        /synthesis timed out/i
    );

    const harness = makeRuntime();
    const next = await playTtsGreeting({
        ...context,
        text: "hello again",
        provider: { synthesize: async () => Buffer.from("ogg") },
        runtime: harness.runtime
    });
    assert.deepEqual(next, { spoken: true });
});
