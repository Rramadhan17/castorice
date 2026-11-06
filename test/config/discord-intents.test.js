const test = require("node:test");
const assert = require("node:assert/strict");
const { GatewayIntentBits } = require("discord.js");
const { getGatewayIntents } = require("../../src/config/discord-intents");

test("presence intent is opt-in and does not change default gateway intents", () => {
    const defaults = getGatewayIntents({ enablePresence: false });
    assert.equal(defaults.includes(GatewayIntentBits.GuildPresences), false);
    assert.deepEqual(getGatewayIntents({ enablePresence: "true" }), [
        ...defaults,
        GatewayIntentBits.GuildPresences
    ]);
    assert.equal(getGatewayIntents({ enablePresence: "false" }).includes(GatewayIntentBits.GuildPresences), false);
});
