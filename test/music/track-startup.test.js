const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { AudioPlayerStatus } = require("@discordjs/voice");

const { startTrack, destroySession } = require("../../src/music/manager");
const { stopProcessPair } = require("../../src/music/process-lifecycle");

function createChild(pid) {
    const child = new EventEmitter();
    child.pid = pid;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.exitCode = null;
    child.signalCode = null;
    child.killed = false;
    child.killCount = 0;
    child.kill = () => {
        child.killed = true;
        child.killCount += 1;
        child.signalCode = "SIGTERM";
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin.destroy();
        child.emit("close", null, "SIGTERM");
    };
    return child;
}

function makeSession() {
    return {
        closed: false,
        trackToken: 0,
        startingTrackToken: null,
        currentTrack: null,
        trackOffset: 0,
        effects: { bass: "off", stereo: "normal", radio: "off", spatial: { enabled: false, speed: "normal" } },
        effectsController: null,
        effectsLease: null,
        ytProcess: null,
        ffmpegProcess: null,
        resource: null,
        volume: 100,
        finishing: false,
        transitioning: false,
        manualTransition: false,
        error: null,
        player: {
            state: { status: AudioPlayerStatus.Idle },
            played: [],
            play(resource) {
                this.played.push(resource);
                this.state = { status: AudioPlayerStatus.Playing };
            },
            stop() {
                this.state = { status: AudioPlayerStatus.Idle };
            }
        }
    };
}

function runtimeHarness({ sendCommand }) {
    const children = [];
    let releases = 0;
    let clientCloses = 0;
    return {
        children,
        get releases() { return releases; },
        get clientCloses() { return clientCloses; },
        runtime: {
            allocateEndpoint: async () => ({
                endpoint: "tcp://127.0.0.1:42000",
                release: () => { releases += 1; }
            }),
            spawn: () => {
                const child = createChild(children.length + 1);
                children.push(child);
                return child;
            },
            buildFilterGraph: () => "anull",
            createAudioResource: () => ({ volume: { setVolume() {} } }),
            effectsClient: {
                sendCommand,
                async close() { clientCloses += 1; }
            }
        }
    };
}

test("Music Manager does not play a track when shutdown races Effects startup", async () => {
    let resolveCommand;
    let commandStarted;
    const started = new Promise(resolve => { commandStarted = resolve; });
    const harness = runtimeHarness({
        sendCommand: () => new Promise(resolve => {
            resolveCommand = resolve;
            commandStarted();
        })
    });
    const session = makeSession();
    const starting = startTrack(session, { source: "ytsearch1:track", title: "Track" }, 0, false, harness.runtime);

    await started;
    const controller = session.effectsController;
    const ytProcess = session.ytProcess;
    const ffmpegProcess = session.ffmpegProcess;
    assert.ok(controller);
    assert.equal(session.startingTrackToken, session.trackToken);

    session.closed = true;
    session.ytProcess = null;
    session.ffmpegProcess = null;
    session.resource = null;
    session.effectsController = null;
    session.effectsLease = null;
    const processCleanup = stopProcessPair(ytProcess, ffmpegProcess);
    const effectsCleanup = controller.close();
    resolveCommand("0");

    await Promise.all([processCleanup, effectsCleanup]);
    await assert.rejects(starting, /ditutup saat startup|startup track dibatalkan/i);
    assert.equal(session.player.played.length, 0);
    assert.equal(session.currentTrack, null);
    assert.equal(session.startingTrackToken, null);
    assert.equal(harness.children[0].killCount, 1);
    assert.equal(harness.children[1].killCount, 1);
    assert.equal(harness.releases, 1);
    assert.equal(harness.clientCloses, 1);
});

test("Music Manager starts playback only after Effects readiness succeeds", async () => {
    const harness = runtimeHarness({ sendCommand: async () => "0" });
    const session = makeSession();
    const track = { source: "ytsearch1:track", title: "Track" };

    await startTrack(session, track, 0, false, harness.runtime);
    assert.deepEqual(session.player.played, [session.resource]);
    assert.equal(session.currentTrack, track);
    assert.equal(session.startingTrackToken, null);
    assert.equal(session.effectsController.started, true);

    session.closed = true;
    const ytProcess = session.ytProcess;
    const ffmpegProcess = session.ffmpegProcess;
    await stopProcessPair(ytProcess, ffmpegProcess);
    await session.effectsController.close();
    assert.equal(harness.releases, 1);
    assert.equal(harness.clientCloses, 1);
});

