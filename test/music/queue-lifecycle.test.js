const test = require("node:test");
const assert = require("node:assert/strict");
const music = require("../../src/music/manager");
const { transitionTrack, finishTrack } = music;

function makeSession({ currentTrack = { id: "current" }, queue = [] } = {}) {
    return {
        closed: false,
        currentTrack,
        queue: [...queue],
        history: [],
        finishing: false,
        transitioning: false,
        manualTransition: false,
        startingTrackToken: null,
        resumeAfterSeek: false,
        error: null,
        player: {
            stopped: 0,
            stop() { this.stopped += 1; }
        }
    };
}

test("natural track finish records history and starts one queued track", async () => {
    const previous = { id: "previous" };
    const next = { id: "next" };
    const session = makeSession({ currentTrack: previous, queue: [next] });
    const calls = { cleanup: 0, close: 0, starts: [] };

    await finishTrack(session, {
        async cleanupTrack() { calls.cleanup += 1; },
        async closeEffectsRuntime() { calls.close += 1; },
        async startTrack(currentSession, track) {
            calls.starts.push(track);
            currentSession.currentTrack = track;
            currentSession.finishing = false;
        }
    });

    assert.deepEqual(session.history, [previous]);
    assert.deepEqual(calls.starts, [next]);
    assert.equal(session.currentTrack, next);
    assert.equal(session.finishing, false);
    assert.equal(calls.cleanup, 1);
    assert.equal(calls.close, 1);
});

test("concurrent idle finish events claim queue cleanup only once", async () => {
    let releaseCleanup;
    let cleanupCalls = 0;
    let closeCalls = 0;
    const session = makeSession({ currentTrack: { id: "done" } });
    const runtime = {
        cleanupTrack: () => {
            cleanupCalls += 1;
            return new Promise(resolve => { releaseCleanup = resolve; });
        },
        async closeEffectsRuntime() { closeCalls += 1; }
    };

    const first = finishTrack(session, runtime);
    const second = finishTrack(session, runtime);
    assert.equal(cleanupCalls, 1);
    releaseCleanup();
    await Promise.all([first, second]);

    assert.equal(closeCalls, 1);
    assert.deepEqual(session.history, [{ id: "done" }]);
    assert.equal(session.finishing, false);
});

test("finish closes Effects but does not advance queue when process cleanup fails", async () => {
    const current = { id: "current" };
    const next = { id: "next" };
    const session = makeSession({ currentTrack: current, queue: [next] });
    let effectsClosed = 0;
    let tracksStarted = 0;

    await finishTrack(session, {
        async cleanupTrack() { throw new Error("child did not close"); },
        async closeEffectsRuntime() { effectsClosed += 1; },
        async startTrack() { tracksStarted += 1; }
    });

    assert.equal(effectsClosed, 1);
    assert.equal(tracksStarted, 0);
    assert.equal(session.finishing, false);
    assert.equal(session.error, "Music process cleanup failed: child did not close");
    assert.equal(session.currentTrack, current);
    assert.deepEqual(session.queue, [next]);
});

test("finish skips a failed queued track and starts the following track", async () => {
    const failed = { id: "failed" };
    const next = { id: "next" };
    const session = makeSession({ currentTrack: { id: "done" }, queue: [failed, next] });
    const started = [];
    let cleanupCalls = 0;

    await finishTrack(session, {
        async cleanupTrack() { cleanupCalls += 1; },
        async closeEffectsRuntime() {},
        async startTrack(currentSession, track) {
            started.push(track);
            if (track === failed) throw new Error("track failed");
            currentSession.currentTrack = track;
            currentSession.finishing = false;
        }
    });

    assert.deepEqual(started, [failed, next]);
    assert.equal(session.currentTrack, next);
    assert.equal(session.error, "track failed");
    assert.equal(cleanupCalls, 2);
    assert.deepEqual(session.queue, []);
});

