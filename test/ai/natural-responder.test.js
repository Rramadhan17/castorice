const test = require("node:test");
const assert = require("node:assert/strict");
const { NaturalResponder, formatTemplate } = require("../../src/ai/natural-responder");

test("formatTemplate replaces placeholders accurately", () => {
    const res = formatTemplate("Halo {user}, lagu {title} selesai!", { user: "Codi", title: "Song A" });
    assert.equal(res, "Halo Codi, lagu Song A selesai!");
});

test("NaturalResponder formats music play success", async () => {
    const responder = new NaturalResponder();
    const intent = { domain: "music", action: "play" };
    const execResult = {
        status: "success",
        data: { title: "Die With A Smile", artist: "Lady Gaga & Bruno Mars" }
    };
    const reply = await responder.generateResponse(intent, execResult, { user: { id: "123" } });
    assert.match(reply, /Die With A Smile/);
    assert.match(reply, /Lady Gaga & Bruno Mars/);
});

test("NaturalResponder enforces truthful error reporting", async () => {
    const responder = new NaturalResponder();
    const intent = { domain: "music", action: "play" };
    const execResult = {
        status: "error",
        error: "Koneksi voice channel gagal"
    };
    const reply = await responder.generateResponse(intent, execResult);
    assert.match(reply, /Operasi gagal: Koneksi voice channel gagal/);
});

test("NaturalResponder handles permission denied truthfully", async () => {
    const responder = new NaturalResponder();
    const intent = { domain: "server_templates", action: "snapshot" };
    const execResult = {
        status: "denied",
        reason: "Manage Server"
    };
    const reply = await responder.generateResponse(intent, execResult, { user: { id: "456" } });
    assert.match(reply, /Manage Server/);
    assert.match(reply, /<@456>/);
});

test("NaturalResponder handles feature disabled truthfully", async () => {
    const responder = new NaturalResponder();
    const intent = { domain: "music", action: "play" };
    const execResult = {
        status: "disabled",
        feature: "Music"
    };
    const reply = await responder.generateResponse(intent, execResult);
    assert.match(reply, /sedang dinonaktifkan/);
});

test("NaturalResponder returns natural conversational help and greeting", async () => {
    const responder = new NaturalResponder();
    const greeting = await responder.generateResponse({ domain: "conversation", action: "greeting" });
    assert.match(greeting, /Castorice/);

    const help = await responder.generateResponse({ domain: "conversation", action: "help" });
    assert.match(help, /\/menu/);
});
