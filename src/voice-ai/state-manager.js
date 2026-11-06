const fs = require("node:fs/promises");
const path = require("node:path");

const DATA_DIRECTORY = path.resolve(__dirname, "../../data/guilds");
const SCHEMA_VERSION = 1;

const cache = new Map();
const writeQueues = new Map();

let tempFileCounter = 0;

const VALID_STATUSES = new Set([
    "creating",
    "active",
    "deletion_pending",
    "deleting",
    "failed",
    "recovery_required"
]);

const UPDATABLE_FIELDS = new Set([
    "ownerId",
    "categoryId",
    "privacy",
    "isLocked",
    "userLimit",
    "status",
    "members",
    "invitedUserIds",
    "pendingDeletionAt"
]);

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function validateId(value, label) {
    if (!/^\d{17,20}$/.test(String(value))) {
        throw new Error(`${label} tidak valid.`);
    }

    return String(value);
}

function getFilePath(guildId) {
    return path.join(DATA_DIRECTORY, guildId, "voice-ai.json");
}

function createDefaultState(guildId) {
    return {
        schemaVersion: SCHEMA_VERSION,
        guildId,
        updatedAt: Date.now(),

        settings: {
            defaultPrivacy: "public",
            defaultUserLimit: 0,
            categoryMode: "both",
            cleanupDelaySeconds: 60,
            autoOwnershipTransfer: true,
            maxChannelsPerMember: 1,
            temporaryCategoryId: null
        },

        temporaryVoices: {}
    };
}

function validateVoiceRecord(channelId, voice) {
    validateId(channelId, "Channel ID");

    if (!voice || typeof voice !== "object" || Array.isArray(voice)) {
        throw new Error("Data temporary voice tidak valid.");
    }

    validateId(voice.ownerId, "Owner ID");
    validateId(voice.createdBy, "Creator ID");

    if (
        voice.categoryId !== null &&
        voice.categoryId !== undefined
    ) {
        validateId(voice.categoryId, "Category ID");
    }

    if (!["public", "private"].includes(voice.privacy)) {
        throw new Error("Privacy temporary voice tidak valid.");
    }

    if (typeof voice.isLocked !== "boolean") {
        throw new Error("Status lock temporary voice tidak valid.");
    }

    if (
        !Number.isInteger(voice.userLimit) ||
        voice.userLimit < 0 ||
        voice.userLimit > 99
    ) {
        throw new Error("User limit harus antara 0 sampai 99.");
    }

    if (!VALID_STATUSES.has(voice.status)) {
        throw new Error("Status temporary voice tidak valid.");
    }

    if (
        !voice.members ||
        typeof voice.members !== "object" ||
        Array.isArray(voice.members)
    ) {
        throw new Error("Data anggota temporary voice tidak valid.");
    }

    for (const [memberId, member] of Object.entries(voice.members)) {
        validateId(memberId, "Member ID");

        if (
            !member ||
            typeof member !== "object" ||
            !Number.isFinite(member.joinedAt) ||
            member.joinedAt < 0
        ) {
            throw new Error("Data waktu bergabung anggota tidak valid.");
        }
    }

    if (!Array.isArray(voice.invitedUserIds)) {
        throw new Error("Data undangan temporary voice tidak valid.");
    }

    for (const userId of voice.invitedUserIds) {
        validateId(userId, "Invited User ID");
    }

    if (
        voice.pendingDeletionAt !== null &&
        voice.pendingDeletionAt !== undefined &&
        (!Number.isFinite(voice.pendingDeletionAt) ||
            voice.pendingDeletionAt < 0)
    ) {
        throw new Error("Waktu cleanup temporary voice tidak valid.");
    }

    if (
        !Number.isFinite(voice.createdAt) ||
        voice.createdAt < 0
    ) {
        throw new Error("Waktu pembuatan temporary voice tidak valid.");
    }
}

