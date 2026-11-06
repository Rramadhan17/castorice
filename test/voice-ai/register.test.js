const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const registerVoiceManager = require("../../src/voice-ai/register");

test("Voice Manager registration wires interactions and voice lifecycle and disposes them", () => {
    const client = new EventEmitter();
    const stateStore = {
        getGuildState: async () => ({ temporaryVoices: {} }),
        getVoiceState: async () => null
    };
    const logger = { error() {} };
    const registration = registerVoiceManager(client, { stateStore, logger });

    assert.equal(client.listenerCount("voiceStateUpdate"), 1);
    assert.equal(client.listenerCount("clientReady"), 1);
    assert.equal(client.listenerCount("interactionCreate"), 1);

    registration.dispose();
    assert.equal(client.listenerCount("voiceStateUpdate"), 0);
    assert.equal(client.listenerCount("clientReady"), 0);
    assert.equal(client.listenerCount("interactionCreate"), 0);
});
