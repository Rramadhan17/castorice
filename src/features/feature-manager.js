const fs = require("node:fs/promises");
const path = require("node:path");

const {
    getAllFeatures,
    getFeatureDefinition
} = require("./feature-registry");

const DATA_DIRECTORY = path.resolve(
    __dirname,
    "../../data/guilds"
);

const cache = new Map();
const writeQueues = new Map();

let tempFileCounter = 0;

function validateGuildId(guildId) {
    if (!/^\d{17,20}$/.test(String(guildId))) {
        throw new Error("Guild ID tidak valid.");
    }

    return String(guildId);
}

function getConfigPath(guildId) {
    return path.join(
        DATA_DIRECTORY,
        guildId,
        "features.json"
    );
}

function createDefaultConfig(guildId) {
    const features = {};

    for (const feature of getAllFeatures()) {
        features[feature.id] = feature.enabledByDefault;
    }

    return {
        version: 1,
        guildId,
        updatedAt: new Date().toISOString(),
        features
    };
}

function normalizeConfig(config, guildId) {
    if (
        !config ||
        typeof config !== "object" ||
        Array.isArray(config) ||
        !config.features ||
        typeof config.features !== "object" ||
        Array.isArray(config.features)
    ) {
        throw new Error(
            `Konfigurasi fitur server ${guildId} tidak valid.`
        );
    }

    const normalized = createDefaultConfig(guildId);

    for (const feature of getAllFeatures()) {
        const value = config.features[feature.id];

        if (typeof value === "boolean") {
            normalized.features[feature.id] =
                feature.implemented ? value : false;
        }
    }

    if (typeof config.updatedAt === "string") {
        normalized.updatedAt = config.updatedAt;
    }

    return normalized;
}

async function loadConfig(guildId) {
    if (cache.has(guildId)) {
        return cache.get(guildId);
    }

    const filePath = getConfigPath(guildId);

    try {
        const content = await fs.readFile(filePath, "utf8");
        const parsed = JSON.parse(content);
        const config = normalizeConfig(parsed, guildId);

        cache.set(guildId, config);

        return config;
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }
    }

    const config = createDefaultConfig(guildId);

    await saveConfig(guildId, config);
    cache.set(guildId, config);

    return config;
}

async function saveConfig(guildId, config) {
    const directory = path.dirname(getConfigPath(guildId));
    const filePath = getConfigPath(guildId);

    await fs.mkdir(directory, { recursive: true });

    tempFileCounter += 1;

    const tempPath = path.join(
        directory,
        `features.${process.pid}.${tempFileCounter}.tmp`
    );

    try {
        await fs.writeFile(
            tempPath,
            JSON.stringify(config, null, 4),
            {
                encoding: "utf8",
                flag: "wx"
            }
        );

        await fs.rename(tempPath, filePath);
    } catch (error) {
        await fs.unlink(tempPath).catch(() => {});
        throw error;
    }
}

async function withGuildLock(guildId, operation) {
    const previous = writeQueues.get(guildId) || Promise.resolve();

    const current = previous
        .catch(() => {})
        .then(operation);

    writeQueues.set(guildId, current);

    try {
        return await current;
    } finally {
        if (writeQueues.get(guildId) === current) {
            writeQueues.delete(guildId);
        }
    }
}

async function getGuildConfig(guildId) {
    guildId = validateGuildId(guildId);

    return withGuildLock(guildId, async () => {
        const config = await loadConfig(guildId);

        return structuredClone(config);
    });
}

async function getFeatureState(guildId, featureId) {
    const feature = getFeatureDefinition(featureId);

    if (!feature) {
        throw new Error("Fitur tidak ditemukan.");
    }

    const config = await getGuildConfig(guildId);

    return {
        id: feature.id,
        label: feature.label,
        implemented: feature.implemented,
        enabled: feature.implemented &&
            config.features[feature.id] === true,
        available: feature.implemented
    };
}

async function setFeatureEnabled(guildId, featureId, enabled) {
    guildId = validateGuildId(guildId);

    const feature = getFeatureDefinition(featureId);

    if (!feature) {
        throw new Error("Fitur tidak ditemukan.");
    }

    if (typeof enabled !== "boolean") {
        throw new Error("Status fitur harus berupa ON atau OFF.");
    }

    if (enabled && !feature.implemented) {
        throw new Error(
            `${feature.label} belum tersedia dan belum dapat diaktifkan.`
        );
    }

    return withGuildLock(guildId, async () => {
        const config = await loadConfig(guildId);
        const nextConfig = structuredClone(config);

        nextConfig.features[featureId] = enabled;
        nextConfig.updatedAt = new Date().toISOString();

        await saveConfig(guildId, nextConfig);
        cache.set(guildId, nextConfig);

        return {
            id: feature.id,
            label: feature.label,
            enabled: nextConfig.features[featureId],
            updatedAt: nextConfig.updatedAt
        };
    });
}

module.exports = {
    getGuildConfig,
    getFeatureState,
    setFeatureEnabled
};
