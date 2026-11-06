const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Events } = require("discord.js");
const fs = require("node:fs/promises");
const path = require("node:path");
const registerInteractionHandler = require("../../src/events/interactionCreate");
const { hashTemplatePlan } = require("../../src/server-templates/executor");
const { JsonGuildStore } = require("../../src/storage/json-guild-store");
const { createServerTemplateService } = require("../../src/server-templates/service");

function makeGuildId() {
    return `${Date.now()}${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
}

function makeGuild(id) {
    return {
        id,
        members: {
            async fetch(userId) {
                return {
                    id: userId,
                    guild: { id },
                    permissions: { has: () => true }
                };
            }
        }
    };
}

function makeInteraction({ guild, userId, customId, modal = false, select = false, values = [], permitted = true, fields = {} }) {
    const calls = {};
    return {
        calls,
        guild,
        guildId: guild?.id,
        user: { id: userId },
        customId,
        fields: { getTextInputValue: id => fields[id] },
        memberPermissions: { has: () => permitted },
        replied: false,
        deferred: false,
        isChatInputCommand: () => false,
        isModalSubmit: () => modal,
        isButton: () => !modal && !select,
        isStringSelectMenu: () => select,
        values,
        reply: async payload => { calls.reply = payload; },
        showModal: async payload => { calls.modal = payload.toJSON(); },
        deferReply: async () => { calls.deferred = true; },
        editReply: async payload => { calls.edited = payload; },
        followUp: async payload => { calls.followUp = payload; },
        update: async payload => { calls.updated = payload; }
    };
}

function register({ targetGuild, sourceGuild, service, executor }) {
    const client = new EventEmitter();
    client.guilds = { fetch: async id => id === sourceGuild.id ? sourceGuild : null };
    registerInteractionHandler(client, {
        serverTemplateService: service,
        serverTemplateExecutor: executor
    });
    return client.listeners(Events.InteractionCreate)[0];
}

test("Server Template Dashboard creates a persistent template through the authorized modal route", async t => {
    const targetGuild = makeGuild(makeGuildId());
    const userId = "12345678901234567";
    const directory = path.resolve(__dirname, "../../data/guilds", targetGuild.id);
    t.after(async () => fs.rm(directory, { recursive: true, force: true }));
    let created;
    const template = { id: "template-new", name: "Community", roles: [], channels: [] };
    const service = {
        async create(guild, actor, name) { created = { guildId: guild.id, actorId: actor.id, name }; return template; },
        async list() { return [{ id: template.id, name: template.name, sourceGuildId: targetGuild.id, roleCount: 0, channelCount: 0 }]; }
    };
    const onInteraction = register({ targetGuild, sourceGuild: targetGuild, service, executor: {} });

    const open = makeInteraction({ guild: targetGuild, userId, customId: "castorice:template_create" });
    await onInteraction(open);
    assert.equal(open.calls.modal.custom_id, "castorice:template_create_submit");

    const submit = makeInteraction({
        guild: targetGuild,
        userId,
        customId: "castorice:template_create_submit",
        modal: true,
        fields: { template_name: "Community" }
    });
    await onInteraction(submit);
    assert.deepEqual(created, { guildId: targetGuild.id, actorId: userId, name: "Community" });
    assert.match(submit.calls.edited.embeds[0].data.description, /template-new/);
});

test("Server Template Dashboard binds preview apply to its requester and executes only the confirmed current plan", async t => {
    const sourceGuild = makeGuild(makeGuildId());
    const targetGuild = makeGuild(makeGuildId());
    const userId = "23456789012345678";
    const targetDirectory = path.resolve(__dirname, "../../data/guilds", targetGuild.id);
    t.after(async () => fs.rm(targetDirectory, { recursive: true, force: true }));
    const template = { id: "template-source", name: "Community" };
    const plan = {
        dryRun: true,
        mode: "rebuild",
        templateId: template.id,
        templateName: template.name,
        sourceGuildId: sourceGuild.id,
        targetGuildId: targetGuild.id,
        roles: [],
        channels: [{ action: "delete", name: "old" }],
        summary: { create: 0, update: 0, preserve: 0, delete: 1 },
        warnings: ["Review this rebuild"]
    };
    const serviceCalls = [];
    const service = {
        async preview(input) { serviceCalls.push(input); return plan; },
        async get(guildId, templateId) {
            assert.equal(guildId, sourceGuild.id);
            assert.equal(templateId, template.id);
            return template;
        }
    };
    const executions = [];
    const executor = {
        async execute(input) {
            executions.push(input);
            return { applied: true, mode: input.mode, completed: [{ kind: "channel", action: "delete", name: "old" }] };
        }
    };
    const onInteraction = register({ targetGuild, sourceGuild, service, executor });

    const preview = makeInteraction({
        guild: targetGuild,
        userId,
        customId: "castorice:template_preview_submit",
        modal: true,
        fields: {
            template_source_guild: sourceGuild.id,
            template_id: template.id,
            template_mode: "rebuild"
        }
    });
    await onInteraction(preview);
    assert.equal(serviceCalls.length, 1);
    assert.equal(preview.calls.edited.embeds[0].data.title, "Preview rebuild: Community");
    const customId = preview.calls.edited.components[0].components[0].data.custom_id;

    const denied = makeInteraction({
        guild: targetGuild,
        userId: "34567890123456789",
        customId
    });
    await onInteraction(denied);
    assert.match(denied.calls.reply.content, /pemintanya/i);
    assert.equal(executions.length, 0);

    const tampered = makeInteraction({
        guild: targetGuild,
        userId: "34567890123456789",
        customId: customId.replace(userId, "34567890123456789")
    });
    await onInteraction(tampered);
    assert.match(tampered.calls.reply.content, /pemintanya/i);
    assert.equal(executions.length, 0);

    const apply = makeInteraction({ guild: targetGuild, userId, customId });
    await onInteraction(apply);
    assert.equal(executions.length, 1);
    assert.equal(executions[0].expectedPlanHash, hashTemplatePlan(plan));
    assert.equal(executions[0].confirmation, "APPLY REBUILD Community");
    assert.equal(executions[0].sourceActor.guild.id, sourceGuild.id);
    assert.equal(executions[0].targetActor.guild.id, targetGuild.id);
    assert.match(apply.calls.edited.content, /1 operasi berhasil/);
});

test("Server Template prevents concurrent applies from racing on one target guild", async t => {
    const sourceGuild = makeGuild(makeGuildId());
    const targetGuild = makeGuild(makeGuildId());
    const directory = path.resolve(__dirname, "../../data/guilds", targetGuild.id);
    t.after(async () => fs.rm(directory, { recursive: true, force: true }));
    const userId = "23456789012345678";
    const template = { id: "template-concurrent", name: "Community" };
    const plan = {
        dryRun: true,
        mode: "clone",
        templateId: template.id,
        templateName: template.name,
        sourceGuildId: sourceGuild.id,
        targetGuildId: targetGuild.id,
        roles: [],
        channels: [],
        summary: { create: 0, update: 0, preserve: 0, delete: 0 },
        warnings: []
    };
    const service = {
        async preview() { return plan; },
        async get() { return template; }
    };
    let resolveExecution;
    let executionStarted;
    const started = new Promise(resolve => { executionStarted = resolve; });
    let executionCount = 0;
    const executor = {
        execute() {
            executionCount += 1;
            executionStarted();
            return new Promise(resolve => { resolveExecution = resolve; });
        }
    };
    const onInteraction = register({ targetGuild, sourceGuild, service, executor });
    const createPreview = async () => {
        const preview = makeInteraction({
            guild: targetGuild,
            userId,
            customId: "castorice:template_preview_submit",
            modal: true,
            fields: {
                template_source_guild: sourceGuild.id,
                template_id: template.id,
                template_mode: "clone"
            }
        });
        await onInteraction(preview);
        return preview.calls.edited.components[0].components[0].data.custom_id;
    };
    const firstApplyId = await createPreview();
    const secondApplyId = await createPreview();

    const firstApply = makeInteraction({ guild: targetGuild, userId, customId: firstApplyId });
    const firstApplying = onInteraction(firstApply);
    await started;
    const secondApply = makeInteraction({ guild: targetGuild, userId, customId: secondApplyId });
    await onInteraction(secondApply);
    assert.match(secondApply.calls.reply.content, /sedang diterapkan/i);
    assert.equal(executionCount, 1);

    resolveExecution({ applied: true, mode: "clone", completed: [] });
    await firstApplying;
    assert.match(firstApply.calls.edited.content, /Template diterapkan/);
});

test("Server Template Dashboard denies template changes without Manage Server", async t => {
    const targetGuild = makeGuild(makeGuildId());
    const directory = path.resolve(__dirname, "../../data/guilds", targetGuild.id);
    t.after(async () => fs.rm(directory, { recursive: true, force: true }));
    let creates = 0;
    const service = { async create() { creates += 1; } };
    const onInteraction = register({ targetGuild, sourceGuild: targetGuild, service, executor: {} });
    const denied = makeInteraction({ guild: targetGuild, userId: "12345678901234567", customId: "castorice:template_create", permitted: false });

    await onInteraction(denied);
    assert.match(denied.calls.reply.content, /Manage Server/);
    assert.equal(denied.calls.modal, undefined);
    assert.equal(creates, 0);
});

test("Server Template Dashboard deletes a stored snapshot only after requester-bound confirmation", async t => {
    const guild = makeGuild(makeGuildId());
    const directory = path.resolve(__dirname, "../../data/guilds", guild.id);
    t.after(async () => fs.rm(directory, { recursive: true, force: true }));
    const template = { id: "template-delete", name: "Community", roles: [], channels: [] };
    let templates = [{ id: template.id, name: template.name, sourceGuildId: guild.id, roleCount: 0, channelCount: 0 }];
    const removals = [];
    const service = {
        async get(guildId, templateId) {
            assert.equal(guildId, guild.id);
            assert.equal(templateId, template.id);
            return template;
        },
        async remove(targetGuild, actor, templateId) {
            removals.push({ guildId: targetGuild.id, actorId: actor.id, templateId });
            templates = [];
            return true;
        },
        async list() { return templates; }
    };
    const onInteraction = register({ targetGuild: guild, sourceGuild: guild, service, executor: {} });
    const userId = "23456789012345678";
    const select = makeInteraction({
        guild, userId, customId: "castorice:template_delete_select", select: true, values: [template.id]
    });
    await onInteraction(select);
    assert.match(select.calls.reply.embeds[0].data.title, /Konfirmasi Hapus Template/);
    const confirmId = select.calls.reply.components[0].components[0].data.custom_id;

    const otherUser = makeInteraction({ guild, userId: "34567890123456789", customId: confirmId });
    await onInteraction(otherUser);
    assert.match(otherUser.calls.reply.content, /pemintanya/i);
    assert.equal(removals.length, 0);

    const denied = makeInteraction({ guild, userId, customId: confirmId, permitted: false });
    await onInteraction(denied);
    assert.match(denied.calls.reply.content, /Manage Server/i);
    assert.equal(removals.length, 0);

    const confirm = makeInteraction({ guild, userId, customId: confirmId });
    await onInteraction(confirm);
    assert.deepEqual(removals, [{ guildId: guild.id, actorId: userId, templateId: template.id }]);
    assert.match(confirm.calls.edited.embeds[0].data.description, /Template dihapus/);
});

test("Server Template Dashboard cancellation leaves the stored snapshot untouched", async t => {
    const guild = makeGuild(makeGuildId());
    const directory = path.resolve(__dirname, "../../data/guilds", guild.id);
    t.after(async () => fs.rm(directory, { recursive: true, force: true }));
    const template = { id: "template-keep", name: "Keep", roles: [], channels: [] };
    let removals = 0;
    const service = {
        async get() { return template; },
        async remove() { removals += 1; return true; },
        async list() { return [{ id: template.id, name: template.name, sourceGuildId: guild.id, roleCount: 0, channelCount: 0 }]; }
    };
    const onInteraction = register({ targetGuild: guild, sourceGuild: guild, service, executor: {} });
    const userId = "23456789012345678";
    const select = makeInteraction({ guild, userId, customId: "castorice:template_delete_select", select: true, values: [template.id] });
    await onInteraction(select);
    const cancelId = select.calls.reply.components[0].components[1].data.custom_id;
    const cancel = makeInteraction({ guild, userId, customId: cancelId });
    await onInteraction(cancel);

    assert.match(cancel.calls.reply.content, /dibatalkan/i);
    assert.equal(removals, 0);
});

test("AI Tag lists and persists an explicitly requested Server Template snapshot", async t => {
    const guild = makeGuild(makeGuildId());
    const directory = path.resolve(__dirname, "../../data/guilds", guild.id);
    const rootDir = await fs.mkdtemp(path.join(require("node:os").tmpdir(), "castorice-template-tag-"));
    t.after(async () => {
        await fs.rm(directory, { recursive: true, force: true });
        await fs.rm(rootDir, { recursive: true, force: true });
    });
    const service = createServerTemplateService({ store: new JsonGuildStore({ rootDir }), id: () => "template-tag" });
    const client = new EventEmitter();
    client.user = { id: "45678901234567890" };
    registerInteractionHandler(client, { serverTemplateService: service, serverTemplateExecutor: {} });
    const onMessage = client.listeners(Events.MessageCreate)[0];
    const onInteraction = client.listeners(Events.InteractionCreate)[0];
    const userId = "23456789012345678";
    const send = async commandText => {
        let reply;
        await onMessage({
            author: { id: userId, bot: false }, guild,
            mentions: { users: new Map([[client.user.id, client.user]]) },
            content: `<@${client.user.id}> ${commandText}`,
            reply: async payload => { reply = payload; }
        });
        return reply;
    };

    const created = await send("simpan snapshot Community");
    assert.match(created.content, /Snapshot \*\*Community\*\* tersimpan/);
    assert.match(created.content, /Struktur server belum diubah/);
    const listed = await send("daftar template");
    assert.match(listed.content, /Community.*0 role, 0 channel/);
    assert.match(listed.content, /template-tag/);

    for (const mode of ["create", "rebuild", "clone"]) {
        const request = await send(`${mode} template`);
        const buttonId = request.components[0].components[0].data.custom_id;
        assert.equal(buttonId, `castorice:template_preview_open:${mode}`);

        const open = makeInteraction({ guild, userId, customId: buttonId });
        await onInteraction(open);
        assert.equal(open.calls.modal.custom_id, "castorice:template_preview_submit");
        assert.equal(open.calls.modal.components[2].components[0].value, mode);
    }
});
