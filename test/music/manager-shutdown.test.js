const test = require("node:test");
const assert = require("node:assert/strict");
const music = require("../../src/music/manager");

test("music shutdown destroys tracked sessions once", async () => {
    const guildId = `shutdown-${process.pid}`;
    const session = {
        closed: false,
        connection: { destroyCalls: 0, destroy() { this.destroyCalls += 1; } }
    };
    music.getSessions().set(guildId, session);

    try {
        await music.shutdown();
        await music.shutdown();

        assert.equal(session.closed, true);
        assert.equal(session.connection.destroyCalls, 1);
        assert.equal(music.getSessions().has(guildId), false);
    } finally {
        music.getSessions().delete(guildId);
    }
});

test("music shutdown rejects when session resource cleanup fails", async () => {
    const guildId = `shutdown-failure-${process.pid}`;
    const session = {
        closed: false,
        ytDlpProxy: { async close() { throw new Error("proxy cleanup failed"); } },
        connection: { destroy() {} }
    };
    music.getSessions().set(guildId, session);

    try {
        await assert.rejects(music.shutdown(), error =>
            error instanceof AggregateError &&
            error.errors.some(item => item.message === "Music process or network proxy cleanup failed.")
        );
        assert.equal(session.closed, true);
        assert.equal(music.getSessions().has(guildId), false);
    } finally {
        music.getSessions().delete(guildId);
    }
});