test("autoplay fails closed without starting an external search", async () => {
    const completed = {
        id: "completed",
        title: "Current Song",
        artist: "Current Artist",
        webpageUrl: "https://www.youtube.com/watch?v=completed"
    };
    const session = makeSession({ currentTrack: completed });
    session.autoplayEnabled = true;
    let searches = 0;
    const starts = [];

    await finishTrack(session, {
        async cleanupTrack() {},
        async closeEffectsRuntime() {},
        async validateMusicInput(url) { return url; },
        async searchTracks(query) {
            searches += 1;
            return [
                { title: "Current Song", webpageUrl: completed.webpageUrl },
                { title: "Next Song", webpageUrl: "https://www.youtube.com/watch?v=next" }
            ];
        },
        async startTrack(currentSession, track) {
            starts.push(track);
            currentSession.currentTrack = track;
            currentSession.finishing = false;
        }
    });

    assert.equal(searches, 0);
    assert.equal(starts.length, 0);
    assert.equal(session.queue.length, 0);
    assert.match(session.error, /isolasi egress tingkat proses\/OS/);
});

test("autoplay does not search when a user-requested track is already queued", async () => {
    const queued = { id: "queued" };
    const session = makeSession({
        currentTrack: { id: "completed" },
        queue: [queued]
    });
    session.autoplayEnabled = true;
    let searches = 0;
    let started;

    await finishTrack(session, {
        async cleanupTrack() {},
        async closeEffectsRuntime() {},
        async searchTracks() { searches += 1; return []; },
        async startTrack(currentSession, track) {
            started = track;
            currentSession.currentTrack = track;
            currentSession.finishing = false;
        }
    });

    assert.equal(searches, 0);
    assert.equal(started, queued);
});

test("autoplay does not invoke a supplied search helper while yt-dlp is disabled", async t => {
    const guildId = `autoplay-${Date.now()}-${Math.random()}`;
    const session = makeSession({ currentTrack: { id: "completed", title: "Song" } });
    session.autoplayEnabled = true;
    music.getSessions().set(guildId, session);
    t.after(() => music.getSessions().delete(guildId));
    let searches = 0;
    let started = 0;

    await finishTrack(session, {
        async cleanupTrack() {},
        async closeEffectsRuntime() {},
        async searchTracks() { searches += 1; return []; },
        async startTrack() { started += 1; }
    });

    assert.equal(searches, 0);
    assert.equal(started, 0);
    assert.equal(session.queue.length, 0);
    assert.match(session.error, /isolasi egress tingkat proses\/OS/);
});

test("overlapping manual transitions reject the second operation", async () => {
    let finishStart;
    let signalStart;
    const starting = new Promise(resolve => { signalStart = resolve; });
    const session = makeSession();
    const target = { id: "target" };
    const transition = transitionTrack(session, target, 0, {
        async cleanupTrack() {},
        async closeEffectsRuntime() {},
        startTrack: async currentSession => {
            signalStart();
            await new Promise(resolve => { finishStart = resolve; });
            currentSession.currentTrack = target;
            currentSession.transitioning = false;
            currentSession.manualTransition = false;
            currentSession.finishing = false;
            currentSession.startingTrackToken = null;
        },
        finishTrack: async () => {}
    });

    await starting;
    assert.equal(session.transitioning, true);
    await assert.rejects(
        transitionTrack(session, { id: "second" }, 0, {}),
        /transisi musik sedang berlangsung/i
    );
    finishStart();
    await transition;
    assert.equal(session.player.stopped, 1);
    assert.equal(session.currentTrack, target);
    assert.equal(session.transitioning, false);
});

test("failed manual transition resets locks and requests queue recovery", async () => {
    const session = makeSession();
    let recoveries = 0;
    await assert.rejects(
        transitionTrack(session, { id: "failed-target" }, 0, {
            async cleanupTrack() {},
            async closeEffectsRuntime() {},
            async startTrack() { throw new Error("startup failed"); },
            async finishTrack() { recoveries += 1; }
        }),
        /startup failed/
    );
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(session.transitioning, false);
    assert.equal(session.manualTransition, false);
    assert.equal(session.finishing, false);
    assert.equal(session.resumeAfterSeek, false);
    assert.equal(recoveries, 1);
});
