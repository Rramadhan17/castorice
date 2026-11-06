const {
    Client,
    GatewayIntentBits,
    Events
} = require("discord.js");

const { token } = require("./config/env");
const { getGatewayIntents } = require("./config/discord-intents");
const registerInteractionHandler =
    require("./events/interactionCreate");
const registerVoiceGreeter =
    require("./voice-ai/greeter");
const registerVoiceManager =
    require("./voice-ai/register");

const client = new Client({
    intents: getGatewayIntents()
});

registerVoiceGreeter(client);
const voiceManagerRegistration = registerVoiceManager(client);
registerInteractionHandler(client, {
    voiceManager: voiceManagerRegistration.service,
    voiceStateStore: voiceManagerRegistration.stateStore
});

client.once(Events.ClientReady, readyClient => {
    console.log("--------------------------------");
    console.log(`Castorice online sebagai ${readyClient.user.tag}`);
    console.log(`Server terhubung: ${readyClient.guilds.cache.size}`);
    console.log("--------------------------------");
});

client.on(Events.Error, error => {
    console.error("[Discord Client Error]", error);
});

client.login(token).catch(error => {
    console.error("[Login Error]", error);
    process.exitCode = 1;
});
