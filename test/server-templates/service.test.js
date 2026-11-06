const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { JsonGuildStore } = require("../../src/storage/json-guild-store");
const { createServerTemplateService, serializeGuildSnapshot } = require("../../src/server-templates/service");

function makeRole(id, name, position = 1, permissions = 0n, managed = false) {
    return { id, name, position, managed, color: 0, hoist: false, mentionable: false, permissions: { bitfield: permissions } };
}

function makeGuild(id, { roles = [], channels = [] } = {}) {
    return {
        id,
        roles: { cache: new Map(roles.map(role => [role.id, role])) },
        channels: { cache: new Map(channels.map(channel => [channel.id, channel])) }
    };
}

function makeActor(guildId, allowed = true) {
    return { guild: { id: guildId }, permissions: { has: flag => allowed && flag === PermissionFlagsBits.ManageGuild } };
}

function makeTextChannel(id, name, parentId, roleId) {
    return {
        id,
        name,
        type: ChannelType.GuildText,
        parentId,
        rawPosition: 1,
        topic: null,
        permissionOverwrites: { cache: new Map([
            [`role-${roleId}`, { id: roleId, type: 0, allow: { bitfield: 1024n }, deny: { bitfield: 0n } }],
            ["member-1", { id: "member-1", type: 1, allow: { bitfield: 2048n }, deny: { bitfield: 0n } }]
        ]) }
    };
}

test("server template snapshots persist per guild and omit unsafe member overwrites", async t => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "castorice-templates-"));
    t.after(async () => fs.rm(rootDir, { recursive: true, force: true }));
    const service = createServerTemplateService({
        store: new JsonGuildStore({ rootDir }),
        now: () => "2026-01-01T00:00:00.000Z",
        id: () => "template-1"
    });
    const guildId = "12345678901234567";
    const helper = makeRole("role-helper", "Helper", 2);
    const category = { id: "category-1", name: "Info", type: ChannelType.GuildCategory, rawPosition: 0 };
    const general = makeTextChannel("channel-1", "general", category.id, helper.id);
    const guild = makeGuild(guildId, {
        roles: [makeRole(guildId, "@everyone", 0, PermissionFlagsBits.Administrator), helper, makeRole("managed", "Bot Role", 3, 0n, true)],
        channels: [category, general]
    });

    const template = await service.create(guild, makeActor(guildId), "  Community   Layout ");
    assert.equal(template.name, "Community Layout");
    assert.equal(template.roles.length, 1);
    assert.equal(template.channels[1].parentName, "Info");
    assert.deepEqual(template.channels[1].permissionOverwrites, [{
        roleName: "Helper",
        sourceRoleId: "role-helper",
        allow: "1024",
        deny: "0"
    }]);
    assert.match(template.warnings.join(" "), /Member-specific/);
    assert.deepEqual(await service.list(guildId), [{
        id: "template-1",
        name: "Community Layout",
        createdAt: "2026-01-01T00:00:00.000Z",
        sourceGuildId: guildId,
        roleCount: 1,
        channelCount: 2
    }]);
    assert.equal((await service.get(guildId, template.id)).id, template.id);
    await assert.rejects(service.create(guild, makeActor(guildId), "community layout"), /sudah digunakan/i);
});

