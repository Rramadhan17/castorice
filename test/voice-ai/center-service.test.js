const test = require("node:test");
const assert = require("node:assert/strict");
const { PermissionFlagsBits, ChannelType } = require("discord.js");
const { createVoiceCenterService } = require("../../src/voice-ai/center-service");

const G1 = "12345678901234567";
const G2 = "12345678901234568";
const ADMIN = "22345678901234567";
const MEMBER = "22345678901234568";
const ROLE = "32345678901234567";
const CHANNEL = "42345678901234567";

function createStore() {
    const data = new Map();
    return {
        async read(guildId, collection, options) {
            const key = `${guildId}:${collection}`;
            const value = data.get(key) ?? options.defaultValue;
            assert.equal(options.validate(value, { guildId }), true);
            return structuredClone(value);
        },
        async update(guildId, collection, updater, options) {
            const key = `${guildId}:${collection}`;
            const current = structuredClone(data.get(key) ?? options.defaultValue);
            const next = await updater(current);
            assert.equal(options.validate(next, { guildId }), true);
            data.set(key, structuredClone(next));
            return structuredClone(next);
        }
    };
}

function createTimers() {
    return {
        nextId: 0,
        tasks: new Map(),
        setTimeout(fn, delay) {
            const id = ++this.nextId;
            this.tasks.set(id, { fn, delay });
            return id;
        },
        clearTimeout(id) { this.tasks.delete(id); },
        async runNext() {
            const [id, task] = this.tasks.entries().next().value || [];
            if (!task) return;
            this.tasks.delete(id);
            await task.fn();
            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setImmediate(resolve));
        }
    };
}

function cacheWith(values = []) {
    const ids = new Set(values);
    return {
        has: id => ids.has(id),
        some: predicate => [...ids].some(id => predicate({ id }))
    };
}

function makeMember(guildId, id, { roles = [], admin = false, channelId = null } = {}) {
    const member = {
        id,
        guild: { id: guildId },
        user: { bot: false },
        permissions: { has: permission => admin && permission === PermissionFlagsBits.ManageGuild },
        roles: { cache: cacheWith(roles) },
        voice: {
            channelId,
            disconnect: async () => { member.disconnected = true; }
        }
    };
    return member;
}

function fixture(options = {}) {
    const store = options.store || createStore();
    const timers = options.timers || createTimers();
    const guildId = options.guildId || G1;
    const members = new Map();
    const member = makeMember(guildId, MEMBER, { channelId: CHANNEL, roles: options.roles || [] });
    members.set(MEMBER, member);
    const permissionsFor = () => ({
        has: permission => permission === PermissionFlagsBits.MoveMembers
    });
    const guild = {
        id: guildId,
        ownerId: ADMIN,
        members: {
            me: { id: "52345678901234567", permissions: { has: () => true } },
            fetch: async id => members.get(id) || null
        },
        roles: { fetch: async id => id === ROLE ? { id, guild: { id: G1 } } : null },
        channels: {
            fetch: async id => id === CHANNEL
                ? { id, guildId, type: ChannelType.GuildVoice, permissionsFor }
                : null
        }
    };
    const actor = {
        id: ADMIN,
        guild: { id: guildId },
        permissions: { has: permission => permission === PermissionFlagsBits.ManageGuild }
    };
    const calls = [];
    const logger = { warn() {}, error() {} };
    let now = options.now ?? 1000;
    let voiceSession = { channelId: CHANNEL, identity: {} };
    const service = createVoiceCenterService({
        store,
        timers,
        clock: () => now,
        logger,
        getVoiceSession: () => voiceSession,
        disconnectVoiceSession: async request => {
            calls.push(request);
            return request.session.identity === request.identity;
        }
    });
    return {
        store, timers, members, member, guild, actor, calls, service,
        setNow(value) { now = value; },
        setVoiceSession(value) { voiceSession = value; }
    };
}

async function enableProtectedChannel(f) {
    await f.service.configureAutoKick(f.guild, f.actor, { enabled: true, gracePeriodMs: 5000 });
    await f.service.addProtectedChannel(f.guild, f.actor, CHANNEL);
}

test("Auto Kick is off by default and trusted members are not disconnected", async t => {
    const f = fixture();
    t.after(() => f.service.dispose());
    assert.equal((await f.service.getConfig(G1)).autoKick.enabled, false);
    await enableProtectedChannel(f);
    await f.service.addTrustedMember(f.guild, f.actor, MEMBER);
    await f.service.onVoiceStateUpdate(
        { guild: f.guild, member: f.member, channelId: null },
        { guild: f.guild, member: f.member, channelId: CHANNEL }
    );
    assert.equal(f.service.pendingKickCount, 0);
    assert.equal(f.member.disconnected, undefined);
});

