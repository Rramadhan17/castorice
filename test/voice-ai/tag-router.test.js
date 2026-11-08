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

test("Voice Manager natural controls accept common bilingual wording and number words", () => {
    assert.deepEqual(parseVoiceIntent("Can you rename room to Chill Room"), {
        type: "rename",
        name: "Chill Room"
    });
    assert.deepEqual(parseVoiceIntent("Set member limit to dua puluh lima"), {
        type: "limit",
        value: 25
    });
    assert.deepEqual(parseVoiceIntent("maksimal lima orang"), {
        type: "limit",
        value: 5
    });
    assert.deepEqual(parseVoiceIntent("lock this voice"), { type: "lock", value: true });
    assert.deepEqual(parseVoiceIntent("unlock VC"), { type: "lock", value: false });
    assert.deepEqual(parseVoiceIntent("delete this room"), { type: "delete" });
    assert.deepEqual(parseVoiceIntent("transfer ownership to @member", {
        mentions: { users: { first: () => ({ id: "32345678901234567" }) } }
    }), { type: "transfer", targetId: "32345678901234567" });
});

test("Voice channel creation parses names, privacy, and categories without changing temporary voice requests", () => {
    assert.deepEqual(parseVoiceIntent("buat voice"), {
        type: "create",
        privacy: undefined,
        name: undefined
    });
    assert.deepEqual(parseVoiceIntent("buat voice private bernama Game Room"), {
        type: "create",
        privacy: "private",
        name: "Game Room"
    });
    assert.deepEqual(parseVoiceIntent("create a new voice channel called Chill Room in category Gaming"), {
        type: "create_channel",
        name: "Chill Room",
        categoryId: null,
        categoryName: "Gaming",
        privacy: "public",
        userLimit: 0
    });
    assert.deepEqual(parseVoiceIntent("buat vc baru private bernama Mabar"), {
        type: "create_channel",
        name: "Mabar",
        categoryId: null,
        categoryName: null,
        privacy: "private",
        userLimit: 0
    });
    assert.equal(parseVoiceIntent("tolong buat channel voice dengan nama Study Hall").name, "Study Hall");
    assert.equal(parseVoiceIntent("buat voice channel baru")?.name, undefined);
});

test("Voice channel parser handles natural request forms and asks instead of inferring names", () => {
    const requests = [
        "Bikinin VC dong.",
        "Aku mau voice baru",
        "Gue butuh a new VC",
        "Bisa buat VC?",
        "Tolong setup voice room",
        "Create a new voice channel",
        "Please make me a new VC",
        "Add another voice room",
        "Buat private room buat mabar",
        "Room baru dong",
        "Gas bikin voice",
        "Buatkan voice AI"
    ];
    for (const request of requests) {
        const intent = parseVoiceIntent(request);
        assert.equal(intent?.type, "create_channel", `Expected create intent for: ${request}`);
        assert.equal(intent.name, undefined, `Expected a name clarification for: ${request}`);
    }

    assert.deepEqual(parseVoiceIntent("Bikin private voice room bernama Squad Room"), {
        type: "create_channel",
        name: "Squad Room",
        categoryId: null,
        categoryName: null,
        privacy: "private",
        userLimit: 0
    });
    assert.deepEqual(parseVoiceIntent("Make another room named Hangout"), {
        type: "create_channel",
        name: "Hangout",
        categoryId: null,
        categoryName: null,
        privacy: "public",
        userLimit: 0
    });
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

test("Voice Tag creates a regular voice channel through the existing manager service", async () => {
    let creation;
    const handle = createVoiceTagRouter({
        service: {
            createVoiceChannel: async (_guild, guildId, member, options) => {
                creation = { guildId, memberId: member.id, options };
                return { id: "32345678901234567" };
            }
        },
        stateStore: {},
        featureGuard: async () => ({ allowed: true })
    });
    const replies = [];
    const message = {
        id: "82345678901234567",
        channel: { id: "92345678901234567" },
        guild: {
            id: "12345678901234567",
            members: { fetch: async id => ({ id, guild: { id: "12345678901234567" } }) },
            channels: { cache: new Map() }
        },
        author: { id: "22345678901234567" },
        mentions: { channels: { first: () => null } },
        reply: async value => replies.push(value)
    };

    assert.equal(await handle({ message, commandText: "buat voice channel bernama Santai" }), true);
    assert.equal(creation.guildId, message.guild.id);
    assert.equal(creation.memberId, message.author.id);
    assert.equal(creation.options.name, "Santai");
    assert.equal(creation.options.requestKey, message.id);
    assert.match(replies[0].content, /berhasil dibuat/);
});

test("Voice Tag asks for a channel name instead of guessing when it is missing", async () => {
    let created;
    const handle = createVoiceTagRouter({
        service: {
            createVoiceChannel: async (_guild, _guildId, _member, options) => {
                created = options.name;
                return { id: "32345678901234567" };
            }
        },
        stateStore: {},
        featureGuard: async () => ({ allowed: true })
    });
    const replies = [];
    const message = {
        channel: { id: "92345678901234567" },
        guild: { id: "12345678901234567", members: { fetch: async id => ({ id }) } },
        author: { id: "22345678901234567" },
        reply: async value => replies.push(value)
    };

    assert.equal(await handle({ message, commandText: "buat voice channel baru" }), true);
    assert.match(replies[0].content, /nama apa/i);
    assert.equal(await handle({ message, commandText: "Chill Room" }), true);
    assert.equal(created, "Chill Room");
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
