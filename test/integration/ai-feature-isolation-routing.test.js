const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { Events, PermissionFlagsBits } = require("discord.js");
const { setFeatureEnabled } = require("../../src/features/feature-manager");
const registerInteractionHandler = require("../../src/events/interactionCreate");

const clientId = "123456789012345678";
const userId = "234567890123456789";
let guildCounter = 0;

function createGuildId() {
    guildCounter += 1;
    return `${Date.now()}${String(guildCounter).padStart(6, "0")}`;
}

function createHarness(dependencies = {}) {
    const handlers = new Map();
    const client = {
        user: { id: clientId },
        on: (event, handler) => handlers.set(event, handler)
    };
    registerInteractionHandler(client, {
        globalAISettings: {
            getSettings: async () => ({
                enabled: true,
                providerOrder: null,
                failoverEnabled: null
            })
        },
        ...dependencies
    });
    return handlers;
}

function createMessage(guildId, content, options = {}) {
    const replies = [];
    const message = {
        author: { id: userId, bot: false },
        guild: options.guild || { id: guildId },
        content,
        mentions: { users: { has: () => content.includes(clientId) } },
        reply: async payload => {
            replies.push(payload);
            return options.replyResult || {
                id: `reply-${replies.length}`,
                edit: async nextPayload => replies.push(nextPayload)
            };
        },
        channel: { send: async payload => replies.push(payload) }
    };
    return { message, replies };
}

function replyText(payload) {
    return typeof payload === "string" ? payload : payload?.content || "";
}

function addCleanup(t, guildId) {
    const guildDirectory = path.resolve(__dirname, "../../data/guilds", guildId);
    t.after(async () => fs.rm(guildDirectory, { recursive: true, force: true }));
}

test("all Castorice trigger forms reach AI Chat only when the guild opted in", async t => {
    const guildId = createGuildId();
    addCleanup(t, guildId);
    await setFeatureEnabled(guildId, "ai_chat", true);
    const calls = [];
    const handlers = createHarness({
        aiConversationService: {
            respond: async request => {
                calls.push(request);
                return { text: "Jawaban AI" };
            },
            reset: () => true
        }
    });
    const inputs = [
        `<@${clientId}> jelaskan gravitasi`,
        "Castorice: jelaskan gravitasi",
        "Castorice, jelaskan gravitasi",
        "Hey Castorice, jelaskan gravitasi"
    ];

    for (const input of inputs) {
        const { message, replies } = createMessage(guildId, input);
        await handlers.get(Events.MessageCreate)(message);
        assert.equal(replies.length, 1);
        assert.equal(replyText(replies[0]), "Jawaban AI");
    }

    assert.equal(calls.length, inputs.length);
    assert.ok(calls.every(call => call.text === "jelaskan gravitasi"));
});

test("AI Chat OFF is reported honestly and does not call the provider", async t => {
    const guildId = createGuildId();
    addCleanup(t, guildId);
    await setFeatureEnabled(guildId, "ai_chat", false);
    let providerCalled = false;
    const handlers = createHarness({
        aiConversationService: {
            respond: async () => {
                providerCalled = true;
                return { text: "unexpected" };
            },
            reset: () => true
        }
    });
    const { message, replies } = createMessage(guildId, "Castorice: jelaskan gravitasi");

    await handlers.get(Events.MessageCreate)(message);

    assert.equal(providerCalled, false);
    assert.match(replyText(replies[0]), /dinonaktifkan/);
});

test("provider failures are mapped safely without logging credential-bearing errors", async t => {
    const guildId = createGuildId();
    addCleanup(t, guildId);
    await setFeatureEnabled(guildId, "ai_chat", true);
    const logged = [];
    const secret = "test-only-secret-marker";
    const handlers = createHarness({
        aiConversationService: {
            respond: async () => {
                const error = new Error(secret);
                error.code = "timeout";
                throw error;
            },
            reset: () => true
        },
        logger: { error: (...args) => logged.push(args) }
    });
    const { message, replies } = createMessage(guildId, "Castorice: jawab singkat");

    await handlers.get(Events.MessageCreate)(message);

    assert.match(replyText(replies[0]), /tidak merespons tepat waktu/);
    assert.deepEqual(logged, [["[Gemini AI Error]", {
        provider: "gemini",
        operation: "respond",
        statusCode: null,
        category: "timeout"
    }]]);
    assert.equal(JSON.stringify(logged).includes(secret), false);
});

test("AI Chat reports provider and model-discovery failure categories without raw details", async t => {
    const cases = [
        ["authentication_failed", /menolak autentikasi/],
        ["rate_limited", /sedang membatasi permintaan/],
        ["model_discovery_failed", /Daftar model Gemini gagal dimuat/],
        ["model_not_compatible", /tidak tersedia atau tidak kompatibel/],
        ["invalid_response", /respons yang tidak dapat digunakan/],
        ["unavailable", /tidak dapat dijangkau/]
    ];

    for (const [code, expectedMessage] of cases) {
        const guildId = createGuildId();
        addCleanup(t, guildId);
        await setFeatureEnabled(guildId, "ai_chat", true);
        const logged = [];
        const handlers = createHarness({
            aiConversationService: {
                respond: async () => {
                    const error = new Error(`sensitive-${code}-detail`);
                    error.code = code;
                    throw error;
                },
                reset: () => true
            },
            logger: { error: (...args) => logged.push(args) }
        });
        const { message, replies } = createMessage(guildId, "Castorice: jawab");

        await handlers.get(Events.MessageCreate)(message);

        assert.match(replyText(replies[0]), expectedMessage);
        assert.equal(JSON.stringify(logged).includes(`sensitive-${code}-detail`), false);
    }
});

