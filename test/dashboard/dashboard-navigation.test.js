const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDashboard, buildSettingsPanel, buildGlobalAISettingsPanel } = require("../../src/dashboard/menu-panel");

function createGuild() {
    return {
        id: "123456789012345678",
        voiceStates: { cache: { filter: () => ({ size: 0 }) } },
        channels: { cache: { filter: () => ({ size: 0 }) } },
        members: { me: { voice: { channel: null } } }
    };
}

function components(panel) {
    return panel.components.map(row => row.components.map(component => component.toJSON()));
}

test("/menu dashboard exposes Settings and retains Music, AI, Translator, Voice, and Playlists", () => {
    const panel = buildDashboard(createGuild());
    const rows = components(panel);
    const buttons = rows.flat();
    const ids = buttons.map(button => button.custom_id);

    for (const id of [
        "castorice:music",
        "castorice:ai_chat",
        "castorice:translator",
        "voice:open",
        "castorice:playlists",
        "castorice:settings"
    ]) {
        assert.ok(ids.includes(id), `missing dashboard action ${id}`);
    }
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(rows.every(row => row.length <= 5));
});

test("Settings Center exposes server AI controls only to admins and global controls only to owner", async () => {
    const adminPanel = await buildSettingsPanel({
        guildId: "123456789012345678",
        canManageGuild: true,
        globalAIEnabled: true,
        serverAIEnabled: false,
        isOwner: false
    });
    const adminIds = components(adminPanel).flat().map(button => button.custom_id);
    assert.ok(adminIds.includes("castorice:ai_server_toggle"));
    assert.ok(!adminIds.includes("castorice:ai_global_open"));

    const memberPanel = await buildSettingsPanel({
        guildId: "123456789012345678",
        canManageGuild: false,
        globalAIEnabled: true,
        serverAIEnabled: true,
        isOwner: false
    });
    const memberIds = components(memberPanel).flat().map(button => button.custom_id);
    assert.ok(!memberIds.includes("castorice:ai_server_toggle"));
    assert.ok(!memberIds.includes("castorice:ai_global_open"));
    assert.match(memberPanel.embeds[0].data.description, /AI Chat server ini:\*\* AKTIF/);

    const ownerPanel = await buildSettingsPanel({
        guildId: "123456789012345678",
        canManageGuild: true,
        globalAIEnabled: true,
        serverAIEnabled: true,
        isOwner: true
    });
    const ownerIds = components(ownerPanel).flat().map(button => button.custom_id);
    assert.ok(ownerIds.includes("castorice:ai_global_open"));
});

test("global AI panel never renders secrets and stays within Discord component limits", () => {
    const panel = buildGlobalAISettingsPanel({
        settings: { enabled: false },
        providerStatus: {
            configured: true,
            configurationError: false
        }
    });
    const rows = components(panel);
    const ids = rows.flat().map(button => button.custom_id);
    assert.ok(ids.includes("castorice:ai_global_toggle"));
    assert.ok(!ids.includes("castorice:ai_failover_toggle"));
    assert.ok(!ids.includes("castorice:ai_provider_order"));
    assert.ok(ids.includes("castorice:settings"));
    assert.ok(rows.length <= 5);
    assert.ok(rows.every(row => row.length <= 5));
    assert.match(panel.embeds[0].data.description, /bukan verifikasi koneksi live/);
    assert.match(panel.embeds[0].data.description, /Gemini adalah satu-satunya provider/);
});
