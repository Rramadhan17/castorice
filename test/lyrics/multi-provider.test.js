const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanTrackMetadata } = require("../../src/lyrics/title-cleaner");
const { searchLyrics, clearCache } = require("../../src/lyrics/engine");

test("cleanTrackMetadata removes YouTube video tags and detects versions", () => {
    const t1 = cleanTrackMetadata("Adele - Hello (Official Music Video)");
    assert.equal(t1.cleanArtist, "Adele");
    assert.equal(t1.cleanTitle, "Hello");
    assert.equal(t1.version, "original");

    const t2 = cleanTrackMetadata("Yellow (Live in Buenos Aires)", "Coldplay");
    assert.equal(t2.cleanTitle, "Yellow");
    assert.equal(t2.cleanArtist, "Coldplay");
    assert.equal(t2.version, "live");

    const t3 = cleanTrackMetadata("Levitating (feat. DaBaby) [Club Remix]", "Dua Lipa");
    assert.equal(t3.cleanTitle, "Levitating");
    assert.equal(t3.version, "remix");
    assert.equal(t3.featured, "DaBaby");

    const t4 = cleanTrackMetadata("Creep (Acoustic Version)");
    assert.equal(t4.version, "acoustic");
});

test("searchLyrics falls back to secondary provider if LRCLIB returns not_found", async () => {
    clearCache();
    const fakeLrclib = async () => null;
    const fakeOvh = async (title, artist) => ({
        found: true,
        instrumental: false,
        synced: false,
        lyrics: [],
        plainLyrics: `Plain lyrics for ${title} by ${artist}`,
        source: "LyricsOVH"
    });

    const result = await searchLyrics(
        { title: "Song Without Synced", artist: "Artist A" },
        { queryLrclib: fakeLrclib, queryLyricsOvh: fakeOvh }
    );

    assert.equal(result.found, true);
    assert.equal(result.synced, false);
    assert.equal(result.source, "LyricsOVH");
    assert.match(result.plainLyrics, /Plain lyrics for Song Without Synced/);
});

test("searchLyrics uses LRCLIB primary when available with synced lyrics", async () => {
    clearCache();
    const fakeLrclib = async (title, artist) => ({
        found: true,
        instrumental: false,
        synced: true,
        lyrics: [{ time: 1, text: "First line" }],
        plainLyrics: "First line",
        source: "LRCLIB"
    });

    const result = await searchLyrics(
        { title: "Hit Song", artist: "Pop Star" },
        { queryLrclib: fakeLrclib }
    );

    assert.equal(result.found, true);
    assert.equal(result.synced, true);
    assert.equal(result.source, "LRCLIB");
    assert.equal(result.lyrics.length, 1);
});
