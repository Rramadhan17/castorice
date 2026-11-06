const test = require("node:test");
const assert = require("node:assert/strict");
const { PermissionFlagsBits } = require("discord.js");
const {
    parseSecurityIntent,
    formatSecurityHistory,
    formatSecurityPolicy,
    createSecurityTagRouter
} = require("../../src/security/tag-router");

test("security tag parser recognizes audit requests", () => {
    assert.equal(parseSecurityIntent("cek keamanan").type, "audit");
    assert.equal(parseSecurityIntent("security").type, "help");
    assert.equal(parseSecurityIntent("riwayat audit keamanan").type, "history");
    assert.equal(parseSecurityIntent("kebijakan keamanan").type, "policy");
    assert.equal(parseSecurityIntent("play music").type, "unknown");
});

test("security tag router guards feature and permission before auditing", async () => {
    let audits = 0;
    const replies = [];
    const service = { audit: async () => { audits += 1; return { summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }, findings: [], automatedActions: [] }; } };
    const message = {
        guild: { id: "12345678901234567", members: { fetch: async () => ({ permissions: { has: () => false } }) } },
        author: { id: "actor" },
        reply: async value => replies.push(value)
    };
    const route = createSecurityTagRouter({ service, featureGuard: async () => ({ allowed: true }) });
    assert.equal(await route({ message, commandText: "cek keamanan" }), true);
    assert.match(replies[0].content, /Manage Server/i);
    assert.equal(audits, 0);

    const disabledRoute = createSecurityTagRouter({ service, featureGuard: async () => ({ allowed: false, reason: "Fitur mati" }) });
    assert.equal(await disabledRoute({ message, commandText: "cek keamanan" }), true);
    assert.equal(replies[1].content, "Fitur mati");
    assert.equal(audits, 0);
    assert.equal(PermissionFlagsBits.ManageGuild > 0n, true);
});

test("security tag router runs permitted audit and suppresses mentions", async () => {
    let reply;
    const route = createSecurityTagRouter({
        service: { audit: async () => ({ summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }, findings: [], automatedActions: [] }) },
        featureGuard: async () => ({ allowed: true })
    });
    const message = {
        guild: { id: "12345678901234567", members: { fetch: async () => ({ permissions: { has: bit => bit === PermissionFlagsBits.ManageGuild } }) } },
        author: { id: "actor" },
        reply: async value => { reply = value; }
    };
    assert.equal(await route({ message, commandText: "security audit" }), true);
    assert.match(reply.content, /tidak ada temuan/i);
    assert.deepEqual(reply.allowedMentions, { parse: [] });
});

test("security tag router lists existing reports without starting another audit", async () => {
    let reply;
    let listCalls = 0;
    const report = {
        id: "report-1",
        scannedAt: "2026-11-06T12:00:00.000Z",
        summary: { critical: 1, high: 2, medium: 3, low: 4, total: 10 }
    };
    const route = createSecurityTagRouter({
        service: {
            audit: async () => { assert.fail("history must not initiate an audit"); },
            listReports: async guildId => {
                assert.equal(guildId, "12345678901234567");
                listCalls += 1;
                return [report];
            }
        },
        featureGuard: async () => ({ allowed: true })
    });
    const message = {
        guild: {
            id: "12345678901234567",
            members: { fetch: async () => ({ permissions: { has: () => true } }) }
        },
        author: { id: "actor" },
        reply: async payload => { reply = payload; }
    };

    assert.equal(await route({ message, commandText: "riwayat audit" }), true);
    assert.equal(listCalls, 1);
    assert.match(reply.content, /1 critical, 2 high, 3 medium, 4 low/);
    assert.deepEqual(reply.allowedMentions, { parse: [] });
    assert.equal(formatSecurityHistory([]), "Belum ada riwayat audit keamanan untuk server ini.");
});

test("security AI Tag reports the alert-only policy and links to guarded Dashboard configuration", async () => {
    let reply;
    const policy = {
        enabled: true,
        thresholdMinutes: 20,
        maxObservationGapMinutes: 5,
        excludedBotIds: ["32345678901234567"]
    };
    const route = createSecurityTagRouter({
        service: {
            audit: async () => assert.fail("policy query must not start an audit"),
            getPolicy: async () => policy
        },
        featureGuard: async () => ({ allowed: true })
    });
    const message = {
        guild: {
            id: "12345678901234567",
            members: { fetch: async () => ({ permissions: { has: () => true } }) }
        },
        author: { id: "52345678901234567" },
        reply: async payload => { reply = payload; }
    };

    assert.equal(await route({ message, commandText: "kebijakan keamanan" }), true);
    assert.match(reply.content, /alert-only: aktif/i);
    assert.match(reply.content, /20 menit/);
    assert.match(reply.content, /tidak ada kick\/ban otomatis/i);
    assert.equal(reply.components[0].components[0].data.custom_id, "castorice:security_policy");
    assert.match(formatSecurityPolicy(policy), /32345678901234567/);
});
