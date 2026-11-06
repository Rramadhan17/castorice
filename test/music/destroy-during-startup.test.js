const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { AudioPlayerStatus, VoiceConnectionStatus } = require("@discordjs/voice");
const { createSession, destroySession, getSession, startTrack, stop } = require("../../src/music/manager");

function fakeChild(pid) {
    const child = new EventEmitter();
    child.pid = pid;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.exitCode = null;
    child.signalCode = null;
    child.killed = false;
    child.kill = signal => {
        child.killed = true;
        child.signalCode = signal || "SIGTERM";
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin.destroy();
        child.emit("close", null, child.signalCode);
    };
    return child;
}

test("Stop during a pending ZeroMQ readiness request settles startup and releases resources", async t => {
    const guildId = `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
    const player = new EventEmitter();
    player.state = { status: AudioPlayerStatus.Idle };
    player.played = [];
    player.play = resource => { player.played.push(resource); };
    player.stop = () => true;

    const connection = new EventEmitter();
    connection.state = { status: VoiceConnectionStatus.Connecting };
    connection.subscribe = () => {};
    connection.destroy = () => { connection.state = { status: VoiceConnectionStatus.Destroyed }; };
    const channel = { id: "voice-test", permissionsFor: () => ({ has: () => true }) };
    const guild = { id: guildId, voiceAdapterCreator: {}, members: { me: {} } };
    const member = { voice: { channel } };

    const session = await createSession(guild, member, {
        ffmpegPath: "ffmpeg-test",
        ytDlpPath: "yt-dlp-test",
        existsSync: () => true,
        joinVoiceChannel: () => connection,
        entersState: async (actual, state) => {
            assert.strictEqual(actual, connection);
            if (state === VoiceConnectionStatus.Ready) connection.state = { status: state };
        },
        createAudioPlayer: () => player
    });
    t.after(async () => {
        const active = getSession(guildId);
        if (active) await destroySession(guildId, active);
    });

    const children = [];
    let rejectReadiness;
    let readinessStarted;
    let releaseCount = 0;
    let clientCloseCount = 0;
    const requestStarted = new Promise(resolve => { readinessStarted = resolve; });
    const runtime = {
        allocateEndpoint: async () => ({ endpoint: "tcp://127.0.0.1:42001", release: () => { releaseCount += 1; } }),
        spawn: () => {
            const child = fakeChild(children.length + 1);
            children.push(child);
            return child;
        },
        buildFilterGraph: () => "anull",
        createAudioResource: () => ({ volume: { setVolume() {} } }),
        effectsClient: {
            sendCommand: () => new Promise((resolve, reject) => {
                rejectReadiness = reject;
                readinessStarted();
            }),
            close: async () => {
                clientCloseCount += 1;
                rejectReadiness(new Error("socket closed"));
            }
        }
    };

    const startup = startTrack(session, { source: "ytsearch1:test", title: "test" }, 0, false, runtime);
    await requestStarted;
    await stop(guild);
    await assert.rejects(startup, /ditutup saat startup|startup track dibatalkan/i);

    assert.equal(getSession(guildId), null);
    assert.equal(session.closed, true);
    assert.equal(player.played.length, 0);
    assert.equal(children.length, 2);
    assert.ok(children.every(child => child.killed));
    assert.equal(clientCloseCount, 1);
    assert.equal(releaseCount, 1);
});
