const test = require("node:test");
const assert = require("node:assert/strict");
const { PermissionFlagsBits } = require("discord.js");
const { parseServerTemplateIntent, formatTemplateList, createServerTemplateTagRouter } = require("../../src/server-templates/tag-router");

test("Server Template tag parser maps create, rebuild and clone to guarded preview intents", () => {
    assert.deepEqual(parseServerTemplateIntent("daftar template"), { type: "list" });
    assert.deepEqual(parseServerTemplateIntent("preview server template"), { type: "preview", mode: "smart_merge" });
    assert.deepEqual(parseServerTemplateIntent("create template"), { type: "preview", mode: "create" });
    assert.deepEqual(parseServerTemplateIntent("rebuild template"), { type: "preview", mode: "rebuild" });
    assert.deepEqual(parseServerTemplateIntent("clone template"), { type: "preview", mode: "clone" });
    assert.deepEqual(parseServerTemplateIntent("preview bangun ulang template"), { type: "preview", mode: "rebuild" });
    assert.deepEqual(parseServerTemplateIntent("save server snapshot Community"), { type: "snapshot", name: "Community" });
    assert.equal(parseServerTemplateIntent("template").type, "help");
    assert.equal(parseServerTemplateIntent("buat template gaming dengan kategori voice").type, "unknown");
});

test("Server Template tag router lists guild data through the service", async () => {
    let reply;
    const router = createServerTemplateTagRouter({
        service: {
            async list(guildId) {
                assert.equal(guildId, "12345678901234567");
                return [{ id: "template-1", name: "Community", roleCount: 2, channelCount: 4 }];
            },
            async create() { assert.fail("list intent must not create a snapshot"); }
        },
        featureGuard: async () => ({ allowed: true })
    });
    const message = { guild: { id: "12345678901234567" }, reply: async value => { reply = value; } };
    assert.equal(await router({ message, commandText: "daftar template" }), true);
    assert.match(reply.content, /Community.*2 role, 4 channel/);
    assert.deepEqual(reply.allowedMentions, { parse: [] });
    assert.equal(formatTemplateList([]), "Belum ada template tersimpan di server ini.");
});

test("Server Template tag router applies Feature Guard and Manage Server before snapshot creation", async () => {
    let creations = 0;
    const replies = [];
    const service = { list: async () => [], create: async () => { creations += 1; return { name: "Community", roles: [], channels: [], id: "template-1" }; } };
    const message = {
        guild: { id: "12345678901234567", members: { fetch: async () => ({ permissions: { has: () => false } }) } },
        author: { id: "23456789012345678" },
        reply: async value => replies.push(value)
    };
    const disabled = createServerTemplateTagRouter({ service, featureGuard: async () => ({ allowed: false, reason: "Fitur mati" }) });
    await disabled({ message, commandText: "simpan snapshot Community" });
    assert.equal(replies[0].content, "Fitur mati");
    const denied = createServerTemplateTagRouter({ service, featureGuard: async () => ({ allowed: true }) });
    await denied({ message, commandText: "simpan snapshot Community" });
    assert.match(replies[1].content, /Manage Server/i);
    assert.equal(creations, 0);
    assert.equal(PermissionFlagsBits.ManageGuild > 0n, true);
});

test("Server Template tag preview action is feature- and permission-gated", async () => {
    const replies = [];
    let memberFetches = 0;
    const service = {
        async list() { return []; },
        async create() { assert.fail("preview must not mutate templates"); }
    };
    const message = {
        guild: {
            id: "12345678901234567",
            members: {
                async fetch(id) {
                    memberFetches += 1;
                    return { id, permissions: { has: flag => flag === PermissionFlagsBits.ManageGuild } };
                }
            }
        },
        author: { id: "23456789012345678" },
        reply: async value => replies.push(value)
    };
    const disabled = createServerTemplateTagRouter({
        service,
        featureGuard: async () => ({ allowed: false, reason: "Fitur mati" })
    });
    await disabled({ message, commandText: "preview template" });
    assert.equal(replies[0].content, "Fitur mati");
    assert.equal(memberFetches, 0);

    const enabled = createServerTemplateTagRouter({
        service,
        featureGuard: async () => ({ allowed: true })
    });
    await enabled({ message, commandText: "preview template" });
    assert.equal(memberFetches, 1);
    assert.match(replies[1].content, /hanya diterapkan setelah preview dan konfirmasi/i);
    assert.equal(replies[1].components[0].components[0].data.custom_id, "castorice:template_preview_open:smart_merge");
});

test("Server Template tag preview selects the requested apply mode without bypassing confirmation", async () => {
    const replies = [];
    const router = createServerTemplateTagRouter({
        service: { async list() { return []; }, async create() { assert.fail("preview must not create a snapshot"); } },
        featureGuard: async () => ({ allowed: true })
    });
    const guild = {
        id: "12345678901234567",
        members: { fetch: async id => ({ id, permissions: { has: () => true } }) }
    };
    const message = { guild, author: { id: "23456789012345678" }, reply: async payload => replies.push(payload) };

    await router({ message, commandText: "rebuild template" });
    assert.equal(replies[0].components[0].components[0].data.custom_id, "castorice:template_preview_open:rebuild");
    assert.match(replies[0].content, /mode \*\*rebuild\*\*/i);
    assert.match(replies[0].content, /preview dan konfirmasi/);
});

test("Server Template tag router persists an explicitly requested snapshot and handles permission mismatch", async () => {
    const replies = [];
    let called;
    const router = createServerTemplateTagRouter({
        service: { list: async () => [], create: async (...args) => {
            called = args;
            return { name: "Community", roles: [{}, {}], channels: [{}], id: "template-1" };
        } },
        featureGuard: async () => ({ allowed: true })
    });
    const guild = {
        id: "12345678901234567",
        members: { fetch: async id => ({ id, guild: { id: "12345678901234567" }, permissions: { has: flag => flag === PermissionFlagsBits.ManageGuild } }) }
    };
    const message = { guild, author: { id: "23456789012345678" }, reply: async value => replies.push(value) };
    await router({ message, commandText: "simpan snapshot Community" });
    assert.equal(called[0], guild);
    assert.equal(called[2], "Community");
    assert.match(replies[0].content, /2 role dan 1 channel dicatat/);
    assert.match(replies[0].content, /belum diubah/);
});
