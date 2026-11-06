const {
    getFeatureState
} = require("../features/feature-manager");

async function checkFeature(guildId, featureId) {
    if (!guildId) {
        return {
            allowed: false,
            reason: "Perintah ini hanya dapat digunakan di server Discord."
        };
    }

    try {
        const state = await getFeatureState(guildId, featureId);

        if (!state.available) {
            return {
                allowed: false,
                reason: `${state.label} belum tersedia.`
            };
        }

        if (!state.enabled) {
            return {
                allowed: false,
                reason: `${state.label} sedang dinonaktifkan oleh pengaturan server.`
            };
        }

        return {
            allowed: true,
            state
        };
    } catch (error) {
        console.error("[FeatureGuard] Gagal memeriksa fitur:", error);

        return {
            allowed: false,
            reason: "Status fitur gagal diperiksa. Silakan coba lagi nanti."
        };
    }
}

async function requireFeature(interaction, featureId) {
    const result = await checkFeature(
        interaction.guildId,
        featureId
    );

    if (result.allowed) {
        return true;
    }

    const payload = {
        content: result.reason,
        ephemeral: true
    };

    if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
    } else {
        await interaction.reply(payload).catch(() => {});
    }

    return false;
}

module.exports = {
    checkFeature,
    requireFeature
};