test("server template planning distinguishes clone, smart merge, and destructive rebuild", async t => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "castorice-template-plan-"));
    t.after(async () => fs.rm(rootDir, { recursive: true, force: true }));
    const service = createServerTemplateService({
        store: new JsonGuildStore({ rootDir }),
        id: () => "template-plan"
    });
    const sourceId = "12345678901234567";
    const targetId = "22345678901234567";
    const sourceRole = makeRole("source-role", "Helper", 2);
    const sourceCategory = { id: "source-category", name: "Info", type: ChannelType.GuildCategory, rawPosition: 0 };
    const sourceGuild = makeGuild(sourceId, {
        roles: [sourceRole],
        channels: [sourceCategory, makeTextChannel("source-general", "general", sourceCategory.id, sourceRole.id)]
    });
    const template = await service.create(sourceGuild, makeActor(sourceId), "Source");

    const targetRole = makeRole("target-role", "Helper", 1);
    const targetCategory = { id: "target-category", name: "Info", type: ChannelType.GuildCategory, rawPosition: 0 };
    const targetGuild = makeGuild(targetId, {
        roles: [targetRole, makeRole("stale-role", "Legacy", 2)],
        channels: [targetCategory, makeTextChannel("target-general", "general", targetCategory.id, targetRole.id), {
            id: "legacy-channel", name: "legacy", type: ChannelType.GuildText, parentId: null, rawPosition: 5
        }]
    });

    const common = { sourceGuild, targetGuild, sourceActor: makeActor(sourceId), targetActor: makeActor(targetId), templateId: template.id };
    const merge = await service.preview({ ...common, mode: "smart_merge" });
    assert.equal(merge.dryRun, true);
    assert.equal(merge.sourceGuildId, sourceId);
    assert.equal(merge.targetGuildId, targetId);
    assert.deepEqual(merge.summary, { create: 0, update: 3, delete: 0, preserve: 0 });
    assert.ok(merge.roles.every(item => item.action !== "delete"));
    assert.ok(merge.channels.every(item => item.action !== "delete"));

    const clone = await service.preview({ ...common, mode: "clone" });
    assert.equal(clone.summary.preserve, 3);
    assert.equal(clone.summary.delete, 0);

    const rebuild = await service.preview({ ...common, mode: "rebuild" });
    assert.equal(rebuild.summary.delete, 1);
    assert.equal(rebuild.summary.update, 3);
    assert.equal(rebuild.summary.preserve, 1);
    assert.match(rebuild.warnings.join(" "), /preserves target roles/i);
});

test("server template creation and cross-guild preview require Manage Server on each guild", async t => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "castorice-template-perms-"));
    t.after(async () => fs.rm(rootDir, { recursive: true, force: true }));
    const service = createServerTemplateService({ store: new JsonGuildStore({ rootDir }), id: () => "template-perms" });
    const sourceId = "12345678901234567";
    const targetId = "22345678901234567";
    const source = makeGuild(sourceId);
    const target = makeGuild(targetId);
    await assert.rejects(service.create(source, makeActor(sourceId, false), "Denied"), /Manage Server/);
    const template = await service.create(source, makeActor(sourceId), "Allowed");
    await assert.rejects(service.preview({
        sourceGuild: source,
        targetGuild: target,
        sourceActor: makeActor(sourceId),
        targetActor: makeActor(targetId, false),
        templateId: template.id
    }), /Manage Server/);
    await assert.rejects(service.preview({
        sourceGuild: source,
        targetGuild: target,
        sourceActor: makeActor(targetId),
        targetActor: makeActor(targetId),
        templateId: template.id
    }), /server yang sama/);
});

test("server template removal is guild-scoped, permission-checked and idempotent", async t => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "castorice-template-remove-"));
    t.after(async () => fs.rm(rootDir, { recursive: true, force: true }));
    const service = createServerTemplateService({ store: new JsonGuildStore({ rootDir }), id: () => "template-remove" });
    const guildId = "12345678901234567";
    const otherGuildId = "22345678901234567";
    const guild = makeGuild(guildId);
    const template = await service.create(guild, makeActor(guildId), "To Remove");

    await assert.rejects(service.remove(guild, makeActor(guildId, false), template.id), /Manage Server/i);
    await assert.rejects(service.remove(guild, makeActor(otherGuildId), template.id), /server yang sama/i);
    assert.equal(await service.get(guildId, template.id).then(result => result.id), template.id);
    assert.equal(await service.remove(guild, makeActor(guildId), template.id), true);
    assert.equal(await service.remove(guild, makeActor(guildId), template.id), false);
    await assert.rejects(service.get(guildId, template.id), /Template tidak ditemukan/i);
    assert.deepEqual(await service.list(otherGuildId), []);
});

test("template snapshots flag Administrator roles for review", () => {
    const guild = makeGuild("12345678901234567", {
        roles: [makeRole("admin-role", "Admins", 1, PermissionFlagsBits.Administrator)]
    });
    const snapshot = serializeGuildSnapshot(guild);
    assert.match(snapshot.warnings.join(" "), /Administrator permission/);
});
