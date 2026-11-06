const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const registerGreeter = require("../../src/voice-ai/greeter");

function makeGuildId() {
    return `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
}

test("Voice Greeter configuration persists, validates limits, and personalizes mention-safe output", async t => {
    const guildId = makeGuildId();
    const guildDirectory = path.resolve(__dirname, "../../data/guilds", guildId);
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));

    const fallback = await registerGreeter.getGreeting(guildId);
    assert.equal(fallback, registerGreeter.DEFAULT_GREETING);
    await assert.rejects(registerGreeter.setGreeting(guildId, "  "), /1 sampai 500/);
    await assert.rejects(registerGreeter.setGreeting(guildId, "x".repeat(501)), /1 sampai 500/);
    await assert.rejects(registerGreeter.getGreeting("../../outside"), /ID server tidak valid/);

    await registerGreeter.setGreeting(guildId, "  Selamat datang {user}! @everyone dan @here  ");
    assert.equal(await registerGreeter.getGreeting(guildId), "Selamat datang {user}! @everyone dan @here");

    const sent = [];
    const userId = "12345678901234567";
    const state = {
        channelId: "voice-1",
        channel: { async send(payload) { sent.push(payload); } },
        guild: { id: guildId },
        member: { user: { bot: false } },
        id: userId
    };

    await registerGreeter.handleVoiceStateUpdate({ channelId: null }, state);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].content, `Selamat datang <@${userId}>! @\u200Beveryone dan @\u200Bhere`);
    assert.deepEqual(sent[0].allowedMentions, { parse: [], users: [userId] });
});
