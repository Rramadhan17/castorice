const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { AudioPlayerStatus, StreamType, VoiceConnectionStatus } = require("@discordjs/voice");
const { PermissionFlagsBits } = require("discord.js");

const registerGreeter = require("../../src/voice-ai/greeter");

const guildId = `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
const guildDirectory = path.resolve(__dirname, "../../data/guilds", guildId);

test("Voice Greeter sends one mention-safe greeting for concurrent join events", async t => {
    t.after(async () => {
        await fs.rm(guildDirectory, { recursive: true, force: true });
    });

    const sent = [];
    const channel = {
        id: "greeter-text-channel",
        isTextBased: () => true,
        permissionsFor: () => ({ has: () => true }),
        async send(payload) {
            sent.push(payload);
        }
    };
    const member = { user: { bot: false } };
    const state = {
        channelId: "voice-channel",
        channel,
        guild: { id: guildId, members: { me: {} } },
        member,
        id: "12345678901234567"
    };

    await Promise.all([
        registerGreeter.handleVoiceStateUpdate({ channelId: null }, state),
        registerGreeter.handleVoiceStateUpdate({ channelId: null }, state)
    ]);

    assert.equal(sent.length, 1);
    assert.equal(
        sent[0].content,
        "Haii <@12345678901234567>, selamat datang di voice! Kenalin, aku AI Server Ras Ultra. Aku diciptakan oleh kyru untuk membantu kalian. Kalau butuh bantuan, aku bisa bantu putar musik, cari lagu, atur volume, bikin private voice, atau nemenin kamu ngobrol. Mau dibantu apa nih?"
    );
    assert.deepEqual(sent[0].allowedMentions.users, [state.id]);
    assert.equal(sent[0].embeds[0].data.title, "Help Center Castorice — Ringkasan");
    assert.equal(sent[0].components[0].components[0].data.custom_id, "castorice:voice_help_select");
    assert.match(sent[0].content, new RegExp(state.id));
});

test("Voice Greeter still sends the greeting when Help Center panel construction fails", async t => {
    t.after(async () => {
        await fs.rm(guildDirectory, { recursive: true, force: true });
    });

    const sent = [];
    const state = {
        channelId: "voice-channel",
        channel: {
            id: "greeter-help-fallback-channel",
            isTextBased: () => true,
            permissionsFor: () => ({ has: () => true }),
            async send(payload) { sent.push(payload); }
        },
        guild: { id: guildId, members: { me: {} } },
        member: { user: { bot: false } },
        id: "12345678901234568"
    };
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        await registerGreeter.handleVoiceStateUpdate({ channelId: null }, state, {
            buildHelpCenter() {
                throw new Error("component construction failed");
            }
        });
    } finally {
        console.error = originalConsoleError;
    }

    assert.equal(sent.length, 1);
    assert.match(sent[0].content, /selamat datang di voice/i);
    assert.equal(sent[0].components, undefined);
});

test("Voice Greeter skips unsupported channels and missing View/Send permissions without repeated warnings", async () => {
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    try {
        const member = { user: { bot: false } };
        const makeState = (id, channel) => ({
            channelId: id,
            channel,
            guild: { id: guildId, members: { me: {} } },
            member,
            id: "12345678901234569"
        });
        const unsupported = {
            id: "greeter-unsupported-channel",
            isTextBased: () => false,
            async send() { assert.fail("unsupported channel must not be sent to"); }
        };
        const noView = {
            id: "greeter-no-view-channel",
            isTextBased: () => true,
            permissionsFor: () => ({ has: permission => permission !== PermissionFlagsBits.ViewChannel }),
            async send() { assert.fail("channel without View Channel must not be sent to"); }
        };
        const noSend = {
            id: "greeter-no-send-channel",
            isTextBased: () => true,
            permissionsFor: () => ({ has: permission => permission !== PermissionFlagsBits.SendMessages }),
            async send() { assert.fail("channel without Send Messages must not be sent to"); }
        };

        await registerGreeter.handleVoiceStateUpdate({ channelId: null }, makeState("unsupported", unsupported));
        await registerGreeter.handleVoiceStateUpdate({ channelId: null }, makeState("no-view", noView));
        await registerGreeter.handleVoiceStateUpdate({ channelId: null }, makeState("no-view", noView));
        await registerGreeter.handleVoiceStateUpdate({ channelId: null }, makeState("no-send", noSend));

        assert.deepEqual(warnings.map(([, detail]) => detail.missingPermission), [
            "text_channel",
            "ViewChannel",
            "SendMessages"
        ]);
    } finally {
        console.warn = originalWarn;
    }
});

test("Voice Greeter sends a text-only Help Center when Embed Links is missing", async t => {
    t.after(async () => { await fs.rm(guildDirectory, { recursive: true, force: true }); });
    const sent = [];
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
        const channel = {
            id: "greeter-no-embed-links-channel",
            isTextBased: () => true,
            permissionsFor: () => ({
                has: permission => permission !== PermissionFlagsBits.EmbedLinks
            }),
            async send(payload) { sent.push(payload); }
        };
        const state = {
            channelId: "voice-channel",
            channel,
            guild: { id: guildId, members: { me: {} } },
            member: { user: { bot: false } },
            id: "12345678901234570"
        };

        await registerGreeter.handleVoiceStateUpdate({ channelId: null }, state);
    } finally {
        console.warn = originalWarn;
    }

    assert.equal(sent.length, 1);
    assert.equal(sent[0].embeds, undefined);
    assert.ok(sent[0].components.length > 0);
    assert.deepEqual(warnings.map(([, detail]) => detail.missingPermission), ["EmbedLinks"]);
});

test("Voice Greeter sanitizes Discord 50013 and continues after send permission races", async t => {
    t.after(async () => { await fs.rm(guildDirectory, { recursive: true, force: true }); });
    const warnings = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args) => warnings.push(args);
    console.error = (...args) => warnings.push(args);
    try {
        const channel = {
            id: "greeter-permission-race-channel",
            isTextBased: () => true,
            permissionsFor: () => ({ has: () => true }),
            async send() {
                throw Object.assign(new Error("raw Discord permission payload"), { code: 50013 });
            }
        };
        const state = {
            channelId: "voice-channel",
            channel,
            guild: { id: guildId, members: { me: {} } },
            member: { user: { bot: false } },
            id: "12345678901234571"
        };

        await registerGreeter.handleVoiceStateUpdate({ channelId: null }, state);
        assert.equal(JSON.stringify(warnings).includes("raw Discord permission payload"), false);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0][0], /Voice Greeter/);
    } finally {
        console.warn = originalWarn;
        console.error = originalError;
    }
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