test("empty or malformed AI responses never produce a success-shaped reply", async t => {
    const guildId = createGuildId();
    addCleanup(t, guildId);
    await setFeatureEnabled(guildId, "ai_chat", true);
    const handlers = createHarness({
        aiConversationService: {
            respond: async () => ({ text: "  " }),
            reset: () => true
        }
    });
    const { message, replies } = createMessage(guildId, "Castorice: jawab");

    await handlers.get(Events.MessageCreate)(message);

    assert.equal(replies.length, 1);
    assert.match(replyText(replies[0]), /respons yang tidak dapat digunakan/);
});

test("invalid provider configuration does not prevent event registration or other routing", async t => {
    const guildId = createGuildId();
    addCleanup(t, guildId);
    await setFeatureEnabled(guildId, "ai_chat", true);
    const logged = [];
    const handlers = createHarness({
        environment: { GEMINI_API_KEY: "test-only-gemini-key", AI_TIMEOUT_MS: "invalid" },
        logger: { error: (...args) => logged.push(args) }
    });

    assert.equal(handlers.has(Events.MessageCreate), true);
    assert.equal(handlers.has(Events.InteractionCreate), true);
    assert.deepEqual(logged, [["[Gemini AI Configuration Error]", "invalid_configuration"]]);
    const { message, replies } = createMessage(guildId, "Castorice: jawab");
    await handlers.get(Events.MessageCreate)(message);
    assert.match(replyText(replies[0]), /Konfigurasi Gemini tidak valid/);
});

test("Auto Kick and manual kick intents never execute or fall back to AI", async t => {
    const guildId = createGuildId();
    addCleanup(t, guildId);
    await setFeatureEnabled(guildId, "ai_chat", true);
    let aiCalls = 0;
    let kickCalls = 0;
    const handlers = createHarness({
        aiConversationService: {
            respond: async () => {
                aiCalls += 1;
                return { text: "unexpected" };
            },
            reset: () => true
        },
        securityAssistant: {
            audit: async () => {
                kickCalls += 1;
                return { summary: {}, findings: [] };
            }
        }
    });

    for (const command of ["kick bot offline", "kick member 456", "audit bot offline"]) {
        const { message, replies } = createMessage(guildId, `Castorice: ${command}`);
        await handlers.get(Events.MessageCreate)(message);
        assert.equal(replies.length, 1);
        assert.match(replyText(replies[0]), /belum tersedia|Tidak ada tindakan/);
    }

    assert.equal(aiCalls, 0);
    assert.equal(kickCalls, 0);
});

test("AI Chat OFF does not intercept active Music, Translator, Voice, Security, or Templates routes", async t => {
    const guildId = createGuildId();
    addCleanup(t, guildId);
    for (const featureId of ["ai_chat", "music", "translator"]) {
        await setFeatureEnabled(guildId, featureId, featureId !== "ai_chat");
    }
    let aiCalls = 0;
    let musicSearches = 0;
    let translations = 0;
    let voiceCreations = 0;
    let securityAudits = 0;
    let templateLists = 0;
    const handlers = createHarness({
        aiConversationService: {
            respond: async () => {
                aiCalls += 1;
                return { text: "unexpected" };
            },
            reset: () => true
        },
        featureGuard: async () => ({ allowed: true }),
        radioDiscovery: {
            search: async () => {
                musicSearches += 1;
                return [];
            }
        },
        translatorFactory: () => ({
            translate: async () => {
                translations += 1;
                return { translatedText: "halo", source: "en", target: "id" };
            }
        }),
        voiceManager: {
            createTemporaryVoice: async () => {
                voiceCreations += 1;
                return { id: "345678901234567890" };
            }
        },
        voiceStateStore: {},
        securityAssistant: {
            audit: async () => {
                securityAudits += 1;
                return {
                    summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
                    findings: [],
                    botPresence: null
                };
            }
        },
        serverTemplateService: {
            list: async () => {
                templateLists += 1;
                return [];
            },
            create: async () => ({}),
            preview: async () => ({}),
            get: async () => ({})
        }
    });
    const guild = {
        id: guildId,
        members: {
            fetch: async id => ({
                id,
                voice: { channel: { id: "456789012345678901" } },
                permissions: { has: permission => permission === PermissionFlagsBits.ManageGuild }
            })
        }
    };
    const commands = [
        "cari radio jazz",
        "terjemahkan hello ke id",
        "buat voice private bernama Team Room",
        "cek keamanan",
        "daftar template"
    ];

    for (const command of commands) {
        const { message, replies } = createMessage(guildId, `Castorice: ${command}`, { guild });
        await handlers.get(Events.MessageCreate)(message);
        assert.ok(replies.length > 0, `expected a response for ${command}`);
    }

    assert.equal(aiCalls, 0);
    assert.equal(musicSearches, 1);
    assert.equal(translations, 1);
    assert.equal(voiceCreations, 1);
    assert.equal(securityAudits, 1);
    assert.equal(templateLists, 1);
});

test("Discord reply failures are isolated and logged without exposing raw errors", async t => {
    const guildId = createGuildId();
    addCleanup(t, guildId);
    await setFeatureEnabled(guildId, "ai_chat", true);
    const logged = [];
    const handlers = createHarness({
        aiConversationService: {
            respond: async () => ({ text: "Jawaban" }),
            reset: () => true
        },
        logger: { error: (...args) => logged.push(args) }
    });
    const { message } = createMessage(guildId, "Castorice: jawab", {
        replyResult: null
    });
    message.reply = async () => {
        throw new Error("sensitive discord error");
    };

    await assert.doesNotReject(handlers.get(Events.MessageCreate)(message));
    assert.deepEqual(logged, [["[AI Chat Discord Reply Error]", "reply_failed"]]);
    assert.equal(JSON.stringify(logged).includes("sensitive discord error"), false);
});
