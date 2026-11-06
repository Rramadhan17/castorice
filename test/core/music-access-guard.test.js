const test = require("node:test");
const assert = require("node:assert/strict");
const music = require("../../src/music/manager");
const { checkMusicAccess } = require("../../src/core/music-access-guard");

function makeGuild({ member, botMember, fetchError, fetchMeError } = {}) {
    return {
        id: "guild-1",
        members: {
            fetch: async () => {
                if (fetchError) throw fetchError;
                return member;
            },
            fetchMe: async () => {
                if (fetchMeError) throw fetchMeError;
                return botMember;
            }
        }
    };
}

function makeSession(overrides = {}) {
    return {
        guildId: "guild-1",
        channelId: "voice-1",
        connection: {
            state: { status: "ready" },
            joinConfig: { channelId: "voice-1" }
        },
        ...overrides
    };
}

function makeMember(guildId = "guild-1", channelId = "voice-1") {
    return { guild: { id: guildId }, voice: { channelId } };
}

test("Music access guard fails closed outside a guild and when member lookup fails", async () => {
    assert.equal((await checkMusicAccess(null, "user-1")).allowed, false);
    const result = await checkMusicAccess(makeGuild({ fetchError: new Error("lookup") }), "user-1");
    assert.equal(result.allowed, false);
    assert.match(result.reason, /gagal diperiksa/i);
});

test("Music access guard denies missing, foreign, and disconnected sessions", async t => {
    const original = music.getSession;
    t.after(() => { music.getSession = original; });
    const member = makeMember();
    const guild = makeGuild({ member, botMember: member });

    music.getSession = () => null;
    assert.match((await checkMusicAccess(guild, "user-1")).reason, /belum memiliki sesi/i);

    music.getSession = () => makeSession({ guildId: "guild-elsewhere" });
    assert.match((await checkMusicAccess(guild, "user-1")).reason, /belum siap/i);

    music.getSession = () => makeSession({ connection: null });
    assert.match((await checkMusicAccess(guild, "user-1")).reason, /belum siap/i);
});

test("Music access guard denies an invalid bot position and members outside the session channel", async t => {
    const original = music.getSession;
    t.after(() => { music.getSession = original; });
    const guild = makeGuild({ member: makeMember("guild-1", "voice-2"), botMember: makeMember() });

    music.getSession = () => makeSession({ connection: { state: { status: "ready" }, joinConfig: { channelId: "voice-2" } } });
    assert.match((await checkMusicAccess(guild, "user-1")).reason, /posisi voice channel/i);

    music.getSession = () => makeSession();
    assert.match((await checkMusicAccess(guild, "user-1")).reason, /voice channel yang sama/i);
});

test("Music access guard allows a member only in the ready bot session channel", async t => {
    const original = music.getSession;
    t.after(() => { music.getSession = original; });
    const member = makeMember();
    const session = makeSession();
    music.getSession = () => session;

    const result = await checkMusicAccess(makeGuild({ member, botMember: member }), "user-1");
    assert.equal(result.allowed, true);
    assert.equal(result.member, member);
    assert.equal(result.session, session);
});
