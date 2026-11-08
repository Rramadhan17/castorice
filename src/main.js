const {
    Client,
    GatewayIntentBits,
    Events
} = require("discord.js");

const { token, ownerId } = require("./config/env");
const { getGatewayIntents } = require("./config/discord-intents");
const registerInteractionHandler =
    require("./events/interactionCreate");
const registerVoiceGreeter =
    require("./voice-ai/greeter");
const registerVoiceManager =
    require("./voice-ai/register");
const { createSecurityAssistant } = require("./security/assistant");
const { registerSecurityMonitor } = require("./security/monitor");
const { getVoiceConnection } = require("@discordjs/voice");
const music = require("./music/manager");
const { createVoiceCenterService } = require("./voice-ai/center-service");
const { registerVoiceCenterEvents } = require("./voice-ai/center-events");
const { createCleanupRegistry } = require("./runtime/cleanup-registry");
const {
    createHealthServer,
    createRuntimeLifecycle,
    parsePort
} = require("./http/health-server");

function logRuntimeError(label, error) {
    console.error(label, {
        code: typeof error?.code === "string" ? error.code : null,
        name: typeof error?.name === "string" ? error.name : "Error"
    });
}

async function startRuntime() {
    const client = new Client({
        intents: getGatewayIntents()
    });
    const cleanupRegistry = createCleanupRegistry();
    cleanupRegistry.add("Music Manager", () => music.shutdown());

    let lifecycle;
    try {
        const disposeVoiceGreeter = registerVoiceGreeter(client);
        cleanupRegistry.add("Voice Greeter", disposeVoiceGreeter);

        const voiceManagerRegistration = registerVoiceManager(client);
        cleanupRegistry.add("Voice Manager", () => voiceManagerRegistration.dispose());

        const securityAssistant = createSecurityAssistant();
        const securityMonitor = registerSecurityMonitor(client, { securityAssistant, ownerId });
        cleanupRegistry.add("Security Monitor", () => securityMonitor.close());

        const voiceCenterService = createVoiceCenterService({
            botOwnerId: ownerId,
            getVoiceSession: guild => {
                const musicSession = music.getSession(guild.id);
                if (musicSession && !musicSession.closed) {
                    return { channelId: musicSession.channelId, identity: musicSession };
                }
                const connection = getVoiceConnection(guild.id);
                const channelId = connection?.joinConfig?.channelId;
                return channelId ? { channelId, identity: connection } : null;
            },
            disconnectVoiceSession: async ({ guild, channelId, identity }) => {
                const musicSession = music.getSession(guild.id);
                if (musicSession) {
                    if (musicSession !== identity || musicSession.channelId !== channelId) return false;
                    await music.destroySession(guild.id, musicSession);
                    return true;
                }
                const connection = getVoiceConnection(guild.id);
                if (!connection || connection !== identity || connection.joinConfig?.channelId !== channelId) {
                    return false;
                }
                connection.destroy();
                return true;
            }
        });
        const voiceCenterEvents = registerVoiceCenterEvents(client, { service: voiceCenterService });
        cleanupRegistry.add("Voice Center", () => voiceCenterEvents.dispose());

        const disposeInteractionHandlers = registerInteractionHandler(client, {
            voiceManager: voiceManagerRegistration.service,
            voiceStateStore: voiceManagerRegistration.stateStore,
            securityAssistant,
            voiceCenterService,
            ownerId
        });
        cleanupRegistry.add("Interaction Handlers", disposeInteractionHandlers);

        const onClientReady = readyClient => {
            console.log("--------------------------------");
            console.log(`Castorice online sebagai ${readyClient.user.tag}`);
            console.log(`Server terhubung: ${readyClient.guilds.cache.size}`);
            console.log("--------------------------------");
        };
        const onClientError = error => {
            console.error("[Discord Client Error]", error);
        };
        client.once(Events.ClientReady, onClientReady);
        client.on(Events.Error, onClientError);
        cleanupRegistry.add("Discord Client Listeners", () => {
            client.off(Events.ClientReady, onClientReady);
            client.off(Events.Error, onClientError);
        });

        lifecycle = createRuntimeLifecycle({
            server: createHealthServer({
                getHealth: () => {
                    const discordReady = client.isReady();
                    return {
                        status: discordReady ? "ok" : "starting",
                        discord: discordReady ? "ready" : "not_ready",
                        uptime: process.uptime()
                    };
                }
            }),
            client,
            token,
            port: parsePort(),
            host: "0.0.0.0",
            cleanup: () => cleanupRegistry.run()
        });
    } catch (error) {
        logRuntimeError("[Runtime Initialization Error]", error);
        process.exitCode = 1;
        try {
            await cleanupRegistry.run();
        } catch {
            process.exitCode = 1;
        }
        try {
            await client.destroy();
        } catch (destroyError) {
            logRuntimeError("[Discord Shutdown Error]", destroyError);
            process.exitCode = 1;
        }
        return;
    }

    lifecycle.start().catch(() => {
        process.exitCode = 1;
    });
}

void startRuntime().catch(error => {
    logRuntimeError("[Runtime Initialization Error]", error);
    process.exitCode = 1;
});
