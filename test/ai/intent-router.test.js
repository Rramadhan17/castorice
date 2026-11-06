const test = require("node:test");
const assert = require("node:assert/strict");
const {
    resolveIntent,
    setChannelContext,
    getChannelContext,
    clearChannelContext
} = require("../../src/ai/intent-router");

test("resolveIntent routes Auto Disconnect commands", () => {
    const res1 = resolveIntent("atur auto disconnect 2 menit 10 detik");
    assert.equal(res1.domain, "auto_disconnect");
    assert.equal(res1.action, "set");
    assert.equal(res1.rawDuration, "2 menit 10 detik");

    const res2 = resolveIntent("matikan auto disconnect");
    assert.equal(res2.domain, "auto_disconnect");
    assert.equal(res2.action, "cancel");

    const res3 = resolveIntent("cek auto disconnect");
    assert.equal(res3.domain, "auto_disconnect");
    assert.equal(res3.action, "status");
});

test("resolveIntent routes Trusted Member commands", () => {
    const res1 = resolveIntent("tambah trusted member @user123");
    assert.equal(res1.domain, "trusted_member");
    assert.equal(res1.action, "add");
    assert.equal(res1.target, "@user123");

    const res2 = resolveIntent("hapus trusted member 12345678901234567");
    assert.equal(res2.domain, "trusted_member");
    assert.equal(res2.action, "remove");

    const res3 = resolveIntent("daftar trusted member");
    assert.equal(res3.domain, "trusted_member");
    assert.equal(res3.action, "list");
});

test("resolveIntent routes Auto Kick and Bot Audit commands", () => {
    const res1 = resolveIntent("audit bot offline");
    assert.equal(res1.domain, "auto_kick");
    assert.equal(res1.action, "audit");

    const res2 = resolveIntent("kick bot offline");
    assert.equal(res2.domain, "auto_kick");
    assert.equal(res2.action, "kick_offline");
});

test("resolveIntent routes Social Downloader commands", () => {
    const res1 = resolveIntent("download https://www.tiktok.com/@user/video/1234567890");
    assert.equal(res1.domain, "social_downloader");
    assert.equal(res1.action, "download");
    assert.equal(res1.platform, "tiktok");

    const res2 = resolveIntent("unduh instagram https://www.instagram.com/reel/abcdefg/");
    assert.equal(res2.domain, "social_downloader");
    assert.equal(res2.action, "download");
    assert.equal(res2.platform, "instagram");

    const res3 = resolveIntent("download");
    assert.equal(res3.domain, "social_downloader");
    assert.equal(res3.action, "missing_url");
});

test("resolveIntent routes Security Audit commands", () => {
    const res = resolveIntent("audit keamanan");
    assert.equal(res.domain, "security");
    assert.equal(res.action, "audit");
});

test("resolveIntent routes Music and Playlist commands", () => {
    const res1 = resolveIntent("play Die With A Smile");
    assert.equal(res1.domain, "music");
    assert.equal(res1.action, "play");

    const res2 = resolveIntent("lihat antrean");
    assert.equal(res2.domain, "music");
    assert.equal(res2.action, "queue_show");

    const res3 = resolveIntent("putar playlist Santai");
    assert.equal(res3.domain, "playlists");
    assert.equal(res3.action, "playlist_play");

    const res4 = resolveIntent("terjemahkan halo ke en");
    assert.equal(res4.domain, "translator");
    assert.equal(res4.action, "translate");
});

test("channel context lifecycle stores and retrieves state", () => {
    const channelId = "ch-12345";
    setChannelContext(channelId, { lastIntent: "social_downloader", waitingFor: "url" });
    const ctx = getChannelContext(channelId);
    assert.equal(ctx.lastIntent, "social_downloader");
    assert.equal(ctx.waitingFor, "url");

    clearChannelContext(channelId);
    assert.equal(getChannelContext(channelId), null);
});
