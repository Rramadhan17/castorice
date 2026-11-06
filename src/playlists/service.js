const { JsonGuildStore } = require("../storage/json-guild-store");
const { randomUUID } = require("node:crypto");
const { PermissionFlagsBits } = require("discord.js");

const COLLECTION = "playlists";
const SCHEMA_VERSION = 1;
const MAX_PLAYLISTS = 100;
const MAX_TRACKS = 500;
const MAX_NAME_LENGTH = 80;

function validatePlaylists(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !value.items || typeof value.items !== "object" || Array.isArray(value.items)) {
        return false;
    }

    const names = new Set();
    const items = Object.values(value.items);
    if (items.length > MAX_PLAYLISTS) return false;

    return items.every(playlist => {
        if (!playlist || typeof playlist !== "object" || typeof playlist.name !== "string" || !Array.isArray(playlist.tracks) || playlist.tracks.length > MAX_TRACKS) return false;
        const normalized = playlist.name.trim().toLocaleLowerCase();
        if (!normalized || normalized.length > MAX_NAME_LENGTH || names.has(normalized)) return false;
        names.add(normalized);
        return playlist.tracks.every(track => track && typeof track === "object" && typeof track.input === "string" && track.input.trim().length > 0 && track.input.length <= 2048);
    });
}

function normalizeName(name) {
    if (typeof name !== "string") throw new TypeError("Nama playlist harus berupa teks.");
    const value = name.trim();
    if (!value || value.length > MAX_NAME_LENGTH) throw new RangeError(`Nama playlist harus 1 sampai ${MAX_NAME_LENGTH} karakter.`);
    return value;
}

function normalizeTrack(track) {
    if (typeof track === "string") track = { input: track };
    if (!track || typeof track !== "object" || Array.isArray(track)) throw new TypeError("Track playlist tidak valid.");
    const input = String(track.input || track.url || track.uri || "").trim();
    if (!input || input.length > 2048) throw new RangeError("Track harus memiliki input yang valid (maksimal 2048 karakter).");
    return {
        input,
        title: typeof track.title === "string" ? track.title.slice(0, 256) : input,
        requesterId: /^\d{17,20}$/.test(String(track.requesterId || "")) ? String(track.requesterId) : null
    };
}

function assertManageGuild(guildId, actor) {
    if (
        !actor?.guild?.id ||
        String(actor.guild.id) !== String(guildId) ||
        typeof actor.permissions?.has !== "function" ||
        !actor.permissions.has(PermissionFlagsBits.ManageGuild)
    ) {
        throw new Error("Pengelolaan playlist memerlukan izin Manage Server di server yang sama.");
    }
}

function createPlaylistService({ store = new JsonGuildStore(), now = () => new Date().toISOString() } = {}) {
    const options = { schemaVersion: SCHEMA_VERSION, defaultValue: { items: {} }, validate: validatePlaylists };

    async function read(guildId) {
        return store.read(guildId, COLLECTION, options);
    }

    async function findByName(guildId, name) {
        const playlistName = normalizeName(name).toLocaleLowerCase();
        const data = await read(guildId);
        return Object.values(data.items).find(item => item.name.toLocaleLowerCase() === playlistName) || null;
    }

    async function create(guildId, name, tracks = [], actor) {
        assertManageGuild(guildId, actor);
        const playlistName = normalizeName(name);
        if (!Array.isArray(tracks)) throw new TypeError("Daftar track harus berupa array.");
        const normalizedTracks = tracks.map(normalizeTrack);
        if (normalizedTracks.length > MAX_TRACKS) throw new RangeError(`Playlist dibatasi ${MAX_TRACKS} track.`);
        let created;
        await store.update(guildId, COLLECTION, data => {
            const next = data || { items: {} };
            const duplicate = Object.values(next.items).some(item => item.name.toLocaleLowerCase() === playlistName.toLocaleLowerCase());
            if (duplicate) throw new Error("Nama playlist sudah digunakan di server ini.");
            if (Object.keys(next.items).length >= MAX_PLAYLISTS) throw new RangeError(`Server dibatasi ${MAX_PLAYLISTS} playlist.`);
            created = { id: randomUUID(), name: playlistName, tracks: normalizedTracks, createdAt: now(), updatedAt: now() };
            return { items: { ...next.items, [created.id]: created } };
        }, options);
        return structuredClone(created);
    }

    async function rename(guildId, playlistId, name, actor) {
        assertManageGuild(guildId, actor);
        const playlistName = normalizeName(name);
        let result;
        await store.update(guildId, COLLECTION, data => {
            const next = data || { items: {} };
            const item = next.items[playlistId];
            if (!item) throw new Error("Playlist tidak ditemukan.");
            if (Object.values(next.items).some(other => other.id !== playlistId && other.name.toLocaleLowerCase() === playlistName.toLocaleLowerCase())) throw new Error("Nama playlist sudah digunakan di server ini.");
            result = { ...item, name: playlistName, updatedAt: now() };
            return { items: { ...next.items, [playlistId]: result } };
        }, options);
        return structuredClone(result);
    }

    async function addTracks(guildId, playlistId, tracks, actor) {
        assertManageGuild(guildId, actor);
        if (!Array.isArray(tracks) || tracks.length === 0) throw new TypeError("Minimal satu track harus diberikan.");
        const normalized = tracks.map(normalizeTrack);
        let result;
        await store.update(guildId, COLLECTION, data => {
            const next = data || { items: {} };
            const item = next.items[playlistId];
            if (!item) throw new Error("Playlist tidak ditemukan.");
            if (item.tracks.length + normalized.length > MAX_TRACKS) throw new RangeError(`Playlist dibatasi ${MAX_TRACKS} track.`);
            result = { ...item, tracks: [...item.tracks, ...normalized], updatedAt: now() };
            return { items: { ...next.items, [playlistId]: result } };
        }, options);
        return structuredClone(result);
    }

    async function removeTrack(guildId, playlistId, index, actor) {
        assertManageGuild(guildId, actor);
        if (!Number.isInteger(index) || index < 0) throw new RangeError("Index track tidak valid.");
        let removed;
        await store.update(guildId, COLLECTION, data => {
            const next = data || { items: {} };
            const item = next.items[playlistId];
            if (!item) throw new Error("Playlist tidak ditemukan.");
            if (index >= item.tracks.length) throw new RangeError("Track playlist tidak ditemukan.");
            const tracks = [...item.tracks];
            [removed] = tracks.splice(index, 1);
            return { items: { ...next.items, [playlistId]: { ...item, tracks, updatedAt: now() } } };
        }, options);
        return structuredClone(removed);
    }

    async function remove(guildId, playlistId, actor) {
        assertManageGuild(guildId, actor);
        let found = false;
        await store.update(guildId, COLLECTION, data => {
            const next = data || { items: {} };
            if (!next.items[playlistId]) return next;
            found = true;
            const items = { ...next.items };
            delete items[playlistId];
            return { items };
        }, options);
        return found;
    }

    return { list: read, findByName, create, rename, addTracks, removeTrack, remove };
}

module.exports = { createPlaylistService, validatePlaylists, normalizeTrack };
