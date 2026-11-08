const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_FILE_PATH = path.resolve(__dirname, "../../data/global-ai-settings.json");

function createGlobalAISettings({ filePath = DEFAULT_FILE_PATH } = {}) {
    if (typeof filePath !== "string" || !filePath) {
        throw new TypeError("Global AI settings file path is required.");
    }

    let writeQueue = Promise.resolve();

    async function readSettings() {
        let contents;
        try {
            contents = await fs.readFile(filePath, "utf8");
        } catch (error) {
            if (error.code === "ENOENT") {
                return {
                    version: 1,
                    enabled: false
                };
            }
            throw error;
        }

        let settings;
        try {
            settings = JSON.parse(contents);
        } catch {
            throw new Error("Konfigurasi AI global tidak dapat dibaca.");
        }
        if (!settings || settings.version !== 1 ||
            typeof settings.enabled !== "boolean") {
            throw new Error("Konfigurasi AI global tidak valid.");
        }
        return {
            version: 1,
            enabled: settings.enabled
        };
    }

    async function saveSettings(settings) {
        const directory = path.dirname(filePath);
        await fs.mkdir(directory, { recursive: true });
        const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        try {
            await fs.writeFile(temporaryPath, JSON.stringify(settings, null, 2), {
                encoding: "utf8",
                flag: "wx"
            });
            await fs.rename(temporaryPath, filePath);
        } catch (error) {
            await fs.unlink(temporaryPath).catch(() => {});
            throw error;
        }
    }

    function updateSettings(update) {
        const operation = writeQueue.catch(() => {}).then(async () => {
            const current = await readSettings();
            const next = { version: 1, enabled: update.enabled ?? current.enabled };
            await saveSettings(next);
            return { ...next };
        });
        writeQueue = operation;
        return operation;
    }

    return {
        getSettings: readSettings,
        setEnabled(enabled) {
            if (typeof enabled !== "boolean") {
                throw new TypeError("Global AI status must be a boolean.");
            }
            return updateSettings({ enabled });
        }
    };
}

const globalAISettings = createGlobalAISettings();

module.exports = {
    createGlobalAISettings,
    globalAISettings
};
