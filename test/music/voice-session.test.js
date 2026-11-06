const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
    AudioPlayerStatus,
    VoiceConnectionStatus
} = require("@discordjs/voice");
const { createSession, destroySession, getSession } = require("../../src/music/manager");

function makePlayer() {
    const player = new EventEmitter();
    player.state = { status: AudioPlayerStatus.Idle };
    player.subscribed = false;
    player.play = () => {};
    player.stop = () => true;
    player.pause = () => true;
    player.unpause = () => true;
    return player;
}

function createFixture(guildId, { enterVoiceState, finishTrack } = {}) {
    let joinCalls = 0;
    let destroyCalls = 0;
    const player = makePlayer();
    const connection = new EventEmitter();
    connection.state = { status: VoiceConnectionStatus.Connecting };
    connection.joinConfig = { channelId: "voice-1" };
    connection.subscribe = value => {
        connection.subscribedPlayer = value;
        return {};
    };
    connection.destroy = () => {
        destroyCalls += 1;
        connection.state = { status: VoiceConnectionStatus.Destroyed };
        connection.emit("stateChange", { status: VoiceConnectionStatus.Disconnected }, connection.state);
    };

    const channel = {
        id: "voice-1",
        permissionsFor: () => ({ has: () => true })
    };
    const member = { voice: { channel } };
    const guild = {
        id: guildId,
        voiceAdapterCreator: {},
        members: { me: {} }
    };
    const runtime = {
        ffmpegPath: "ffmpeg-test",
        ytDlpPath: "yt-dlp-test",
        existsSync: () => true,
        joinVoiceChannel: options => {
            joinCalls += 1;
            assert.equal(options.guildId, guildId);
            assert.equal(options.channelId, channel.id);
            return connection;
        },
        entersState: async (actualConnection, status) => {
            assert.equal(actualConnection, connection);
            if (enterVoiceState) return enterVoiceState(status, connection);
            if (status === VoiceConnectionStatus.Ready) {
                connection.state = { status: VoiceConnectionStatus.Ready };
            }
            return undefined;
        },
        createAudioPlayer: () => player
    };
    if (finishTrack) runtime.finishTrack = finishTrack;

    return {
        guild,
        member,
        connection,
        player,
        runtime,
        get joinCalls() { return joinCalls; },
        get destroyCalls() { return destroyCalls; }
    };
}

function uniqueGuildId() {
    return `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
}

test("Music Manager creates one ready voice session and reuses it for the same channel", async t => {
    const guildId = uniqueGuildId();
    const fixture = createFixture(guildId);
    t.after(async () => {
        const session = getSession(guildId);
        if (session) await destroySession(guildId, session);
    });

    const [first, second] = await Promise.all([
        createSession(fixture.guild, fixture.member, fixture.runtime),
        createSession(fixture.guild, fixture.member, fixture.runtime)
    ]);

    assert.strictEqual(first, second);
    assert.equal(fixture.joinCalls, 1);
    assert.strictEqual(fixture.connection.subscribedPlayer, fixture.player);
    assert.equal(first.channelId, "voice-1");
    assert.equal(first.closed, false);

    fixture.member.voice.channel = { ...fixture.member.voice.channel, id: "voice-2" };
    await assert.rejects(createSession(fixture.guild, fixture.member, fixture.runtime), /voice channel lain/i);
    assert.equal(fixture.joinCalls, 1);
});

test("Music Manager destroys a connection that never reaches Ready", async () => {
    const guildId = uniqueGuildId();
    const fixture = createFixture(guildId, {
        enterVoiceState: async status => {
            if (status === VoiceConnectionStatus.Ready) throw new Error("timeout");
        }
    });

    await assert.rejects(createSession(fixture.guild, fixture.member, fixture.runtime), /gagal terhubung/i);
    assert.equal(fixture.destroyCalls, 1);
    assert.equal(getSession(guildId), null);
});

test("Music Manager preserves a voice session when reconnect enters Signalling", async t => {
    const guildId = uniqueGuildId();
    const fixture = createFixture(guildId);
    t.after(async () => {
        const session = getSession(guildId);
        if (session) await destroySession(guildId, session);
    });
    const session = await createSession(fixture.guild, fixture.member, fixture.runtime);

    fixture.connection.state = { status: VoiceConnectionStatus.Disconnected };
    fixture.connection.emit("stateChange", { status: VoiceConnectionStatus.Ready }, fixture.connection.state);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(session.reconnecting, false);
    assert.equal(session.closed, false);
    assert.strictEqual(getSession(guildId), session);
    assert.equal(fixture.destroyCalls, 0);
});

test("Music Manager removes and cleans a voice session when reconnect recovery fails", async () => {
    const guildId = uniqueGuildId();
    const fixture = createFixture(guildId, {
        enterVoiceState: async status => {
            if (status !== VoiceConnectionStatus.Ready) throw new Error("reconnect failed");
        }
    });
    const session = await createSession(fixture.guild, fixture.member, fixture.runtime);

    fixture.connection.state = { status: VoiceConnectionStatus.Disconnected };
    fixture.connection.emit("stateChange", { status: VoiceConnectionStatus.Ready }, fixture.connection.state);
    await new Promise(resolve => setImmediate(resolve));
    await session.destroyPromise;

    assert.equal(session.error, "Koneksi voice terputus.");
    assert.equal(session.closed, true);
    assert.equal(getSession(guildId), null);
    assert.equal(fixture.destroyCalls, 1);
});

test("Music Manager player Idle listener finishes only a current non-transitioning track", async t => {
    const guildId = uniqueGuildId();
    let finishCalls = 0;
    const fixture = createFixture(guildId, {
        finishTrack: async () => { finishCalls += 1; }
    });
    t.after(async () => {
        const session = getSession(guildId);
        if (session) await destroySession(guildId, session);
    });
    const session = await createSession(fixture.guild, fixture.member, fixture.runtime);
    const oldState = { status: AudioPlayerStatus.Playing };
    const idleState = { status: AudioPlayerStatus.Idle };

    session.currentTrack = { id: "track" };
    session.startingTrackToken = session.trackToken;
    fixture.player.emit("stateChange", oldState, idleState);
    session.startingTrackToken = null;
    session.manualTransition = true;
    fixture.player.emit("stateChange", oldState, idleState);
    session.manualTransition = false;
    fixture.player.emit("stateChange", oldState, idleState);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(finishCalls, 1);
});