test("Music Manager feeds FFmpeg only through the validated radio proxy", async () => {
    const harness = runtimeHarness({ sendCommand: async () => "0" });
    const spawn = harness.runtime.spawn;
    const spawnCalls = [];
    let proxyCloses = 0;
    harness.runtime.createRadioStreamProxy = async ({ sourceUrl }) => {
        assert.equal(sourceUrl, "https://stream.example/live.mp3");
        return {
            url: "http://127.0.0.1:45678/opaque-token",
            async close() { proxyCloses += 1; }
        };
    };
    harness.runtime.spawn = (executable, args, options) => {
        spawnCalls.push({ executable, args, options });
        return spawn(executable, args, options);
    };
    const session = makeSession();
    session.guildId = "test-guild";
    const track = {
        source: "https://stream.example/live.mp3",
        title: "Test Radio",
        radioStream: true
    };

    await startTrack(session, track, 0, false, harness.runtime);

    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].args.includes(track.source), false);
    assert.equal(spawnCalls[0].args.includes("http://127.0.0.1:45678/opaque-token"), true);
    assert.equal(spawnCalls[0].args.includes("pipe:0"), false);
    assert.equal(spawnCalls[0].args.includes("-reconnect_streamed"), true);
    assert.equal(spawnCalls[0].options.stdio[0], "ignore");
    assert.equal(session.ytProcess, null);
    assert.equal(session.currentTrack.radioStream, true);
    assert.deepEqual(session.player.played, [session.resource]);

    session.connection = { destroy() {} };
    await destroySession(session.guildId, session);
    assert.equal(harness.releases, 1);
    assert.equal(proxyCloses, 1);
});

test("Music Manager does not spawn FFmpeg when radio URL validation fails", async () => {
    const harness = runtimeHarness({ sendCommand: async () => "0" });
    const spawnCalls = [];
    harness.runtime.spawn = (...args) => {
        spawnCalls.push(args);
        return createChild(spawnCalls.length);
    };
    harness.runtime.createRadioStreamProxy = async () => {
        throw new Error("Radio stream hostname resolved to a private or reserved address.");
    };
    const session = makeSession();

    await assert.rejects(
        startTrack(session, {
            source: "https://radio.example/live",
            title: "Test Radio",
            radioStream: true
        }, 0, false, harness.runtime),
        /private or reserved/
    );
    assert.equal(spawnCalls.length, 0);
    assert.equal(session.ffmpegProcess, null);
    assert.equal(session.currentTrack, null);
    assert.equal(harness.releases, 1);
});

test("Music Manager closes the radio proxy when FFmpeg startup fails", async () => {
    const harness = runtimeHarness({ sendCommand: async () => "0" });
    let proxyCloses = 0;
    harness.runtime.createRadioStreamProxy = async () => ({
        url: "http://127.0.0.1:45678/opaque-token",
        async close() { proxyCloses += 1; }
    });
    harness.runtime.spawn = () => {
        throw new Error("FFmpeg spawn failed");
    };
    const session = makeSession();

    await assert.rejects(
        startTrack(session, {
            source: "https://radio.example/live",
            title: "Test Radio",
            radioStream: true
        }, 0, false, harness.runtime),
        /FFmpeg spawn failed/
    );
    assert.equal(proxyCloses, 1);
    assert.equal(harness.releases, 1);
    assert.equal(session.radioStreamProxy, null);
    assert.equal(session.currentTrack, null);
});

test("Music Manager releases the lease and child when FFmpeg spawn fails", async () => {
    const harness = runtimeHarness({ sendCommand: async () => "0" });
    const spawn = harness.runtime.spawn;
    let spawnCount = 0;
    harness.runtime.spawn = (...args) => {
        spawnCount += 1;
        if (spawnCount === 2) throw new Error("FFmpeg spawn failed");
        return spawn(...args);
    };
    const session = makeSession();

    await assert.rejects(
        startTrack(session, { source: "ytsearch1:track", title: "Track" }, 0, false, harness.runtime),
        /FFmpeg spawn failed/
    );
    assert.equal(session.currentTrack, null);
    assert.equal(session.startingTrackToken, null);
    assert.equal(session.ytProcess, null);
    assert.equal(harness.children.length, 1);
    assert.equal(harness.children[0].killCount, 1);
    assert.equal(harness.releases, 1);
});