function validateState(state, guildId) {
    if (
        !state ||
        typeof state !== "object" ||
        Array.isArray(state) ||
        state.schemaVersion !== SCHEMA_VERSION ||
        state.guildId !== guildId ||
        !state.settings ||
        typeof state.settings !== "object" ||
        !state.temporaryVoices ||
        typeof state.temporaryVoices !== "object" ||
        Array.isArray(state.temporaryVoices)
    ) {
        throw new Error(`State Voice AI server ${guildId} tidak valid.`);
    }

    const settings = state.settings;

    if (!["public", "private"].includes(settings.defaultPrivacy)) {
        throw new Error("Default privacy tidak valid.");
    }

    if (
        !Number.isInteger(settings.defaultUserLimit) ||
        settings.defaultUserLimit < 0 ||
        settings.defaultUserLimit > 99
    ) {
        throw new Error("Default user limit tidak valid.");
    }

    if (!["both", "dedicated", "existing"].includes(settings.categoryMode)) {
        throw new Error("Category mode tidak valid.");
    }

    if (
        !Number.isInteger(settings.cleanupDelaySeconds) ||
        settings.cleanupDelaySeconds < 10 ||
        settings.cleanupDelaySeconds > 3600
    ) {
        throw new Error("Cleanup delay harus antara 10 sampai 3600 detik.");
    }

    if (typeof settings.autoOwnershipTransfer !== "boolean") {
        throw new Error("Pengaturan auto ownership transfer tidak valid.");
    }

    if (
        !Number.isInteger(settings.maxChannelsPerMember) ||
        settings.maxChannelsPerMember < 1 ||
        settings.maxChannelsPerMember > 10
    ) {
        throw new Error("Batas channel per anggota tidak valid.");
    }

    if (
        settings.temporaryCategoryId !== null &&
        settings.temporaryCategoryId !== undefined
    ) {
        validateId(settings.temporaryCategoryId, "Temporary Category ID");
    }

    for (const [channelId, voice] of Object.entries(state.temporaryVoices)) {
        validateVoiceRecord(channelId, voice);
    }

    return state;
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

async function saveUnlocked(guildId, state) {
    validateState(state, guildId);

    const directory = path.dirname(getFilePath(guildId));
    const filePath = getFilePath(guildId);

    await fs.mkdir(directory, { recursive: true });

    tempFileCounter += 1;

    const tempPath = path.join(
        directory,
        `voice-ai.${process.pid}.${tempFileCounter}.tmp`
    );

    const nextState = {
        ...state,
        updatedAt: Date.now()
    };

    try {
        await fs.writeFile(
            tempPath,
            JSON.stringify(nextState, null, 4),
            {
                encoding: "utf8",
                flag: "wx"
            }
        );

        await fs.rename(tempPath, filePath);

        cache.set(guildId, nextState);

        return clone(nextState);
    } catch (error) {
        await fs.unlink(tempPath).catch(() => {});
        throw error;
    }
}

async function loadUnlocked(guildId) {
    if (cache.has(guildId)) {
        return cache.get(guildId);
    }

    const filePath = getFilePath(guildId);

    try {
        const content = await fs.readFile(filePath, "utf8");
        const parsed = JSON.parse(content);

        validateState(parsed, guildId);

        cache.set(guildId, parsed);

        return parsed;
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }
    }

    const initialState = createDefaultState(guildId);
    return saveUnlocked(guildId, initialState);
}

async function getGuildState(guildId) {
    guildId = validateId(guildId, "Guild ID");

    return withGuildLock(guildId, async () => {
        const state = await loadUnlocked(guildId);
        return clone(state);
    });
}

async function getVoiceState(guildId, channelId) {
    guildId = validateId(guildId, "Guild ID");
    channelId = validateId(channelId, "Channel ID");

    return withGuildLock(guildId, async () => {
        const state = await loadUnlocked(guildId);
        const voice = state.temporaryVoices[channelId];

        return voice ? clone(voice) : null;
    });
}

async function createVoiceRecord(guildId, record) {
    guildId = validateId(guildId, "Guild ID");

    if (!record || typeof record !== "object") {
        throw new Error("Data temporary voice wajib diisi.");
    }

    const channelId = validateId(record.channelId, "Channel ID");

    return withGuildLock(guildId, async () => {
        const state = clone(await loadUnlocked(guildId));

        if (state.temporaryVoices[channelId]) {
            throw new Error("Temporary voice sudah terdaftar.");
        }

        const now = Date.now();

        const voice = {
            channelId,
            ownerId: record.ownerId,
            createdBy: record.createdBy,
            categoryId: record.categoryId ?? null,
            privacy: record.privacy ?? state.settings.defaultPrivacy,
            isLocked: record.isLocked ?? false,
            userLimit: record.userLimit ?? state.settings.defaultUserLimit,
            createdAt: record.createdAt ?? now,
            status: record.status ?? "active",
            members: record.members ?? {
                [record.ownerId]: { joinedAt: now }
            },
            invitedUserIds: record.invitedUserIds ?? [],
            pendingDeletionAt: record.pendingDeletionAt ?? null
        };

        validateVoiceRecord(channelId, voice);

        if (!Object.prototype.hasOwnProperty.call(voice.members, voice.ownerId)) {
            throw new Error("Pemilik temporary voice harus terdaftar sebagai anggota.");
        }

        state.temporaryVoices[channelId] = voice;

        const saved = await saveUnlocked(guildId, state);
        return clone(saved.temporaryVoices[channelId]);
    });
}

async function updateVoiceRecord(guildId, channelId, updates) {
    guildId = validateId(guildId, "Guild ID");
    channelId = validateId(channelId, "Channel ID");

    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
        throw new Error("Perubahan data temporary voice tidak valid.");
    }

    for (const key of Object.keys(updates)) {
        if (!UPDATABLE_FIELDS.has(key)) {
            throw new Error(`Field tidak diizinkan untuk diubah: ${key}`);
        }
    }

    return withGuildLock(guildId, async () => {
        const state = clone(await loadUnlocked(guildId));
        const voice = state.temporaryVoices[channelId];

        if (!voice) {
            throw new Error("Temporary voice tidak ditemukan.");
        }

        const updatedVoice = {
            ...voice,
            ...clone(updates)
        };

        validateVoiceRecord(channelId, updatedVoice);

        if (
            updates.ownerId !== undefined &&
            !Object.prototype.hasOwnProperty.call(updatedVoice.members, updatedVoice.ownerId)
        ) {
            throw new Error("Pemilik baru harus menjadi anggota temporary voice.");
        }

        state.temporaryVoices[channelId] = updatedVoice;

        const saved = await saveUnlocked(guildId, state);
        return clone(saved.temporaryVoices[channelId]);
    });
}

