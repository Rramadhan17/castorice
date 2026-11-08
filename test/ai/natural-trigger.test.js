const test = require("node:test");
const assert = require("node:assert/strict");
const { extractTrigger } = require("../../src/ai/natural-trigger");

test("extractTrigger ignores bot messages and webhooks", () => {
    const botMsg = { author: { bot: true }, content: "Castorice play song" };
    assert.deepEqual(extractTrigger(botMsg), { isTriggered: false, cleanText: "", triggerType: null });

    const webhookMsg = { webhookId: "123456", content: "Castorice play song" };
    assert.deepEqual(extractTrigger(webhookMsg), { isTriggered: false, cleanText: "", triggerType: null });

    const emptyMsg = { content: "   " };
    assert.deepEqual(extractTrigger(emptyMsg), { isTriggered: false, cleanText: "", triggerType: null });
});

test("extractTrigger detects leading Discord mention", () => {
    const clientUser = { id: "987654321" };
    const msg = {
        author: { bot: false },
        content: "<@987654321> play Die With A Smile",
        client: { user: clientUser }
    };
    const res = extractTrigger(msg, clientUser);
    assert.equal(res.isTriggered, true);
    assert.equal(res.triggerType, "mention");
    assert.equal(res.cleanText, "play Die With A Smile");
});

test("extractTrigger detects mention with nickname exclamation mark", () => {
    const clientUser = { id: "987654321" };
    const msg = {
        author: { bot: false },
        content: "<@!987654321>: atur auto disconnect 2 menit",
        client: { user: clientUser }
    };
    const res = extractTrigger(msg, clientUser);
    assert.equal(res.isTriggered, true);
    assert.equal(res.triggerType, "mention");
    assert.equal(res.cleanText, "atur auto disconnect 2 menit");
});

test("extractTrigger detects natural name triggers", () => {
    const cases = [
        { text: "Castorice: play Die With A Smile", expectedClean: "play Die With A Smile" },
        { text: "Castorice, buat voice AI", expectedClean: "buat voice AI" },
        { text: "Castorice! buat voice AI", expectedClean: "buat voice AI" },
        { text: "Castorice... aktifkan Kick Voice", expectedClean: "aktifkan Kick Voice" },
        { text: "castorice bantu terjemahkan kalimat ini", expectedClean: "bantu terjemahkan kalimat ini" },
        { text: "Hey Castorice: status musik", expectedClean: "status musik" },
        { text: "Hai castorice, pause", expectedClean: "pause" },
        { text: "Castorice", expectedClean: "" },
        { text: "Castorice!", expectedClean: "" }
    ];

    for (const { text, expectedClean } of cases) {
        const msg = { author: { bot: false }, content: text };
        const res = extractTrigger(msg);
        assert.equal(res.isTriggered, true, `Failed on: "${text}"`);
        assert.equal(res.triggerType, "name");
        assert.equal(res.cleanText, expectedClean, `Failed cleanText on: "${text}"`);
    }
});

test("extractTrigger is boundary-aware and does NOT trigger when name is inside a sentence", () => {
    const nonTriggerCases = [
        "Aku suka castorice bot",
        "Menurut saya castorice sangat bagus",
        "Siapa castorice itu?",
        "server castorice mantap"
    ];

    for (const text of nonTriggerCases) {
        const msg = { author: { bot: false }, content: text };
        const res = extractTrigger(msg);
        assert.equal(res.isTriggered, false, `Incorrectly triggered on: "${text}"`);
    }
});
