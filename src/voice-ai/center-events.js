const { Events } = require("discord.js");

function registerVoiceCenterEvents(client, { service, logger = console } = {}) {
    if (!client?.on || !service) throw new TypeError("client dan Voice Center service wajib diisi.");
    let disposed = false;

    const onVoiceStateUpdate = (oldState, newState) => {
        void service.onVoiceStateUpdate(oldState, newState).catch(error => {
            logger.error?.("[Voice Center] Voice state event gagal.", {
                guildId: String(newState?.guild?.id ?? oldState?.guild?.id ?? ""),
                code: error?.code ?? "operation_failed"
            });
        });
    };

    const onReady = () => {
        if (disposed) return;
        const guilds = client.guilds?.cache;
        if (!guilds) return;
        void service.recoverTimers(guilds).catch(error => {
            logger.error?.("[Voice Center] Pemulihan timer gagal.", {
                code: error?.code ?? "operation_failed"
            });
        });
    };

    try {
        client.on(Events.VoiceStateUpdate, onVoiceStateUpdate);
        client.on(Events.ClientReady, onReady);
    } catch (error) {
        disposed = true;
        client.off?.(Events.VoiceStateUpdate, onVoiceStateUpdate);
        client.off?.(Events.ClientReady, onReady);
        service.dispose?.();
        throw error;
    }

    return {
        dispose() {
            disposed = true;
            client.off?.(Events.VoiceStateUpdate, onVoiceStateUpdate);
            client.off?.(Events.ClientReady, onReady);
            service.dispose();
        },
        onVoiceStateUpdate,
        onReady
    };
}

module.exports = { registerVoiceCenterEvents };
