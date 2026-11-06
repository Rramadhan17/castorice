const test = require("node:test");
const assert = require("node:assert/strict");
const { createVoiceManager } = require("../../src/voice-ai/manager-service");

const G = "12345678901234567", O = "22345678901234567", T = "32345678901234567", C = "42345678901234567";
const perms = { has: () => true };

function fixture() {
    let state = { settings: { defaultPrivacy: "public", defaultUserLimit: 0, categoryMode: "both", cleanupDelaySeconds: 10, autoOwnershipTransfer: true, maxChannelsPerMember: 1, temporaryCategoryId: null }, temporaryVoices: {} };
    const store = {
        getGuildState: async () => structuredClone(state),
        getVoiceState: async (_g, id) => structuredClone(state.temporaryVoices[id] || null),
        createVoiceRecord: async (_g, r) => (state.temporaryVoices[r.channelId] = { ...r, status: "active", pendingDeletionAt: null, invitedUserIds: [] }),
        updateVoiceRecord: async (_g, id, u) => Object.assign(state.temporaryVoices[id], u),
        updateMemberState: async (_g, id, m, joinedAt) => { const r = state.temporaryVoices[id]; if (joinedAt == null) delete r.members[m]; else r.members[m] = { joinedAt }; return r; },
        transferOwnership: async (_g, id, ownerId) => (state.temporaryVoices[id].ownerId = ownerId, state.temporaryVoices[id]),
        scheduleDeletion: async (_g, id, at) => Object.assign(state.temporaryVoices[id], { status: "deletion_pending", pendingDeletionAt: at }),
        cancelDeletion: async (_g, id) => Object.assign(state.temporaryVoices[id], { status: "active", pendingDeletionAt: null }),
        removeVoiceRecord: async (_g, id) => delete state.temporaryVoices[id]
    };
    let now = 1000, deleted = 0, moved = null;
    const overwriteEdits = [];
    const channel = { id: C, guildId: G, type: 2, members: new Map(), parentId: null,
        setName: async n => (channel.name = n), setUserLimit: async n => (channel.userLimit = n),
        permissionsFor: () => ({ has: () => true }),
        permissionOverwrites: { edit: async (target, overwrite) => { overwriteEdits.push({ target, overwrite }); } }, delete: async () => { deleted++; },
    };
    const target = { id: T, guild: { id: G }, voice: { channelId: C } };
    const member = { id: O, guild: { id: G }, displayName: "Owner", user: { username: "owner" }, voice: { channel: { id: "52345678901234567", guildId: G, type: 2, parent: null }, setChannel: async c => (moved = c.id) } };
    const guild = { id: G, roles: { everyone: { id: G } }, members: { me: { id: "62345678901234567", permissions: perms }, fetch: async id => id === T ? target : member }, channels: { fetch: async id => id === C ? channel : null, create: async () => channel } };
    const service = createVoiceManager({ stateStore: store, clock: () => now });
    return { service, store, guild, member, channel, target, overwriteEdits, get state() { return state; }, get deleted() { return deleted; }, get moved() { return moved; }, advance: ms => now += ms };
}

test("creates voice only from same guild voice channel and records owner", async () => {
    const f = fixture();
    const channel = await f.service.createTemporaryVoice(f.guild, G, f.member);
    assert.equal(channel.id, C);
    assert.equal(f.moved, C);
    assert.equal(f.state.temporaryVoices[C].ownerId, O);
});

test("owner can rename, set limit, lock and transfer to present guild member", async () => {
    const f = fixture(); await f.service.createTemporaryVoice(f.guild, G, f.member);
    await f.service.rename(f.guild, G, f.member, "Quiet room");
    await f.service.setLimit(f.guild, G, f.member, 4);
    await f.service.setLocked(f.guild, G, f.member, true);
    const record = await f.service.transfer(f.guild, G, f.member, T);
    assert.equal(f.channel.name, "Quiet room");
    assert.equal(f.channel.userLimit, 4);
    assert.equal(record.ownerId, T);
});

test("owner leaving transfers ownership to the oldest human still present", async () => {
    const f = fixture();
    await f.service.createTemporaryVoice(f.guild, G, f.member);
    f.channel.members.set(T, f.target);

    const record = await f.service.onMemberLeave(f.guild, G, C, O);
    assert.equal(record.ownerId, T);
});

test("private channel transfer updates old and new owner permissions", async () => {
    const f = fixture();
    await f.service.createTemporaryVoice(f.guild, G, f.member);
    await f.service.setLocked(f.guild, G, f.member, true);
    f.channel.members.set(T, f.target);

    await f.service.transfer(f.guild, G, f.member, T);

    const targetGrant = f.overwriteEdits.find(entry => entry.target.id === T && entry.overwrite.Connect === true);
    const ownerRevoke = f.overwriteEdits.find(entry => entry.target.id === O && entry.overwrite.Connect === null);
    assert.ok(targetGrant);
    assert.ok(ownerRevoke);
});

test("failed move rolls back the created channel and its state record", async () => {
    const f = fixture();
    f.member.voice.setChannel = async () => { throw new Error("move failed"); };

    await assert.rejects(
        f.service.createTemporaryVoice(f.guild, G, f.member),
        /move failed/
    );
    assert.equal(f.state.temporaryVoices[C], undefined);
    assert.equal(f.deleted, 1);
});

test("owner channel limit uses the stored guild setting", async () => {
    const f = fixture();
    await f.service.createTemporaryVoice(f.guild, G, f.member);
    await assert.rejects(
        f.service.createTemporaryVoice(f.guild, G, f.member),
        /Batas temporary voice/i
    );
});

test("rejects wrong-guild and non-owner control attempts", async () => {
    const f = fixture(); await f.service.createTemporaryVoice(f.guild, G, f.member);
    await assert.rejects(f.service.rename({ ...f.guild, id: "72345678901234567" }, G, f.member, "x"), /Guild tidak cocok/);
    const stranger = { ...f.member, id: T };
    await assert.rejects(f.service.rename(f.guild, G, stranger, "x"), /tidak ditemukan/);
});

test("empty cleanup waits for deadline and refuses occupied channels", async () => {
    const f = fixture(); await f.service.createTemporaryVoice(f.guild, G, f.member);
    await f.service.onMemberLeave(f.guild, G, C, O);
    assert.equal(await f.service.cleanupDue(f.guild, G, C), false);
    f.advance(11000);
    f.channel.members.set(T, f.target);
    assert.equal(await f.service.cleanupDue(f.guild, G, C), false);
    assert.equal(f.deleted, 0);
    f.channel.members.clear();
    await f.service.onMemberLeave(f.guild, G, C, T);
    f.advance(11000);
    assert.equal(await f.service.cleanupDue(f.guild, G, C), true);
    assert.equal(f.deleted, 1);
});
