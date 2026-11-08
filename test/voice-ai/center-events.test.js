const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Events } = require("discord.js");
const { registerVoiceCenterEvents } = require("../../src/voice-ai/center-events");

test("Voice Center registers state and startup handlers, contains failures, and disposes listeners", async () => {
    const client = new EventEmitter();
    const calls = [];
    const errors = [];
    const service = {
        onVoiceStateUpdate: async (...args) => { calls.push(["voice", ...args]); },
        recoverTimers: async guilds => { calls.push(["ready", guilds.size]); },
        dispose: () => calls.push(["dispose"])
    };
    const registration = registerVoiceCenterEvents(client, {
        service,
        logger: { error: (...args) => errors.push(args) }
    });
    const guild = { id: "12345678901234567" };
    client.emit(Events.VoiceStateUpdate, { guild }, { guild });
    await new Promise(resolve => setImmediate(resolve));
    client.guilds = { cache: new Map([[guild.id, guild]]) };
    client.emit(Events.ClientReady);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.filter(call => call[0] === "voice").length, 1);
    assert.deepEqual(calls.find(call => call[0] === "ready"), ["ready", 1]);
    registration.dispose();
    assert.equal(client.listenerCount(Events.VoiceStateUpdate), 0);
    assert.equal(client.listenerCount(Events.ClientReady), 0);
    assert.equal(calls.at(-1)[0], "dispose");
    assert.equal(errors.length, 0);
});
