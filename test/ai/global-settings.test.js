const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createGlobalAISettings } = require("../../src/ai/global-settings");

async function createTemporarySettings(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "castorice-global-ai-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return {
        directory,
        settings: createGlobalAISettings({
            filePath: path.join(directory, "global-ai-settings.json")
        })
    };
}

test("global AI settings default to disabled and contain no provider selection controls", async t => {
    const { settings } = await createTemporarySettings(t);

    assert.deepEqual(await settings.getSettings(), {
        version: 1,
        enabled: false
    });
    assert.equal(settings.setProviderOrder, undefined);
    assert.equal(settings.setFailoverEnabled, undefined);
});

test("global AI settings persist only global availability", async t => {
    const { settings } = await createTemporarySettings(t);
    await settings.setEnabled(true);

    assert.deepEqual(await settings.getSettings(), {
        version: 1,
        enabled: true
    });
});

test("legacy provider priority and failover settings are ignored and removed on the next save", async t => {
    const { directory, settings } = await createTemporarySettings(t);
    const filePath = path.join(directory, "global-ai-settings.json");
    await fs.writeFile(filePath, JSON.stringify({
        version: 1,
        enabled: false,
        providerOrder: ["openai", "openrouter"],
        failoverEnabled: true
    }));

    assert.deepEqual(await settings.getSettings(), {
        version: 1,
        enabled: false
    });
    await settings.setEnabled(true);
    assert.deepEqual(JSON.parse(await fs.readFile(filePath, "utf8")), {
        version: 1,
        enabled: true
    });
});

test("global AI settings validate the boolean control", async t => {
    const { settings } = await createTemporarySettings(t);

    assert.throws(() => settings.setEnabled("true"), /must be a boolean/);
});
