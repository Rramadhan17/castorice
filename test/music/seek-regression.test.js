const test = require("node:test");
const assert = require("node:assert/strict");
const music = require("../../src/music/manager");

test("seek throws when no session or no current track", async () => {
    await assert.rejects(
        () => music.seek({ id: "non-existent-guild" }, 5),
        /Tidak ada lagu yang sedang diputar/
    );
});

test("seek is rejected for live radio streams", async () => {
    const fakeSession = {
        currentTrack: { title: "Test Radio", radioStream: true },
        startingTrackToken: null,
        transitioning: false,
        finishing: false,
        player: { state: { status: "playing" } }
    };
    music.getSessions().set("guild-radio-seek", fakeSession);

    try {
        await assert.rejects(
            () => music.seek({ id: "guild-radio-seek" }, 5),
            /Seek tidak tersedia untuk live radio/
        );
    } finally {
        music.getSessions().delete("guild-radio-seek");
    }
});

test("seek rejects delta exceeding 5 seconds", async () => {
    const fakeSession = {
        currentTrack: { title: "Test", duration: 180 },
        startingTrackToken: null,
        transitioning: false,
        finishing: false,
        player: { state: { status: "playing" } }
    };
    music.getSessions().set("guild-seek", fakeSession);

    try {
        await assert.rejects(
            () => music.seek({ id: "guild-seek" }, 10),
            /Seek hanya mendukung perpindahan maksimal 5 detik/
        );
        await assert.rejects(
            () => music.seek({ id: "guild-seek" }, -6),
            /Seek hanya mendukung perpindahan maksimal 5 detik/
        );
    } finally {
        music.getSessions().delete("guild-seek");
    }
});

test("seek -5 clamps to lower boundary 0", async () => {
    let transitionedOffset = null;
    let stopped = false;

    const fakeSession = {
        currentTrack: { title: "Test", duration: 180 },
        startingTrackToken: null,
        transitioning: false,
        finishing: false,
        trackOffset: 2,
        player: {
            state: { status: "playing" },
            stop: () => { stopped = true; }
        },
        queue: [],
        history: [],
        resource: { playbackDuration: 1000 } // total position = 3s
    };

    music.getSessions().set("guild-seek-bound", fakeSession);

    const runtime = {
        transitionTrack: async (session, track, offset) => {
            transitionedOffset = offset;
        }
    };

    try {
        const target = await music.seek({ id: "guild-seek-bound" }, -5, runtime);
        assert.equal(target, 0);
        assert.equal(transitionedOffset, 0);
        assert.equal(stopped, false); // No accidental Stop
    } finally {
        music.getSessions().delete("guild-seek-bound");
    }
});

test("seek +5 past track duration triggers clean track finish", async () => {
    let finishedCalled = false;

    const fakeSession = {
        currentTrack: { title: "Ending Song", duration: 100 },
        startingTrackToken: null,
        transitioning: false,
        finishing: false,
        trackOffset: 98,
        player: { state: { status: "playing" } },
        queue: [],
        history: [],
        resource: { playbackDuration: 0 }
    };

    music.getSessions().set("guild-seek-end", fakeSession);

    const runtime = {
        finishTrack: async session => {
            finishedCalled = true;
        }
    };

    try {
        const target = await music.seek({ id: "guild-seek-end" }, 5, runtime);
        assert.equal(target, 100);
        assert.equal(finishedCalled, true);
    } finally {
        music.getSessions().delete("guild-seek-end");
    }
});

test("seek serializes concurrent/repeated rapid clicks", async () => {
    const offsets = [];
    const fakeSession = {
        currentTrack: { title: "Test Song", duration: 200 },
        startingTrackToken: null,
        transitioning: false,
        finishing: false,
        trackOffset: 10,
        player: { state: { status: "playing" } },
        queue: [],
        history: [],
        resource: { playbackDuration: 0 }
    };

    music.getSessions().set("guild-seek-rapid", fakeSession);

    const runtime = {
        transitionTrack: async (session, track, offset) => {
            session.transitioning = true;
            await new Promise(r => setTimeout(r, 20));
            offsets.push(offset);
            session.trackOffset = offset;
            session.transitioning = false;
        }
    };

    try {
        // Run two seeks simultaneously
        const [p1, p2] = await Promise.all([
            music.seek({ id: "guild-seek-rapid" }, 5, runtime),
            music.seek({ id: "guild-seek-rapid" }, 5, runtime)
        ]);

        assert.equal(offsets.length, 2);
        assert.equal(offsets[0], 15);
        assert.equal(offsets[1], 20);
    } finally {
        music.getSessions().delete("guild-seek-rapid");
    }
});
