const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMusicPanel, buildRadioSearchModal, buildRadioResultsPanel } = require("../../src/dashboard/menu-panel");

test("Music dashboard exposes a radio search modal and selectable station results", () => {
    const guild = { id: "123456789012345678" };
    const musicPanel = buildMusicPanel(guild);
    const radioButton = musicPanel.components[0].components
        .map(component => component.toJSON())
        .find(component => component.custom_id === "castorice:music_radio_search");
    const modal = buildRadioSearchModal().toJSON();
    const results = buildRadioResultsPanel([{
        title: "Test Radio",
        country: "Testland",
        codec: "MP3",
        bitrate: 128,
        streamUrl: "https://stream.example/live"
    }]);
    const select = results.components[0].components[0].toJSON();

    assert.equal(radioButton.label, "Radio Discovery");
    assert.equal(modal.custom_id, "castorice:radio_search_submit");
    assert.equal(modal.components[0].components[0].custom_id, "radio_search_input");
    assert.equal(select.custom_id, "castorice:music_radio_select");
    assert.equal(select.options[0].label, "Test Radio");
    assert.equal(select.options[0].value, "0");
});

test("Music dashboard disables lyrics and seek controls for live radio", () => {
    const panel = buildMusicPanel(
        { id: "123456789012345678" },
        { track: { title: "Test Radio", radioStream: true } }
    );
    const buttons = panel.components
        .flatMap(row => row.components)
        .map(component => component.toJSON());

    for (const customId of [
        "castorice:music_lyrics",
        "castorice:music_seek_back",
        "castorice:music_seek_forward"
    ]) {
        assert.equal(buttons.find(button => button.custom_id === customId).disabled, true, customId);
    }
});
