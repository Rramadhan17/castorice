const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { registerVoiceManagerEvents } = require("../../src/voice-ai/manager-events");

const G = "12345678901234567", U = "22345678901234567", C = "32345678901234567";

function fixture() {
    const client = new EventEmitter();
    const timers = {
        next: 1, tasks: new Map(),
        setTimeout(fn, delay) { const id = this.next++; this.tasks.set(id, { fn, delay }); return id; },
        clearTimeout(id) { this.tasks.delete(id); },
        async run(id) { const task = this.tasks.get(id); this.tasks.delete(id); if (task) await task.fn(); }
    };
    const voice = { channelId: C, status: "deletion_pending", pendingDeletionAt: Date.now() };
    const store = {
        getVoiceState: async (_g, id) => id === C ? { ...voice } : null,
        getGuildState: async () => ({ temporaryVoices: { [C]: { ...voice } } })
    };
    const calls = [];
    const service = {
        onMemberLeave: async (...args) => (calls.push(["leave", ...args.slice(1)]), { status: "deletion_pending", pendingDeletionAt: Date.now() }),
        onMemberJoin: async (...args) => (calls.push(["join", ...args.slice(1)]), { status: "active" }),
        cleanupDue: async (...args) => (calls.push(["cleanup", ...args.slice(1)]), true)
    };
    const errors = [];
    const registration = registerVoiceManagerEvents(client, { service, stateStore: store, timers, logger: { error: (...args) => errors.push(args) } });
    const guild = { id: G };
    const member = { id: U, user: { bot: false } };
    return { client, timers, voice, store, service, calls, errors, registration, guild, member };
}

test("tracks voice moves for registered channels and ignores bot transitions", async () => {
    const f = fixture();
    await f.registration.onVoiceStateUpdate({ guild: f.guild, member: f.member, channelId: C }, { guild: f.guild, member: f.member, channelId: null });
    assert.equal(f.calls[0][0], "leave");
    assert.equal(f.registration.scheduledCount(), 1);
    const bot = { id: U, user: { bot: true } };
    await f.registration.onVoiceStateUpdate({ guild: f.guild, member: bot, channelId: C }, { guild: f.guild, member: bot, channelId: null });
    assert.equal(f.calls.length, 1);
    await f.registration.onVoiceStateUpdate({ guild: f.guild, member: f.member, channelId: null }, { guild: f.guild, member: f.member, channelId: C });
    assert.equal(f.calls.at(-1)[0], "join");
    assert.equal(f.registration.scheduledCount(), 0);
});

test("recovers persisted deletion deadlines at ClientReady and runs cleanup", async () => {
    const f = fixture();
    f.client.guilds = { cache: new Map([[G, f.guild]]) };
    await f.registration.onReady();
    assert.equal(f.timers.tasks.size, 1);
    const id = [...f.timers.tasks.keys()][0];
    await f.timers.run(id);
    assert.equal(f.calls.at(-1)[0], "cleanup");
    assert.equal(f.registration.scheduledCount(), 0);
});

test("logs service failures without throwing from event listener and dispose clears timers", async () => {
    const f = fixture();
    f.service.onMemberLeave = async () => { throw new Error("failure"); };
    await f.registration.onVoiceStateUpdate({ guild: f.guild, member: f.member, channelId: C }, { guild: f.guild, member: f.member, channelId: null });
    assert.equal(f.errors.length, 1);
    f.registration.dispose();
    assert.equal(f.registration.scheduledCount(), 0);
    assert.equal(f.client.listenerCount("voiceStateUpdate"), 0);
});
