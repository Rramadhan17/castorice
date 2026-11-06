const { GatewayIntentBits } = require("discord.js");

function getGatewayIntents({ enablePresence = process.env.DISCORD_ENABLE_PRESENCE_INTENT } = {}) {
    const intents = [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ];

    if (enablePresence === true || String(enablePresence).trim().toLowerCase() === "true") {
        intents.push(GatewayIntentBits.GuildPresences);
    }

    return intents;
}

module.exports = { getGatewayIntents };