async function updateMemberState(guildId, channelId, memberId, joinedAt = null) {
    guildId = validateId(guildId, "Guild ID");
    channelId = validateId(channelId, "Channel ID");
    memberId = validateId(memberId, "Member ID");

    return withGuildLock(guildId, async () => {
        const state = clone(await loadUnlocked(guildId));
        const voice = state.temporaryVoices[channelId];

        if (!voice) {
            throw new Error("Temporary voice tidak ditemukan.");
        }

        if (joinedAt === null) {
            delete voice.members[memberId];

            if (
                memberId === voice.ownerId &&
                state.settings.autoOwnershipTransfer
            ) {
                const remainingMembers = Object.entries(voice.members)
                    .sort((a, b) => {
                        return a[1].joinedAt - b[1].joinedAt ||
                            a[0].localeCompare(b[0]);
                    });

                if (remainingMembers.length > 0) {
                    voice.ownerId = remainingMembers[0][0];
                }
            }
        } else {
            if (!Number.isFinite(joinedAt) || joinedAt < 0) {
                throw new Error("Waktu bergabung tidak valid.");
            }

            voice.members[memberId] = { joinedAt };
        }

        validateVoiceRecord(channelId, voice);

        const saved = await saveUnlocked(guildId, state);
        return clone(saved.temporaryVoices[channelId]);
    });
}
async function transferOwnership(guildId, channelId, newOwnerId) {
    guildId = validateId(guildId, "Guild ID");
    channelId = validateId(channelId, "Channel ID");
    newOwnerId = validateId(newOwnerId, "New Owner ID");

    return withGuildLock(guildId, async () => {
        const state = clone(await loadUnlocked(guildId));
        const voice = state.temporaryVoices[channelId];

        if (!voice) {
            throw new Error("Temporary voice tidak ditemukan.");
        }

        if (!Object.prototype.hasOwnProperty.call(voice.members, newOwnerId)) {
            throw new Error("Anggota tersebut tidak berada di temporary voice.");
        }

        voice.ownerId = newOwnerId;

        validateVoiceRecord(channelId, voice);

        const saved = await saveUnlocked(guildId, state);
        return clone(saved.temporaryVoices[channelId]);
    });
}
async function scheduleDeletion(guildId, channelId, pendingDeletionAt) {
    if (!Number.isFinite(pendingDeletionAt) || pendingDeletionAt < 0) {
        throw new Error("Waktu cleanup tidak valid.");
    }

    return updateVoiceRecord(guildId, channelId, {
        status: "deletion_pending",
        pendingDeletionAt
    });
}

async function cancelDeletion(guildId, channelId) {
    return updateVoiceRecord(guildId, channelId, {
        status: "active",
        pendingDeletionAt: null
    });
}

async function removeVoiceRecord(guildId, channelId) {
    guildId = validateId(guildId, "Guild ID");
    channelId = validateId(channelId, "Channel ID");

    return withGuildLock(guildId, async () => {
        const state = clone(await loadUnlocked(guildId));

        if (!state.temporaryVoices[channelId]) {
            return false;
        }

        delete state.temporaryVoices[channelId];

        await saveUnlocked(guildId, state);

        return true;
    });
}

async function updateGuildSettings(guildId, updates) {
    guildId = validateId(guildId, "Guild ID");

    const allowedFields = new Set([
        "defaultPrivacy",
        "defaultUserLimit",
        "categoryMode",
        "cleanupDelaySeconds",
        "autoOwnershipTransfer",
        "maxChannelsPerMember",
        "temporaryCategoryId"
    ]);

    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
        throw new Error("Perubahan pengaturan tidak valid.");
    }

    for (const key of Object.keys(updates)) {
        if (!allowedFields.has(key)) {
            throw new Error(`Pengaturan tidak dikenal: ${key}`);
        }
    }

    return withGuildLock(guildId, async () => {
        const state = clone(await loadUnlocked(guildId));

        state.settings = {
            ...state.settings,
            ...clone(updates)
        };

        validateState(state, guildId);

        const saved = await saveUnlocked(guildId, state);
        return clone(saved.settings);
    });
}

function clearGuildCache(guildId) {
    guildId = validateId(guildId, "Guild ID");

    if (writeQueues.has(guildId)) {
        throw new Error("Tidak dapat membersihkan cache saat operasi penyimpanan berjalan.");
    }

    return cache.delete(guildId);
}

module.exports = {
    getGuildState,
    getVoiceState,
    createVoiceRecord,
    updateVoiceRecord,
    updateMemberState,
    transferOwnership,
    scheduleDeletion,
    cancelDeletion,
    removeVoiceRecord,
    updateGuildSettings,
    clearGuildCache
};
