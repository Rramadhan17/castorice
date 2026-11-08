const test = require("node:test");
const assert = require("node:assert/strict");
const {
    formatAIProviderStatus,
    parseAIProviderSettingsIntent
} = require("../../src/ai/provider-settings");

test("provider status parser accepts read-only status requests but no provider mutations", () => {
    assert.deepEqual(parseAIProviderSettingsIntent("status provider AI"), { action: "status" });
    assert.deepEqual(parseAIProviderSettingsIntent("show AI status"), { action: "status" });
    assert.equal(parseAIProviderSettingsIntent("atur urutan provider gemini,openai"), null);
    assert.equal(parseAIProviderSettingsIntent("provider order openrouter,gemini"), null);
    assert.equal(parseAIProviderSettingsIntent("failover off"), null);
    assert.equal(parseAIProviderSettingsIntent("ubah provider dan lakukan sesuatu"), null);
});

test("Gemini status reports configuration without claiming live connectivity or exposing credentials", () => {
    assert.match(
        formatAIProviderStatus({ configured: true }),
        /Gemini: dikonfigurasi; koneksi belum diverifikasi live/
    );
    assert.match(
        formatAIProviderStatus({ configured: false }),
        /Gemini belum dikonfigurasi.*GEMINI_API_KEY/
    );
    assert.match(
        formatAIProviderStatus({ configured: false, configurationError: true }),
        /GEMINI_API_KEY.*GEMINI_MODEL/
    );
    assert.doesNotMatch(formatAIProviderStatus({ configured: true }), /secret|credential|api[_ -]?key\s*[:=]/i);
});
