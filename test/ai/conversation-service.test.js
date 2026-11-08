const test = require("node:test");
const assert = require("node:assert/strict");
const {
    AIConversationError,
    createAIConversationService
} = require("../../src/ai/conversation-service");

test("conversation service isolates context per guild and user and supports reset", async () => {
    const requests = [];
    const service = createAIConversationService({
        provider: {
            generate: async messages => {
                requests.push(messages);
                return {
                    text: `reply-${requests.length}`,
                    usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 }
                };
            }
        },
        minIntervalMs: 0
    });

    await service.respond({ guildId: "guild-a", userId: "user-a", text: "first" });
    await service.respond({ guildId: "guild-a", userId: "user-a", text: "second" });
    await service.respond({ guildId: "guild-b", userId: "user-a", text: "separate" });

    assert.match(requests[0][0].content, /Indonesian, English, slang, abbreviations, and code-switching/);
    assert.match(requests[0][0].content, /general-purpose/);
    assert.match(requests[0][0].content, /do not treat every message as a request to change Discord/);
    assert.deepEqual(requests[1].slice(1).map(message => message.content), [
        "first",
        "reply-1",
        "second"
    ]);
    assert.deepEqual(requests[2].slice(1).map(message => message.content), ["separate"]);

    service.reset({ guildId: "guild-a", userId: "user-a" });
    await service.respond({ guildId: "guild-a", userId: "user-a", text: "fresh" });
    assert.deepEqual(requests[3].slice(1).map(message => message.content), ["fresh"]);
    assert.deepEqual(service.getUsage({ guildId: "guild-a", userId: "user-a" }), {
        promptTokens: 3,
        completionTokens: 2,
        totalTokens: 5
    });
});

test("public conversation context is shared per guild and channel, but isolated across channels", async () => {
    const requests = [];
    const service = createAIConversationService({
        provider: {
            generate: async messages => {
                requests.push(messages);
                return { text: `reply-${requests.length}` };
            }
        },
        minIntervalMs: 0
    });

    await service.respond({
        guildId: "guild-a",
        channelId: "channel-a",
        userId: "user-a",
        text: "first public message"
    });
    await service.respond({
        guildId: "guild-a",
        channelId: "channel-a",
        userId: "user-b",
        text: "follow-up from another member"
    });
    await service.respond({
        guildId: "guild-a",
        channelId: "channel-b",
        userId: "user-b",
        text: "separate channel"
    });
    await service.respond({
        guildId: "guild-b",
        channelId: "channel-a",
        userId: "user-b",
        text: "separate guild"
    });

    assert.deepEqual(requests[1].slice(1).map(message => message.content), [
        "first public message",
        "reply-1",
        "follow-up from another member"
    ]);
    assert.deepEqual(requests[2].slice(1).map(message => message.content), ["separate channel"]);
    assert.deepEqual(requests[3].slice(1).map(message => message.content), ["separate guild"]);

    service.reset({ guildId: "guild-a", channelId: "channel-a", userId: "user-c" });
    await service.respond({
        guildId: "guild-a",
        channelId: "channel-a",
        userId: "user-c",
        text: "fresh channel context"
    });
    assert.deepEqual(requests[4].slice(1).map(message => message.content), ["fresh channel context"]);
});

test("shared public history keeps rate limits per member", async () => {
    let now = 1_000;
    const service = createAIConversationService({
        provider: { generate: async () => ({ text: "ok" }) },
        clock: () => now,
        minIntervalMs: 10
    });
    const common = { guildId: "guild-a", channelId: "channel-a" };
    await service.respond({ ...common, userId: "user-a", text: "one" });
    await service.respond({ ...common, userId: "user-b", text: "two" });
    await assert.rejects(
        service.respond({ ...common, userId: "user-a", text: "three" }),
        error => error.code === "rate_limited"
    );
    now += 10;
    await service.respond({ ...common, userId: "user-a", text: "four" });
});

test("conversation service enforces rate limits, input bounds, and expiration", async () => {
    let now = 1_000;
    const service = createAIConversationService({
        provider: { generate: async () => ({ text: "ok" }) },
        clock: () => now,
        ttlMs: 100,
        minIntervalMs: 10
    });
    const request = { guildId: "guild-a", userId: "user-a", text: "hello" };

    await service.respond(request);
    await assert.rejects(service.respond(request), error => error.code === "rate_limited");
    now += 10;
    await service.respond(request);
    assert.equal(service.getSessionCount(), 1);
    now += 100;
    assert.equal(service.getSessionCount(), 0);

    await assert.rejects(
        service.respond({ ...request, text: "x".repeat(4_001) }),
        error => error instanceof AIConversationError && error.code === "input_too_long"
    );
});

test("conversation service clearly reports a missing provider", async () => {
    const service = createAIConversationService();
    await assert.rejects(
        service.respond({ guildId: "guild-a", userId: "user-a", text: "hello" }),
        error => error.code === "not_configured" && /Gemini.*GEMINI_API_KEY/.test(error.message)
    );
});

test("reset cancels in-flight generation and prevents the deleted context being restored", async () => {
    let requestSignal;
    let releaseProvider;
    const service = createAIConversationService({
        provider: {
            generate: async (_messages, { signal }) => {
                requestSignal = signal;
                await new Promise(resolve => { releaseProvider = resolve; });
                return { text: "late answer" };
            }
        },
        minIntervalMs: 0
    });
    const request = { guildId: "guild-a", userId: "user-a", text: "private question" };
    const pending = service.respond(request);
    await new Promise(resolve => setImmediate(resolve));

    service.reset({ guildId: request.guildId, userId: request.userId });
    assert.equal(requestSignal.aborted, true);
    releaseProvider();
    await assert.rejects(pending, error => error.code === "cancelled");
    assert.equal(service.getSessionCount(), 0);
    assert.deepEqual(service.getUsage({ guildId: request.guildId, userId: request.userId }), {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
    });
});
