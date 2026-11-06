const stateStore = require("./state-manager");
const { createVoiceManager } = require("./manager-service");
const { registerVoiceManagerEvents } = require("./manager-events");
const { registerVoiceManagerInteractions } = require("./interactions");

function registerVoiceManager(client, options = {}) {
    const store = options.stateStore || stateStore;
    const service = options.service || createVoiceManager({
        stateStore: store,
        clock: options.clock
    });
    const events = registerVoiceManagerEvents(client, {
        service,
        stateStore: store,
        logger: options.logger,
        timers: options.timers
    });
    const handleInteraction = registerVoiceManagerInteractions(client, {
        service,
        stateStore: store,
        featureGuard: options.featureGuard,
        logger: options.logger
    });

    return {
        service,
        stateStore: store,
        dispose() {
            events.dispose();
            client.off?.("interactionCreate", handleInteraction);
        }
    };
}

module.exports = registerVoiceManager;
