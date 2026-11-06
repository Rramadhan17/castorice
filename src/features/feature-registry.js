const FEATURE_REGISTRY = Object.freeze({
    music: Object.freeze({
        id: "music",
        label: "Music",
        implemented: true,
        enabledByDefault: true
    }),

    translator: Object.freeze({
        id: "translator",
        label: "Translator",
        implemented: true,
        enabledByDefault: true
    }),

    voice_manager: Object.freeze({
        id: "voice_manager",
        label: "Voice Manager",
        implemented: true,
        enabledByDefault: true
    }),

    playlists: Object.freeze({
        id: "playlists",
        label: "Playlists",
        implemented: true,
        enabledByDefault: true
    }),

    voice_greeter: Object.freeze({
        id: "voice_greeter",
        label: "Voice Greeter",
        implemented: true,
        enabledByDefault: true
    }),

    server_templates: Object.freeze({
        id: "server_templates",
        label: "Server Templates",
        implemented: true,
        enabledByDefault: true
    }),

    security_assistant: Object.freeze({
        id: "security_assistant",
        label: "Security Assistant",
        implemented: true,
        enabledByDefault: true
    }),

    kick_voice: Object.freeze({
        id: "kick_voice",
        label: "Kick Voice",
        implemented: false,
        enabledByDefault: false
    }),

    auto_disconnect: Object.freeze({
        id: "auto_disconnect",
        label: "Auto Disconnect",
        implemented: false,
        enabledByDefault: false
    }),

    voice_ai: Object.freeze({
        id: "voice_ai",
        label: "Voice AI",
        implemented: true,
        enabledByDefault: false
    }),

    ai_chat: Object.freeze({
        id: "ai_chat",
        label: "AI Chat",
        implemented: true,
        enabledByDefault: false
    })
});

function getFeatureDefinition(featureId) {
    return FEATURE_REGISTRY[featureId] || null;
}

function getAllFeatures() {
    return Object.values(FEATURE_REGISTRY);
}

module.exports = {
    FEATURE_REGISTRY,
    getFeatureDefinition,
    getAllFeatures
};
