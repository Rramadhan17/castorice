const test = require("node:test");
const assert = require("node:assert/strict");
const {
    parseVoiceIntent,
    createVoiceTagRouter
} = require("../../src/voice-ai/tag-router");

test("Voice intents parse supported natural-language controls", () => {
    assert.deepEqual(parseVoiceIntent("buat voice private bernama Game Room"), {
        type: "create",
        privacy: "private",
        name: "Game Room"
    });
    assert.deepEqual(parseVoiceIntent("rename voice jadi Quiet Room"), {
        type: "rename",
        name: "Quiet Room"
    });
    assert.deepEqual(parseVoiceIntent("atur limit voice 12"), { type: "limit", value: 12 });
    assert.deepEqual(parseVoiceIntent("kunci voice saya"), { type: "lock", value: true });
    assert.deepEqual(parseVoiceIntent("transfer owner voice ke 12345678901234567"), {
        type: "transfer",
        targetId: "12345678901234567"
    });
    assert.equal(parseVoiceIntent("buat template voice gaming"), null);
});

test("Voice Tag refuses disabled modules before calling the service", async () => {
    let calls = 0;
    const handle = createVoiceTagRouter({
        service: { createTemporaryVoice: async () => { calls += 1; } },
        stateStore: {},
        featureGuard: async () => ({ allowed: false, reason: "disabled" })
    });
    const replies = [];
    const message = {
        guild: { id: "12345678901234567" },
        author: { id: "22345678901234567" },
        reply: async value => replies.push(value)
    };

    assert.equal(await handle({ message, commandText: "buat voice" }), true);
    assert.equal(calls, 0);
    assert.equal(replies[0], "disabled");
});

test("Voice Tag delete request asks for confirmation", async () => {
    const handle = createVoiceTagRouter({
        service: {},
        stateStore: {},
        featureGuard: async () => ({ allowed: true })
    });
    const replies = [];
    const message = {
        guild: { id: "12345678901234567", members: { fetch: async () => ({ id: "22345678901234567" }) } },
        author: { id: "22345678901234567" },
        reply: async value => replies.push(value)
    };

    assert.equal(await handle({ message, commandText: "hapus voice saya" }), true);
    assert.match(replies[0].content, /Hapus temporary voice/);
    assert.equal(replies[0].components[0].components[0].toJSON().custom_id, `voice:delete_confirm:${message.author.id}`);
});
