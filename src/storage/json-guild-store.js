const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_SCHEMA_VERSION = 1;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function validateGuildId(guildId) {
    const value = String(guildId ?? "");

    if (!/^\d{17,20}$/.test(value)) {
        throw new TypeError("Guild ID harus berupa Snowflake Discord yang valid.");
    }

    return value;
}

function validateCollection(collection) {
    const value = String(collection ?? "");

    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(value)) {
        throw new TypeError("Nama collection tidak valid.");
    }

    return value;
}

function validateSchemaVersion(version) {
    if (!Number.isSafeInteger(version) || version < 1) {
        throw new TypeError("Schema version harus berupa integer positif.");
    }

    return version;
}

class StorageValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "StorageValidationError";
    }
}

class JsonGuildStore {
    constructor({
        rootDir = path.resolve(__dirname, "../../data/storage"),
        maxBytes = DEFAULT_MAX_BYTES
    } = {}) {
        if (typeof rootDir !== "string" || !rootDir.trim()) {
            throw new TypeError("rootDir harus berupa path yang valid.");
        }

        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
            throw new TypeError("maxBytes harus berupa integer positif.");
        }

        this.rootDir = path.resolve(rootDir);
        this.maxBytes = maxBytes;
        this.queues = new Map();
        this.tempFileCounter = 0;
    }

    _getFilePath(guildId, collection) {
        return path.join(
            this.rootDir,
            validateGuildId(guildId),
            `${validateCollection(collection)}.json`
        );
    }

    async _withFileLock(filePath, operation) {
        const previous = this.queues.get(filePath) || Promise.resolve();
        const current = previous.catch(() => {}).then(operation);

        this.queues.set(filePath, current);

        try {
            return await current;
        } finally {
            if (this.queues.get(filePath) === current) {
                this.queues.delete(filePath);
            }
        }
    }

    async _ensureGuildDirectory(guildId) {
        const directory = path.join(this.rootDir, validateGuildId(guildId));
        await fs.mkdir(directory, { recursive: true });

        const [rootRealPath, directoryRealPath] = await Promise.all([
            fs.realpath(this.rootDir),
            fs.realpath(directory)
        ]);
        const expectedDirectory = path.resolve(rootRealPath, guildId);

        if (directoryRealPath !== expectedDirectory) {
            throw new StorageValidationError(
                "Direktori guild tidak sesuai path terisolasi yang diharapkan."
            );
        }

        return directoryRealPath;
    }

    async _getExistingGuildDirectory(guildId) {
        const directory = path.join(this.rootDir, validateGuildId(guildId));
        let stat;

        try {
            stat = await fs.lstat(directory);
        } catch (error) {
            if (error.code === "ENOENT") return null;
            throw error;
        }

        if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw new StorageValidationError(
                "Direktori guild harus berupa direktori biasa."
            );
        }

        const [rootRealPath, directoryRealPath] = await Promise.all([
            fs.realpath(this.rootDir),
            fs.realpath(directory)
        ]);
        const expectedDirectory = path.resolve(rootRealPath, guildId);

        if (directoryRealPath !== expectedDirectory) {
            throw new StorageValidationError(
                "Direktori guild tidak sesuai path terisolasi yang diharapkan."
            );
        }

        return directoryRealPath;
    }

    _validateData(data, validate, context) {
        if (typeof validate !== "function") return;

        let valid;
        try {
            valid = validate(data, context);
        } catch (error) {
            throw new StorageValidationError(
                `Data storage tidak valid: ${error.message}`
            );
        }

        if (valid === false) {
            throw new StorageValidationError("Data storage tidak valid.");
        }
    }

    async _readUnlocked(filePath, guildId, collection, {
        schemaVersion = DEFAULT_SCHEMA_VERSION,
        defaultValue,
        validate
    } = {}) {
        validateSchemaVersion(schemaVersion);

        let fileStat;
        try {
            fileStat = await fs.lstat(filePath);
        } catch (error) {
            if (error.code === "ENOENT") {
                return defaultValue === undefined
                    ? null
                    : structuredClone(defaultValue);
            }
            throw error;
        }

        if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
            throw new StorageValidationError(
                "File storage harus berupa file biasa, bukan symbolic link."
            );
        }

        if (fileStat.size > this.maxBytes) {
            throw new StorageValidationError(
                `Ukuran file storage melebihi batas ${this.maxBytes} byte.`
            );
        }

        let envelope;
        try {
            envelope = JSON.parse(await fs.readFile(filePath, "utf8"));
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new StorageValidationError("File storage berisi JSON yang rusak.");
            }
            throw error;
        }

        if (
            !envelope ||
            typeof envelope !== "object" ||
            Array.isArray(envelope) ||
            envelope.guildId !== guildId ||
            envelope.collection !== collection ||
            envelope.schemaVersion !== schemaVersion ||
            !Object.hasOwn(envelope, "data")
        ) {
            throw new StorageValidationError(
                "Metadata storage tidak sesuai guild, collection, atau schema version."
            );
        }

        this._validateData(envelope.data, validate, {
            guildId,
            collection,
            schemaVersion
        });

        return structuredClone(envelope.data);
    }

    async _writeUnlocked(filePath, guildId, collection, data, {
        schemaVersion = DEFAULT_SCHEMA_VERSION,
        validate
    } = {}) {
        validateSchemaVersion(schemaVersion);
        this._validateData(data, validate, {
            guildId,
            collection,
            schemaVersion
        });

        let serialized;
        try {
            serialized = JSON.stringify({
                schemaVersion,
                guildId,
                collection,
                updatedAt: new Date().toISOString(),
                data
            }, null, 2);
        } catch (error) {
            throw new StorageValidationError(
                `Data storage tidak dapat diserialisasi: ${error.message}`
            );
        }

        if (serialized === undefined) {
            throw new StorageValidationError("Data storage tidak dapat diserialisasi.");
        }

        const byteLength = Buffer.byteLength(serialized, "utf8");
        if (byteLength > this.maxBytes) {
            throw new StorageValidationError(
                `Data storage melebihi batas ${this.maxBytes} byte.`
            );
        }

        const directory = await this._ensureGuildDirectory(guildId);
        const targetPath = path.join(directory, `${collection}.json`);

        try {
            const targetStat = await fs.lstat(targetPath);
            if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
                throw new StorageValidationError(
                    "Target storage harus berupa file biasa."
                );
            }
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }

        const tempPath = path.join(
            directory,
            `.${collection}.${process.pid}.${++this.tempFileCounter}.tmp`
        );

        try {
            await fs.writeFile(tempPath, serialized, {
                encoding: "utf8",
                flag: "wx"
            });
            await fs.rename(tempPath, targetPath);
        } finally {
            await fs.unlink(tempPath).catch(() => {});
        }

        return structuredClone(data);
    }

    async read(guildId, collection, options = {}) {
        guildId = validateGuildId(guildId);
        collection = validateCollection(collection);
        const filePath = this._getFilePath(guildId, collection);

        return this._withFileLock(filePath, async () => {
            const directory = await this._getExistingGuildDirectory(guildId);
            const verifiedFilePath = directory
                ? path.join(directory, `${collection}.json`)
                : filePath;
            return this._readUnlocked(verifiedFilePath, guildId, collection, options);
        });
    }

    async write(guildId, collection, data, options = {}) {
        guildId = validateGuildId(guildId);
        collection = validateCollection(collection);
        const filePath = this._getFilePath(guildId, collection);

        return this._withFileLock(filePath, () =>
            this._writeUnlocked(filePath, guildId, collection, data, options)
        );
    }

    async update(guildId, collection, updater, {
        defaultValue = null,
        schemaVersion = DEFAULT_SCHEMA_VERSION,
        validate
    } = {}) {
        if (typeof updater !== "function") {
            throw new TypeError("updater harus berupa function.");
        }

        guildId = validateGuildId(guildId);
        collection = validateCollection(collection);
        const filePath = this._getFilePath(guildId, collection);

        return this._withFileLock(filePath, async () => {
            const directory = await this._getExistingGuildDirectory(guildId);
            const verifiedFilePath = directory
                ? path.join(directory, `${collection}.json`)
                : filePath;
            const previous = await this._readUnlocked(
                verifiedFilePath,
                guildId,
                collection,
                { schemaVersion, defaultValue, validate }
            );
            const next = await updater(structuredClone(previous));

            if (next === undefined) {
                throw new StorageValidationError(
                    "updater harus mengembalikan data baru."
                );
            }

            return this._writeUnlocked(filePath, guildId, collection, next, {
                schemaVersion,
                validate
            });
        });
    }

    async remove(guildId, collection) {
        guildId = validateGuildId(guildId);
        collection = validateCollection(collection);
        const filePath = this._getFilePath(guildId, collection);

        return this._withFileLock(filePath, async () => {
            const directory = await this._getExistingGuildDirectory(guildId);
            if (!directory) return false;
            const verifiedFilePath = path.join(directory, `${collection}.json`);

            try {
                const stat = await fs.lstat(verifiedFilePath);
                if (stat.isSymbolicLink() || !stat.isFile()) {
                    throw new StorageValidationError(
                        "Target storage harus berupa file biasa."
                    );
                }
                await fs.unlink(verifiedFilePath);
                return true;
            } catch (error) {
                if (error.code === "ENOENT") return false;
                throw error;
            }
        });
    }
}

module.exports = {
    JsonGuildStore,
    StorageValidationError,
    validateGuildId,
    validateCollection
};
