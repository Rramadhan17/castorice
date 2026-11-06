const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const { checkFeature } = require("../../src/core/feature-guard");
const { getFeatureState, setFeatureEnabled } = require("../../src/features/feature-manager");

const guildId = `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
const guildDirectory = path.resolve(__dirname, "../../data/guilds", guildId);

test("Feature Guard follows the persisted per-guild Music setting", async t => {
    t.after(async () => {
        await fs.rm(guildDirectory, { recursive: true, force: true });
    });

    const enabled = await checkFeature(guildId, "music");
    assert.equal(enabled.allowed, true);

    await setFeatureEnabled(guildId, "music", false);
    const disabled = await checkFeature(guildId, "music");
    assert.equal(disabled.allowed, false);
    assert.match(disabled.reason, /dinonaktifkan/i);

    await setFeatureEnabled(guildId, "music", true);
    const reenabled = await checkFeature(guildId, "music");
    assert.equal(reenabled.allowed, true);
});

test("Feature Guard fails closed for missing guild IDs", async () => {
    const result = await checkFeature(null, "music");
    assert.equal(result.allowed, false);
    assert.match(result.reason, /server Discord/i);
});

test("Voice AI is implemented but remains disabled by default", async t => {
    t.after(async () => {
        await fs.rm(guildDirectory, { recursive: true, force: true });
    });
    const state = await getFeatureState(guildId, "voice_ai");
    assert.equal(state.available, true);
    assert.equal(state.enabled, false);
    const guarded = await checkFeature(guildId, "voice_ai");
    assert.equal(guarded.allowed, false);
    assert.match(guarded.reason, /dinonaktifkan/i);
});

test("unimplemented features cannot be enabled", async () => {
    await assert.rejects(
        setFeatureEnabled(guildId, "auto_disconnect", true),
        /belum tersedia/i
    );
});

test("Translator is registered as implemented and defaults to enabled", async () => {
    const result = await checkFeature(guildId, "translator");
    assert.equal(result.allowed, true);
    assert.equal(result.state.available, true);
});

test("Voice Greeter is registered as implemented and defaults to enabled", async () => {
    const result = await checkFeature(guildId, "voice_greeter");
    assert.equal(result.allowed, true);
    assert.equal(result.state.available, true);
});

test("Playlists are registered as implemented and default to enabled", async () => {
    const result = await checkFeature(guildId, "playlists");
    assert.equal(result.allowed, true);
    assert.equal(result.state.available, true);
});
