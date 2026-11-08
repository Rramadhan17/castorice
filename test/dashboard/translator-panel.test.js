const test = require("node:test");
const assert = require("node:assert/strict");
const {
    buildDashboard,
    buildFeaturePanel,
    buildTranslatorModal,
    buildTranslatorLanguagePanel
} = require("../../src/dashboard/menu-panel");

test("dashboard exposes supported navigation and hides non-dashboard feature panels", () => {
    const guild = {
        id: "123456789012345678",
        voiceStates: { cache: { filter: () => ({ size: 0 }) } },
        channels: { cache: { filter: () => ({ size: 0 }) } },
        members: { me: { voice: { channel: null } } }
    };

    const payload = buildDashboard(guild);
    const buttons = payload.components.flatMap(row => row.components.map(component => component.toJSON()));
    const translator = buttons.find(button => button.custom_id === "castorice:translator");
    const playlists = buttons.find(button => button.custom_id === "castorice:playlists");
    const navigation = [
        "castorice:music",
        "castorice:ai_chat",
        "castorice:translator",
        "voice:open",
        "castorice:playlists",
        "castorice:settings"
    ];
    const forbidden = [
        "castorice:server_templates",
        "castorice:feature_selection",
        "castorice:voice_manager",
        "owner:open",
        "castorice:security_assistant"
    ];

    assert.equal(translator.disabled, false);
    assert.equal(playlists.disabled, false);
    for (const customId of navigation) {
        assert.ok(buttons.some(button => button.custom_id === customId), `missing ${customId}`);
    }
    for (const customId of forbidden) {
        assert.equal(buttons.some(button => button.custom_id === customId), false);
    }
});

test("Translator panel opens a bounded modal with source and target fields", () => {
    const panel = buildFeaturePanel("translator");
    const modal = buildTranslatorModal().toJSON();
    const buttons = panel.components[0].components.map(button => button.toJSON());

    assert.ok(buttons.some(button => button.custom_id === "castorice:translator_open"));
    assert.ok(buttons.some(button => button.custom_id === "castorice:translator_languages"));
    assert.equal(modal.custom_id, "castorice:translator_submit");
    assert.equal(modal.components.length, 3);
});

test("Translator language selector pages options and prefills the chosen target", () => {
    const languages = Array.from({ length: 30 }, (_, index) => ({
        code: `l${String.fromCharCode(97 + index % 26)}`,
        name: `Language ${index}`
    }));
    const firstPage = buildTranslatorLanguagePanel(languages).components.map(row =>
        row.components.map(component => component.toJSON())
    );
    const secondPage = buildTranslatorLanguagePanel(languages, 1).components.map(row =>
        row.components.map(component => component.toJSON())
    );
    const modal = buildTranslatorModal({ targetLanguage: "tl" }).toJSON();

    assert.equal(firstPage[0][0].options.length, 25);
    assert.equal(firstPage[1][1].custom_id, "castorice:translator_languages_page:1");
    assert.equal(secondPage[0][0].options.length, 5);
    assert.equal(modal.components[2].components[0].value, "tl");
});

test("playlist dashboard panel paginates and exposes actual create/play controls", () => {
    const { buildPlaylistPanel, buildPlaylistCreateModal } = require("../../src/dashboard/menu-panel");
    const data = { items: Object.fromEntries(Array.from({ length: 30 }, (_, index) => {
        const id = `playlist-${index}`;
        return [id, { id, name: `Playlist ${index}`, tracks: [{ input: "track" }] }];
    })) };
    const panel = buildPlaylistPanel("123456789012345678", data, 1);
    const components = panel.components.flatMap(row => row.components.map(component => component.toJSON()));
    assert.equal(components.some(component => component.custom_id === "castorice:playlist_manage_select:1"), true);
    const select = components.find(component => component.custom_id === "castorice:playlist_manage_select:1");
    assert.equal(select.options.length, 24);
    assert.equal(select.options.some(option => option.value.startsWith("delete:playlist-")), true);
    assert.equal(components.some(component => component.custom_id === "castorice:playlists_refresh:0"), true);
    assert.equal(components.some(component => component.custom_id === "castorice:playlist_create"), true);
    assert.equal(buildPlaylistCreateModal().toJSON().custom_id, "castorice:playlist_create_submit");
});
