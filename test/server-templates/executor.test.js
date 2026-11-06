const test = require("node:test");
const assert = require("node:assert/strict");
const { ChannelType } = require("discord.js");
const {
    createServerTemplateExecutor,
    createDiscordMutationAdapter,
    hashTemplatePlan,
    getConfirmationPhrase
} = require("../../src/server-templates/executor");

function makePlan() {
    return {
        dryRun: true,
        mode: "smart_merge",
        templateId: "template-1",
        templateName: "Community",
        roles: [
            { action: "create", name: "Member", definition: { name: "Member" } },
            { action: "update", name: "Helper", definition: { name: "Helper" } },
            { action: "preserve", name: "Legacy" }
        ],
        channels: [
            { action: "delete", name: "old", type: 0, definition: { name: "old" } },
            { action: "create", name: "general", type: 0, definition: { name: "general" } },
            { action: "update", name: "rules", type: 0, definition: { name: "rules" } }
        ],
        summary: { create: 2, update: 2, delete: 1, preserve: 1 },
        warnings: []
    };
}

function makeInput(plan, overrides = {}) {
    const service = {
        async preview() { return plan; },
        async get() { return { id: "template-1", name: "Community" }; }
    };
    const applied = [];
    const adapter = {
        async applyRole(operation) {
            applied.push(`role:${operation.action}:${operation.name}`);
            return async () => { applied.push(`undo:role:${operation.name}`); };
        },
        async applyChannel(operation) {
            applied.push(`channel:${operation.action}:${operation.name}`);
            return async () => { applied.push(`undo:channel:${operation.name}`); };
        }
    };
    return {
        executor: createServerTemplateExecutor({ service, adapter }),
        applied,
        input: {
            sourceGuild: { id: "12345678901234567" },
            targetGuild: { id: "22345678901234567" },
            sourceActor: {},
            targetActor: {},
            templateId: "template-1",
            mode: "smart_merge",
            expectedPlanHash: hashTemplatePlan(plan),
            confirmation: getConfirmationPhrase("smart_merge", "Community"),
            ...overrides
        }
    };
}

test("template executor requires the exact preview hash and confirmation phrase", async () => {
    const plan = makePlan();
    const fixture = makeInput(plan);
    await assert.rejects(fixture.executor.execute({ ...fixture.input, expectedPlanHash: "stale" }), /preview baru/i);
    await assert.rejects(fixture.executor.execute({ ...fixture.input, confirmation: "APPLY" }), /Konfirmasi harus sama persis/);
    assert.deepEqual(fixture.applied, []);
});

test("template executor applies creates and updates before deletions and returns a result", async () => {
    const plan = makePlan();
    const fixture = makeInput(plan);
    const result = await fixture.executor.execute(fixture.input);

    assert.equal(result.applied, true);
    assert.equal(result.dryRun, false);
    assert.ok(fixture.applied.indexOf("channel:create:general") < fixture.applied.indexOf("channel:delete:old"));
    assert.deepEqual(fixture.applied.slice(0, 3), [
        "role:create:Member",
        "role:update:Helper",
        "role:preserve:Legacy"
    ]);
});

test("template executor rolls successful operations back in reverse order on failure", async () => {
    const plan = makePlan();
    const service = { async preview() { return plan; }, async get() { return { id: "template-1", name: "Community" }; } };
    const applied = [];
    let operationCount = 0;
    const adapter = {
        async applyRole(operation) {
            applied.push(`role:${operation.name}`);
            return async () => { applied.push(`undo:role:${operation.name}`); };
        },
        async applyChannel(operation) {
            operationCount += 1;
            applied.push(`channel:${operation.name}`);
            if (operationCount === 2) throw new Error("simulated failure");
            return async () => { applied.push(`undo:channel:${operation.name}`); };
        }
    };
    const executor = createServerTemplateExecutor({ service, adapter });

    await assert.rejects(executor.execute({
        sourceGuild: { id: "12345678901234567" },
        targetGuild: { id: "22345678901234567" },
        sourceActor: {},
        targetActor: {},
        templateId: "template-1",
        mode: "smart_merge",
        expectedPlanHash: hashTemplatePlan(plan),
        confirmation: getConfirmationPhrase("smart_merge", "Community")
    }), error => {
        assert.match(error.message, /perubahan yang selesai sudah dibatalkan/i);
        assert.deepEqual(error.rollbackErrors, []);
        return true;
    });
    assert.deepEqual(applied.slice(-4), [
        "undo:channel:general",
        "undo:role:Legacy",
        "undo:role:Helper",
        "undo:role:Member"
    ]);
});

test("Discord mutation adapter applies and rolls back role updates", async () => {
    const role = {
        id: "role-1",
        name: "Helper",
        color: 1,
        hoist: false,
        mentionable: false,
        permissions: { bitfield: 1n },
        position: 2,
        async edit(options) {
            Object.assign(this, options);
            this.permissions = { bitfield: BigInt(options.permissions) };
            return this;
        }
    };
    const guild = { roles: { cache: new Map([[role.id, role]]) } };
    const adapter = createDiscordMutationAdapter();
    const rollback = await adapter.applyRole({
        action: "update",
        name: "Helper",
        definition: {
            name: "Helper",
            color: 9,
            hoist: true,
            mentionable: true,
            permissions: "8",
            position: 4
        }
    }, guild);

    assert.equal(role.color, 9);
    assert.equal(role.permissions.bitfield, 8n);
    await rollback();
    assert.equal(role.color, 1);
    assert.equal(role.permissions.bitfield, 1n);
    assert.equal(role.position, 2);
});

test("Discord mutation adapter creates a category and a child channel with role overwrites", async () => {
    let nextId = 0;
    const role = { id: "role-1", name: "Helper" };
    const guild = {
        roles: { cache: new Map([[role.id, role]]) },
        channels: { cache: new Map() }
    };
    guild.channels.create = async options => {
        const channel = {
            ...options,
            id: `channel-${++nextId}`,
            parentId: options.parent || null,
            parent: options.parent ? guild.channels.cache.get(options.parent) : null,
            rawPosition: options.position,
            permissionOverwrites: {
                cache: new Map((options.permissionOverwrites || []).map((item, index) => [
                    `overwrite-${index}`,
                    { ...item, allow: { bitfield: BigInt(item.allow) }, deny: { bitfield: BigInt(item.deny) } }
                ]))
            },
            async delete() { guild.channels.cache.delete(this.id); }
        };
        guild.channels.cache.set(channel.id, channel);
        return channel;
    };

    const adapter = createDiscordMutationAdapter();
    const undoCategory = await adapter.applyChannel({
        action: "create",
        name: "Info",
        type: ChannelType.GuildCategory,
        definition: { name: "Info", type: ChannelType.GuildCategory, parentName: null, position: 0, permissionOverwrites: [] }
    }, guild);
    const undoText = await adapter.applyChannel({
        action: "create",
        name: "general",
        type: ChannelType.GuildText,
        definition: {
            name: "general",
            type: ChannelType.GuildText,
            parentName: "Info",
            position: 1,
            permissionOverwrites: [{ roleName: "Helper", allow: "1024", deny: "0" }]
        }
    }, guild);

    const textChannel = [...guild.channels.cache.values()].find(channel => channel.name === "general");
    assert.equal(textChannel.parent.name, "Info");
    assert.equal(textChannel.permissionOverwrites.cache.values().next().value.id, role.id);
    assert.equal(textChannel.permissionOverwrites.cache.values().next().value.allow.bitfield, 1024n);
    await undoText();
    await undoCategory();
    assert.equal(guild.channels.cache.size, 0);
});
