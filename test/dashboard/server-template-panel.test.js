const test = require("node:test");
const assert = require("node:assert/strict");
const {
    buildDashboard,
    buildFeaturePanel,
    buildServerTemplatesPanel,
    buildServerTemplateCreateModal,
    buildServerTemplatePreviewModal,
    buildServerTemplatePreviewPanel,
    buildServerTemplateDeleteConfirmPanel
} = require("../../src/dashboard/menu-panel");

test("Dashboard hides Server Templates controls and keeps the backend available for AI-driven flows", () => {
    const dashboard = buildDashboard({
        id: "12345678901234567",
        voiceStates: { cache: { filter: () => ({ size: 0 }) } },
        channels: { cache: { filter: () => ({ size: 0 }) } },
        members: { me: { voice: { channel: null } } }
    });
    const buttons = dashboard.components.flatMap(row => row.components.map(button => button.toJSON()));

    assert.equal(buttons.some(button => button.custom_id === "castorice:server_templates"), false);
    assert.equal(buttons.some(button => button.custom_id === "castorice:templates_open"), false);

    const featurePanel = buildFeaturePanel("server_templates");
    const featureButtons = featurePanel.components.flatMap(row => row.components.map(button => button.toJSON()));
    assert.equal(featureButtons.some(button => button.custom_id === "castorice:templates_open"), true);
});

test("Server Template deletion requires a bound confirmation and warns that only the snapshot is deleted", () => {
    const panel = buildServerTemplateDeleteConfirmPanel({ name: "Community" }, "confirmation-1", "34567890123456789");
    const buttons = panel.components[0].components.map(button => button.toJSON());
    assert.equal(buttons[0].custom_id, "castorice:template_delete_confirm:confirmation-1:34567890123456789");
    assert.equal(buttons[1].custom_id, "castorice:template_delete_cancel:confirmation-1:34567890123456789");
    assert.match(panel.embeds[0].data.description, /tidak mengubah channel atau role Discord/i);
});

test("Server Templates create and preview modals collect bounded inputs", () => {
    const createModal = buildServerTemplateCreateModal().toJSON();
    assert.equal(createModal.custom_id, "castorice:template_create_submit");
    assert.equal(createModal.components[0].components[0].max_length, 50);

    const previewModal = buildServerTemplatePreviewModal().toJSON();
    assert.equal(previewModal.custom_id, "castorice:template_preview_submit");
    assert.deepEqual(previewModal.components.map(row => row.components[0].custom_id), [
        "template_source_guild",
        "template_id",
        "template_mode"
    ]);
    assert.equal(previewModal.components[2].components[0].value, "smart_merge");
    assert.equal(buildServerTemplatePreviewModal("clone").toJSON().components[2].components[0].value, "clone");
    assert.throws(() => buildServerTemplatePreviewModal("unsafe"), /Mode template tidak valid/);
});

test("Server Template preview button is bound to a requester and displays explicit rebuild counts", () => {
    const panel = buildServerTemplatePreviewPanel({
        mode: "rebuild",
        templateName: "Community",
        targetGuildId: "22345678901234567",
        summary: { create: 2, update: 1, preserve: 3, delete: 1 },
        roles: [],
        channels: [{ action: "delete" }],
        warnings: ["Member-specific overwrites are omitted."]
    }, "preview-1", "34567890123456789", "APPLY REBUILD Community");
    const button = panel.components[0].components[0].toJSON();

    assert.equal(button.custom_id, "castorice:template_apply:preview-1:34567890123456789");
    assert.match(panel.embeds[0].data.description, /1 hapus/);
    assert.match(panel.embeds[0].data.description, /APPLY REBUILD Community/);
    assert.match(panel.embeds[0].data.description, /Member-specific overwrites/);
});
