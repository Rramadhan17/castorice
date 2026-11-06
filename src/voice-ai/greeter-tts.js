const path = require("node:path");
const { Readable } = require("node:stream");
const {
    AudioPlayerStatus,
    StreamType,
    VoiceConnectionStatus,
    createAudioPlayer,
    createAudioResource,
    entersState,
    joinVoiceChannel
} = require("@discordjs/voice");
const music = require("../music/manager");

const activeGuilds = new Set();
const MAX_PLAYBACK_MS = 30_000;
const MAX_SYNTHESIS_MS = 15_000;

function loadTtsProvider(modulePath = process.env.VOICE_GREETER_TTS_MODULE) {
    if (!modulePath || !String(modulePath).trim()) return null;
    const resolved = path.isAbsolute(modulePath)
        ? modulePath
        : path.resolve(process.cwd(), modulePath);
    const loaded = require(resolved);
    const provider = loaded.default || loaded;
    if (!provider || typeof provider.synthesize !== "function") {
        throw new TypeError("TTS module must export synthesize(text, context).");
    }
    return provider;
}

function waitForPlayback(player, timeoutMs = MAX_PLAYBACK_MS) {
    let finish;
    const promise = new Promise((resolve, reject) => {
        let timer;
        let settled = false;
        const onStateChange = (oldState, newState) => {
            if (oldState.status !== AudioPlayerStatus.Idle && newState.status === AudioPlayerStatus.Idle) finish();
        };
        const onError = error => finish(error);
        finish = error => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            player.off("stateChange", onStateChange);
            player.off("error", onError);
            if (error) reject(error);
            else resolve();
        };
        player.on("stateChange", onStateChange);
        player.once("error", onError);
        timer = setTimeout(() => finish(new Error("Voice Greeter audio playback timed out.")), timeoutMs);
        timer.unref?.();
    });
    return { promise, cancel: error => finish(error || new Error("Voice Greeter playback cancelled.")) };
}

async function playTtsGreeting({ guild, channel, member, text, provider, runtime = {} }) {
    if (!provider || typeof provider.synthesize !== "function") return { spoken: false, reason: "not_configured" };
    if (!guild?.id || !channel?.id || !member?.id) throw new TypeError("Voice Greeter playback context is incomplete.");
    if (activeGuilds.has(guild.id)) return { spoken: false, reason: "busy" };

    const getMusicSession = runtime.getMusicSession || music.getSession;
    const getVoiceConnection = runtime.getVoiceConnection || (() => null);
    if (getMusicSession(guild.id) || getVoiceConnection(guild.id) || guild.members?.me?.voice?.channelId) {
        return { spoken: false, reason: "voice_busy" };
    }

    const botMember = guild.members?.me;
    const permissions = channel.permissionsFor?.(botMember);
    if (!permissions?.has(["Connect", "Speak"])) return { spoken: false, reason: "missing_permissions" };

    activeGuilds.add(guild.id);
    let connection;
    let player;
    let stream;
    let synthesisTimer;
    try {
        const controller = new AbortController();
        const audio = await Promise.race([
            provider.synthesize(text, { guildId: guild.id, memberId: member.id, signal: controller.signal }),
            new Promise((resolve, reject) => {
                synthesisTimer = setTimeout(() => {
                    controller.abort();
                    reject(new Error("Voice Greeter TTS synthesis timed out."));
                }, runtime.synthesisTimeoutMs ?? MAX_SYNTHESIS_MS);
                synthesisTimer.unref?.();
            })
        ]);
        clearTimeout(synthesisTimer);
        synthesisTimer = null;
        stream = Buffer.isBuffer(audio) ? Readable.from([audio]) : audio;
        if (!(stream instanceof Readable)) throw new TypeError("TTS provider must return a Buffer or Node.js Readable stream.");

        const join = runtime.joinVoiceChannel || joinVoiceChannel;
        const waitReady = runtime.entersState || entersState;
        const makePlayer = runtime.createAudioPlayer || createAudioPlayer;
        const makeResource = runtime.createAudioResource || createAudioResource;
        connection = join({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true
        });
        await waitReady(connection, VoiceConnectionStatus.Ready, 15_000);
        player = makePlayer();
        connection.subscribe(player);
        const resource = makeResource(stream, { inputType: runtime.streamType ?? StreamType.OggOpus });
        const playback = waitForPlayback(player, runtime.playbackTimeoutMs ?? MAX_PLAYBACK_MS);
        try {
            player.play(resource);
        } catch (error) {
            playback.cancel(error);
            throw error;
        }
        await playback.promise;
        return { spoken: true };
    } finally {
        clearTimeout(synthesisTimer);
        player?.stop(true);
        if (stream instanceof Readable && !stream.destroyed) stream.destroy();
        try { connection?.destroy(); } catch {}
        activeGuilds.delete(guild.id);
    }
}

module.exports = { loadTtsProvider, playTtsGreeting, MAX_PLAYBACK_MS, MAX_SYNTHESIS_MS };