test("Non-trusted member is disconnected after grace and eligibility is rechecked", async t => {
    const f = fixture();
    t.after(() => f.service.dispose());
    await enableProtectedChannel(f);
    await f.service.onVoiceStateUpdate(
        { guild: f.guild, member: f.member, channelId: null },
        { guild: f.guild, member: f.member, channelId: CHANNEL }
    );
    assert.equal(f.service.pendingKickCount, 1);
    await f.service.addTrustedMember(f.guild, f.actor, MEMBER);
    await f.timers.runNext();
    assert.equal(f.member.disconnected, undefined);

    await f.service.removeTrustedMember(f.guild, f.actor, MEMBER);
    await f.service.onVoiceStateUpdate(
        { guild: f.guild, member: f.member, channelId: null },
        { guild: f.guild, member: f.member, channelId: CHANNEL }
    );
    await f.timers.runNext();
    assert.equal(f.member.disconnected, true);
    assert.equal((await f.service.getConfig(G1)).activity.some(event => event.type === "auto_kick_voice_disconnected"), true);
});

test("Repeated joins do not reset grace and a member who moves is not disconnected", async t => {
    const f = fixture();
    t.after(() => f.service.dispose());
    await enableProtectedChannel(f);
    const joined = { guild: f.guild, member: f.member, channelId: CHANNEL };
    await f.service.onVoiceStateUpdate({ ...joined, channelId: null }, joined);
    const pendingTimer = f.timers.tasks.entries().next().value?.[0];
    await f.service.onVoiceStateUpdate({ ...joined, channelId: null }, joined);
    assert.equal(f.timers.tasks.size, 1);
    assert.equal(f.timers.tasks.entries().next().value?.[0], pendingTimer);
    f.member.voice.channelId = null;
    await f.timers.runNext();
    assert.equal(f.member.disconnected, undefined);
});

test("Trusted roles and unprotected channels bypass Auto Kick", async t => {
    const f = fixture({ roles: [ROLE] });
    t.after(() => f.service.dispose());
    await enableProtectedChannel(f);
    await f.service.addTrustedRole(f.guild, f.actor, ROLE);
    await f.service.onVoiceStateUpdate(
        { guild: f.guild, member: f.member, channelId: null },
        { guild: f.guild, member: f.member, channelId: CHANNEL }
    );
    assert.equal(f.service.pendingKickCount, 0);
    await f.service.removeTrustedRole(f.guild, f.actor, ROLE);
    await f.service.removeProtectedChannel(f.guild, f.actor, CHANNEL);
    await f.service.onVoiceStateUpdate(
        { guild: f.guild, member: f.member, channelId: null },
        { guild: f.guild, member: f.member, channelId: CHANNEL }
    );
    assert.equal(f.service.pendingKickCount, 0);
});

test("Configured exemption roles and missing channel Move Members permission prevent disconnect", async t => {
    const f = fixture({ roles: [ROLE] });
    t.after(() => f.service.dispose());
    await enableProtectedChannel(f);
    await f.service.addExemptRole(f.guild, f.actor, ROLE);
    await f.service.onVoiceStateUpdate(
        { guild: f.guild, member: f.member, channelId: null },
        { guild: f.guild, member: f.member, channelId: CHANNEL }
    );
    assert.equal(f.service.pendingKickCount, 0);
    await f.service.removeExemptRole(f.guild, f.actor, ROLE);

    f.guild.channels.fetch = async id => ({
        id,
        guildId: G1,
        type: ChannelType.GuildVoice,
        permissionsFor: () => ({ has: () => false })
    });
    await f.service.onVoiceStateUpdate(
        { guild: f.guild, member: f.member, channelId: null },
        { guild: f.guild, member: f.member, channelId: CHANNEL }
    );
    await f.timers.runNext();
    assert.equal(f.member.disconnected, undefined);
    assert.equal((await f.service.getConfig(G1)).activity.some(event => event.type === "auto_kick_permission_denied"), true);
});

test("Only authorized guild members can configure and data remains guild-scoped", async t => {
    const f = fixture();
    t.after(() => f.service.dispose());
    const unauthorized = { id: MEMBER, guild: { id: G1 }, permissions: { has: () => false } };
    await assert.rejects(
        f.service.configureAutoKick(f.guild, unauthorized, { enabled: true }),
        /Manage Server/
    );
    await f.service.addTrustedMember(f.guild, f.actor, MEMBER);
    const otherGuild = {
        ...f.guild,
        id: G2,
        ownerId: ADMIN,
        members: { fetch: async id => id === MEMBER ? makeMember(G2, MEMBER) : null }
    };
    assert.deepEqual(await f.service.listTrustedMembers(G2), { memberIds: [], roleIds: [] });
    await assert.rejects(f.service.addProtectedChannel(otherGuild, f.actor, CHANNEL), /server yang sama/);
});

