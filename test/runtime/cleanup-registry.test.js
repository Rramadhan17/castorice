const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Events } = require("discord.js");
const { createCleanupRegistry } = require("../../src/runtime/cleanup-registry");
const registerVoiceGreeter = require("../../src/voice-ai/greeter");
const registerVoiceManager = require("../../src/voice-ai/register");
const { registerSecurityMonitor } = require("../../src/security/monitor");
const { registerVoiceCenterEvents } = require("../../src/voice-ai/center-events");
const registerInteractionHandler = require("../../src/events/interactionCreate");
const {
    createHealthServer,
    createRuntimeLifecycle
} = require("../../src/http/health-server");

const quietLogger = { info() {}, warn() {}, error() {} };

function registerServices(client, registry, { failSecurityCleanup = false } = {}) {
    const calls = [];
    const add = (label, dispose) => registry.add(label, async () => {
        calls.push(label);
        await dispose();
    });

    add("Music Manager", async () => {});

    const disposeGreeter = registerVoiceGreeter(client, { ttsProvider: null });
    add("Voice Greeter", disposeGreeter);

    const voiceManager = registerVoiceManager(client, {
        service: {},
        stateStore: {},
        logger: quietLogger
    });
    add("Voice Manager", () => voiceManager.dispose());

    const securityMonitor = registerSecurityMonitor(client, {
        securityAssistant: {
            recordMonitorEvent: async () => {},
            getSpamPolicy: async () => ({ enabled: false })
        },
        environment: {},
        logger: quietLogger
    });
    add("Security Monitor", async () => {
        securityMonitor.close();
        if (failSecurityCleanup) throw new Error("test cleanup failure");
    });

    let voiceCenterDisposals = 0;
    const voiceCenterEvents = registerVoiceCenterEvents(client, {
        service: {
            async onVoiceStateUpdate() {},
            async recoverTimers() {},
            dispose() { voiceCenterDisposals += 1; }
        },
        logger: quietLogger
    });
    add("Voice Center", () => voiceCenterEvents.dispose());

    return { calls, voiceCenterDisposals: () => voiceCenterDisposals };
}

test("registered service disposer APIs run once in reverse order despite a cleanup failure", async () => {
    const client = new EventEmitter();
    const registry = createCleanupRegistry({ logger: quietLogger });
    const services = registerServices(client, registry, { failSecurityCleanup: true });

    const firstRun = registry.run();
    assert.equal(registry.run(), firstRun);
    await assert.rejects(firstRun, AggregateError);
    await assert.rejects(registry.run(), AggregateError);

    assert.deepEqual(services.calls, [
        "Voice Center",
        "Security Monitor",
        "Voice Manager",
        "Voice Greeter",
        "Music Manager"
    ]);
    assert.equal(services.voiceCenterDisposals(), 1);
    assert.equal(client.listenerCount(Events.VoiceStateUpdate), 0);
    assert.equal(client.listenerCount(Events.ClientReady), 0);
    assert.equal(client.listenerCount(Events.InteractionCreate), 0);
    assert.equal(client.listenerCount(Events.MessageCreate), 0);
});

test("partial service initialization can clean every disposer registered so far", async () => {
    const client = new EventEmitter();
    const registry = createCleanupRegistry({ logger: quietLogger });
    registry.add("Music Manager", async () => {});

    const disposeGreeter = registerVoiceGreeter(client, { ttsProvider: null });
    registry.add("Voice Greeter", disposeGreeter);
    const voiceManager = registerVoiceManager(client, {
        service: {},
        stateStore: {},
        logger: quietLogger
    });
    registry.add("Voice Manager", () => voiceManager.dispose());

    try {
        throw new Error("simulated later initialization failure");
    } catch {
        await registry.run();
    }

    assert.equal(client.listenerCount(Events.VoiceStateUpdate), 0);
    assert.equal(client.listenerCount(Events.ClientReady), 0);
    assert.equal(client.listenerCount(Events.InteractionCreate), 0);
});

test("cleanup continues if reporting a disposer failure also throws", async () => {
    const calls = [];
    const registry = createCleanupRegistry({
        logger: { error() { throw new Error("logger failure"); } }
    });
    registry.add("later", async () => { calls.push("later"); });
    registry.add("failing", async () => { throw new Error("cleanup failure"); });

    await assert.rejects(registry.run(), AggregateError);
    assert.deepEqual(calls, ["later"]);
});

test("Voice Manager removes event listeners if interaction registration fails", () => {
    const client = new EventEmitter();
    const originalOn = client.on.bind(client);
    client.on = (event, listener) => {
        if (event === Events.InteractionCreate) throw new Error("registration failed");
        return originalOn(event, listener);
    };

    assert.throws(() => registerVoiceManager(client, {
        service: {},
        stateStore: {},
        logger: quietLogger
    }), /registration failed/);
    assert.equal(client.listenerCount(Events.VoiceStateUpdate), 0);
    assert.equal(client.listenerCount(Events.ClientReady), 0);
});

test("interaction handler disposer removes both Discord listeners idempotently", () => {
    const client = new EventEmitter();
    client.user = { id: "123456789012345678" };
    const dispose = registerInteractionHandler(client, {
        aiConversationService: {
            reset() {},
            async respond() { return { text: "unused" }; }
        },
        globalAISettings: {
            async getSettings() { return { enabled: false }; }
        },
        logger: quietLogger
    });

    assert.equal(client.listenerCount(Events.InteractionCreate), 1);
    assert.equal(client.listenerCount(Events.MessageCreate), 1);
    dispose();
    dispose();
    assert.equal(client.listenerCount(Events.InteractionCreate), 0);
    assert.equal(client.listenerCount(Events.MessageCreate), 0);
});

test("runtime shutdown closes HTTP and Discord after all registered service cleanup", async () => {
    const client = {
        destroyed: 0,
        async login() {},
        async destroy() { this.destroyed += 1; }
    };
    const server = createHealthServer();
    const processRef = new EventEmitter();
    processRef.exitCode = 0;
    const registry = createCleanupRegistry({ logger: quietLogger });
    const services = registerServices(new EventEmitter(), registry);
    const lifecycle = createRuntimeLifecycle({
        server,
        client,
        token: "test-token",
        port: 0,
        host: "127.0.0.1",
        cleanup: () => registry.run(),
        logger: quietLogger,
        processRef
    });

    await lifecycle.start();
    assert.equal(server.listening, true);
    await Promise.all([lifecycle.shutdown(), lifecycle.shutdown()]);

    assert.equal(server.listening, false);
    assert.equal(client.destroyed, 1);
    assert.equal(processRef.exitCode, 0);
    assert.deepEqual(services.calls, [
        "Voice Center",
        "Security Monitor",
        "Voice Manager",
        "Voice Greeter",
        "Music Manager"
    ]);
});
