const fs = require("node:fs/promises");
const path = require("node:path");
const { Events } = require("discord.js");
const { checkFeature } = require("../core/feature-guard");
const { loadTtsProvider, playTtsGreeting } = require("./greeter-tts");

const DATA_DIRECTORY = path.resolve(__dirname, "../../data/guilds");
const COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_GREETING = "Haii {user}, selamat datang di voice! Kenalin, aku AI Server Ras Ultra. Aku diciptakan oleh kyru untuk membantu kalian. Kalau butuh bantuan, aku bisa bantu putar musik, cari lagu, atur volume, bikin private voice, atau nemenin kamu ngobrol. Mau dibantu apa nih?";
const MAX_GREETING_LENGTH = 500;

const cache = new Map();
const loading = new Map();
const writeQueues = new Map();
const activeGreetings = new Set();

let tempFileCounter = 0;

function getFilePath(guildId) {
    return path.join(DATA_DIRECTORY, guildId, "voice-greeter.json");
}

async function getGuildData(guildId) {
    if (!/^\d{1,20}$/.test(String(guildId || ""))) {
        throw new Error("ID server tidak valid.");
    }

    if (cache.has(guildId)) {
        return cache.get(guildId);
    }

    if (loading.has(guildId)) {
        return loading.get(guildId);
    }

    const pending = (async () => {
        let data;

        try {
            const raw = await fs.readFile(getFilePath(guildId), "utf8");
            data = JSON.parse(raw);

            if (
                !data ||
                data.schemaVersion !== 1 ||
                data.guildId !== guildId ||
                !data.cooldowns ||
                typeof data.cooldowns !== "object" ||
                Array.isArray(data.cooldowns)
            ) {
                throw new Error("Data Voice Greeter tidak valid.");
            }
        } catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }

            data = {
                schemaVersion: 1,
                guildId,
                cooldowns: {}
            };
        }

        cache.set(guildId, data);
        return data;
    })();

    loading.set(guildId, pending);

    try {
        return await pending;
    } finally {
        loading.delete(guildId);
    }
}

async function getGreeting(guildId) {
    const data = await getGuildData(guildId);
    return data.greeting || DEFAULT_GREETING;
}

async function setGreeting(guildId, greeting) {
    if (typeof greeting !== "string") {
        throw new Error("Pesan sambutan harus berupa teks.");
    }

    const normalized = greeting.trim();
    if (!normalized || normalized.length > MAX_GREETING_LENGTH) {
        throw new Error(`Pesan sambutan harus berisi 1 sampai ${MAX_GREETING_LENGTH} karakter.`);
    }

    const data = await getGuildData(guildId);
    const previous = data.greeting;
    data.greeting = normalized;

    try {
        await saveGuildData(guildId, data);
    } catch (error) {
        if (previous === undefined) delete data.greeting;
        else data.greeting = previous;
        throw error;
    }

    return normalized;
}

function saveGuildData(guildId, data) {
    const previous = writeQueues.get(guildId) || Promise.resolve();

    const next = previous.catch(() => {}).then(async () => {
        const directory = path.dirname(getFilePath(guildId));
        const filePath = getFilePath(guildId);

        await fs.mkdir(directory, { recursive: true });

        const tempPath =
            `${filePath}.${process.pid}.${++tempFileCounter}.tmp`;

        try {
            await fs.writeFile(
                tempPath,
                JSON.stringify(data, null, 4),
                "utf8"
            );

            await fs.rename(tempPath, filePath);
        } finally {
            await fs.unlink(tempPath).catch(() => {});
        }
    });

    writeQueues.set(guildId, next);

    return next.finally(() => {
        if (writeQueues.get(guildId) === next) {
            writeQueues.delete(guildId);
        }
    });
}

async function handleVoiceStateUpdate(oldState, newState, { ttsProvider = null, voiceRuntime = {} } = {}) {
    if (oldState.channelId || !newState.channelId) return;
    if (!newState.guild || !newState.member) return;
    if (newState.member.user.bot) return;

    const channel = newState.channel;

    if (!channel || typeof channel.send !== "function") return;

    const guildId = newState.guild.id;
    const memberId = newState.id;
    const key = `${guildId}:${memberId}`;
    if (activeGreetings.has(key)) return;
    activeGreetings.add(key);
    const now = Date.now();

    try {
        const feature = await checkFeature(guildId, "voice_greeter");
        if (!feature.allowed) return;

        const data = await getGuildData(guildId);
        const lastGreeting = data.cooldowns[memberId] || 0;

        if (now - lastGreeting < COOLDOWN_MS) return;

        data.cooldowns[memberId] = now;

        try {
            await saveGuildData(guildId, data);
        } catch (error) {
            delete data.cooldowns[memberId];
            throw error;
        }

        const greetingTemplate = data.greeting || DEFAULT_GREETING;
        const greeting = greetingTemplate
            .replace(/@everyone/gi, "@\u200Beveryone")
            .replace(/@here/gi, "@\u200Bhere")
            .replaceAll("{user}", `<@${memberId}>`);

        try {
            await channel.send({
                content: greeting,
                allowedMentions: {
                    parse: [],
                    users: [memberId]
                }
            });
        } catch (error) {
            if (data.cooldowns[memberId] === now) {
                delete data.cooldowns[memberId];
                await saveGuildData(guildId, data);
            }

            throw error;
        }

        if (ttsProvider) {
            const spokenName = newState.member.displayName || newState.member.user.globalName || newState.member.user.username || "anggota baru";
            const spokenText = greetingTemplate
                .replace(/@everyone/gi, "everyone")
                .replace(/@here/gi, "here")
                .replaceAll("{user}", spokenName);
            try {
                await playTtsGreeting({
                    guild: newState.guild,
                    channel,
                    member: newState.member,
                    text: spokenText,
                    provider: ttsProvider,
                    runtime: voiceRuntime
                });
            } catch {
                console.error("[Voice Greeter TTS] Audio greeting failed; the text greeting was sent.");
            }
        }
    } catch (error) {
        console.error("[Voice Greeter Error]", error);
    } finally {
        activeGreetings.delete(key);
    }
}

function registerVoiceGreeter(client, dependencies = {}) {
    let ttsProvider = dependencies.ttsProvider;
    if (ttsProvider === undefined) {
        try {
            ttsProvider = loadTtsProvider();
        } catch {
            ttsProvider = null;
            console.error("[Voice Greeter TTS] Configured provider could not be loaded; using text-only greetings.");
        }
    }
    const listener = (oldState, newState) => handleVoiceStateUpdate(oldState, newState, {
        ttsProvider,
        voiceRuntime: dependencies.voiceRuntime
    });
    client.on(Events.VoiceStateUpdate, listener);
    console.log("[Voice Greeter] Listener berhasil didaftarkan.");
    return () => client.off?.(Events.VoiceStateUpdate, listener);
}

registerVoiceGreeter.handleVoiceStateUpdate = handleVoiceStateUpdate;
registerVoiceGreeter.getGreeting = getGreeting;
registerVoiceGreeter.setGreeting = setGreeting;
registerVoiceGreeter.DEFAULT_GREETING = DEFAULT_GREETING;

module.exports = registerVoiceGreeter;