test("Music Manager retries startup with a fresh endpoint after an address collision", async () => {
    const session = makeSession();
    const children = [];
    const ports = [42001, 42002];
    let releases = 0;
    let controllerStarts = 0;
    const runtime = {
        allocateEndpoint: async () => {
            const port = ports.shift();
            return {
                endpoint: `tcp://127.0.0.1:${port}`,
                release: () => { releases += 1; }
            };
        },
        spawn: () => {
            const child = createChild(children.length + 1);
            children.push(child);
            return child;
        },
        buildFilterGraph: () => "anull",
        createAudioResource: () => ({ volume: { setVolume() {} } }),
        EffectsController: class {
            constructor({ endpointLease }) {
                this.endpointLease = endpointLease;
            }
            async start() {
                controllerStarts += 1;
                if (controllerStarts === 1) {
                    children[children.length - 1].stderr.write("Could not bind socket: Address already in use");
                    throw new Error("FFmpeg ZeroMQ endpoint unavailable");
                }
            }
            async close() {
                this.endpointLease.release();
            }
        }
    };

    await startTrack(session, { source: "ytsearch1:track", title: "Track" }, 0, false, runtime);

    assert.equal(controllerStarts, 2);
    assert.equal(releases, 1);
    assert.equal(children.length, 4);
    assert.equal(children[0].killCount, 1);
    assert.equal(children[1].killCount, 1);
    assert.deepEqual(session.player.played, [session.resource]);
    assert.equal(session.currentTrack.title, "Track");
    assert.equal(session.effectsLease.endpoint, "tcp://127.0.0.1:42002");

    session.closed = true;
    await stopProcessPair(session.ytProcess, session.ffmpegProcess);
    await session.effectsController.close();
    assert.equal(releases, 2);
});

test("Music Manager bounds retries when every endpoint bind collides", async () => {
    const session = makeSession();
    const children = [];
    let allocations = 0;
    let releases = 0;
    let controllerStarts = 0;
    const runtime = {
        allocateEndpoint: async () => {
            allocations += 1;
            return {
                endpoint: `tcp://127.0.0.1:${42010 + allocations}`,
                release: () => { releases += 1; }
            };
        },
        spawn: () => {
            const child = createChild(children.length + 1);
            children.push(child);
            return child;
        },
        buildFilterGraph: () => "anull",
        createAudioResource: () => ({ volume: { setVolume() {} } }),
        EffectsController: class {
            constructor({ endpointLease }) {
                this.endpointLease = endpointLease;
            }
            async start() {
                controllerStarts += 1;
                children[children.length - 1].stderr.write("Could not bind socket: Address already in use");
                throw new Error("FFmpeg ZeroMQ endpoint unavailable");
            }
            async close() {
                this.endpointLease.release();
            }
        }
    };

    await assert.rejects(
        startTrack(session, { source: "ytsearch1:track", title: "Track" }, 0, false, runtime),
        /endpoint unavailable/i
    );

    assert.equal(allocations, 3);
    assert.equal(controllerStarts, 3);
    assert.equal(releases, 3);
    assert.equal(children.length, 6);
    assert.ok(children.every(child => child.killCount === 1));
    assert.equal(session.currentTrack, null);
    assert.equal(session.startingTrackToken, null);
    assert.equal(session.ytProcess, null);
    assert.equal(session.ffmpegProcess, null);
});

test("Music Manager still releases Effects lease when child cleanup times out", async () => {
    const harness = runtimeHarness({ sendCommand: async () => "0" });
    const spawn = harness.runtime.spawn;
    let spawnCount = 0;
    harness.runtime.spawn = (...args) => {
        spawnCount += 1;
        if (spawnCount === 2) throw new Error("FFmpeg spawn failed");
        return spawn(...args);
    };
    harness.runtime.stopProcessPair = async () => {
        throw new Error("child did not close");
    };
    const session = makeSession();

    await assert.rejects(
        startTrack(session, { source: "ytsearch1:track", title: "Track" }, 0, false, harness.runtime),
        /FFmpeg spawn failed/
    );
    assert.equal(harness.releases, 1);
    assert.equal(session.currentTrack, null);
    assert.equal(session.ytProcess, null);
});