test("Voice timer disconnects only the captured guild session", async t => {
    const f = fixture();
    t.after(() => f.service.dispose());
    const identity = {};
    f.setVoiceSession({ channelId: CHANNEL, identity });
    const timer = await f.service.setVoiceTimer(f.guild, f.actor, 60_000);
    assert.equal(timer.channelId, CHANNEL);
    f.setNow(timer.deadlineAt);
    await f.timers.runNext();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].guild.id, G1);
    assert.equal(f.calls[0].identity, identity);
    assert.equal(await f.service.getVoiceTimer(f.guild), null);
});

test("Voice timer can be extended and reset without losing its session binding", async t => {
    const f = fixture();
    t.after(() => f.service.dispose());
    const first = await f.service.setVoiceTimer(f.guild, f.actor, 120_000);
    const extended = await f.service.extendVoiceTimer(f.guild, f.actor, 60_000);
    assert.equal(extended.deadlineAt, first.deadlineAt + 60_000);
    const current = await f.service.getVoiceTimer(f.guild);
    f.setNow(current.deadlineAt - 30_000);
    const reset = await f.service.resetVoiceTimer(f.guild, f.actor);
    assert.equal(reset.remainingMs, extended.durationMs);
    assert.equal(reset.channelId, CHANNEL);
});

test("Voice timers in separate guilds do not cancel or disconnect each other", async t => {
    const store = createStore();
    const timers = createTimers();
    const first = fixture({ store, timers, guildId: G1 });
    const second = fixture({ store, timers, guildId: G2 });
    t.after(() => { first.service.dispose(); second.service.dispose(); });
    await first.service.setVoiceTimer(first.guild, first.actor, 60_000);
    await second.service.setVoiceTimer(second.guild, second.actor, 120_000);
    assert.equal(first.service.voiceTimerCount, 1);
    assert.equal(second.service.voiceTimerCount, 1);
    await first.service.cancelVoiceTimer(first.guild, first.actor);
    assert.equal(await first.service.getVoiceTimer(first.guild), null);
    assert.notEqual(await second.service.getVoiceTimer(second.guild), null);
    assert.equal(timers.tasks.size, 1);
});

test("Voice timer cancellation and a replaced session cannot disconnect a later session", async t => {
    const f = fixture();
    t.after(() => f.service.dispose());
    await f.service.setVoiceTimer(f.guild, f.actor, 60_000);
    assert.equal(await f.service.cancelVoiceTimer(f.guild, f.actor), true);
    assert.equal(f.timers.tasks.size, 0);

    const identity = {};
    f.setVoiceSession({ channelId: CHANNEL, identity });
    const timer = await f.service.setVoiceTimer(f.guild, f.actor, 60_000);
    f.setNow(timer.deadlineAt);
    f.setVoiceSession({ channelId: CHANNEL, identity: {} });
    await f.timers.runNext();
    assert.equal(f.calls.length, 0);
    assert.equal(await f.service.getVoiceTimer(f.guild), null);
});

test("Voice timer is cleared immediately when Castorice leaves the timed channel", async t => {
    const f = fixture();
    t.after(() => f.service.dispose());
    await f.service.setVoiceTimer(f.guild, f.actor, 60_000);
    const botMember = { id: f.guild.members.me.id, user: { bot: true } };
    await f.service.onVoiceStateUpdate(
        { guild: f.guild, member: botMember, channelId: CHANNEL },
        { guild: f.guild, member: botMember, channelId: null }
    );
    assert.equal(f.timers.tasks.size, 0);
    assert.equal((await f.service.getConfig(G1)).voiceTimer, null);
});

test("Persisted timer metadata is safely cancelled at startup", async t => {
    const first = fixture();
    t.after(() => first.service.dispose());
    await first.service.setVoiceTimer(first.guild, first.actor, 60_000);
    const nextProcess = fixture({ store: first.store });
    t.after(() => nextProcess.service.dispose());
    await nextProcess.service.recoverTimers(new Map([[G1, nextProcess.guild]]));
    assert.equal((await nextProcess.service.getConfig(G1)).voiceTimer, null);
    assert.equal((await nextProcess.service.getActivity(G1)).some(event => event.type === "voice_timer_cancelled_on_restart"), true);
});
