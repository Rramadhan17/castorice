const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const { DEFAULT_EFFECTS } = require("../effects/presets");
const EndpointManager = require("../effects/endpoint-manager");
const EffectsController = require("../effects/controller");
const { buildFilterGraph } = require("../effects/filter-builder");
const { stopProcessPair } = require("./process-lifecycle");
const { createRadioStreamProxy } = require("./radio-stream-proxy");
const { normalizeStreamUrl } = require("./radio-discovery");
const { parseExternalHttpUrl, validateMusicInput } = require("./url-security");
const {
    createYtDlpEgressProxy,
    spawnSecuredYtDlp,
    assertYtDlpEgressIsolation
} = require("./yt-dlp-egress-proxy");
const { getTrackMetadata } = require("./track-resolver");

const effectsEndpointManager = new EndpointManager();

const {
    AudioPlayerStatus,
    VoiceConnectionStatus,
    StreamType,
    createAudioPlayer,
    createAudioResource,
    joinVoiceChannel,
    getVoiceConnections,
    entersState
} = require("@discordjs/voice");

const sessions = new Map();
const sessionLocks = new Map();
const MAX_AUTOPLAY_HISTORY = 10;

function stopSearchProcess(child) {
    stopProcessPair(child, null).catch(error => {
        console.error("[Music Search Cleanup Error]", error.message);
    });
}

async function withSessionLock(guildId, callback) {
    const previous = sessionLocks.get(guildId) || Promise.resolve();

    let release;
    const current = new Promise(resolve => {
        release = resolve;
    });

    sessionLocks.set(guildId, current);
    await previous;

    try {
        return await callback();
    } finally {
        release();

        if (sessionLocks.get(guildId) === current) {
            sessionLocks.delete(guildId);
        }
    }
}
function resolveYtDlpPath({
    platform = process.platform,
    cwd = process.cwd(),
    existsSync = fs.existsSync
} = {}) {
    const winBin = path.join(cwd, "bin", "yt-dlp.exe");
    const nixBin = path.join(cwd, "bin", "yt-dlp");
    if (platform === "win32" && existsSync(winBin)) return winBin;
    if (existsSync(nixBin)) return nixBin;
    return platform === "win32" ? winBin : nixBin;
}
const ytDlpPath = resolveYtDlpPath();
const ffmpegPath = require("ffmpeg-static");
const MAX_QUEUE_SIZE = 100;
const MAX_ENDPOINT_BIND_RETRIES = 2;

async function cleanupTrack(session) {
    const ytProcess = session.ytProcess;
    const ffmpegProcess = session.ffmpegProcess;
    const radioProxy = session.radioStreamProxy;
    const ytDlpProxy = session.ytDlpProxy;

    session.ytProcess = null;
    session.ffmpegProcess = null;
    session.resource = null;
    session.radioStreamProxy = null;
    session.ytDlpProxy = null;

    const errors = [];
    try {
        await stopProcessPair(ytProcess, ffmpegProcess);
    } catch (error) {
        errors.push(error);
    }
    try {
        await radioProxy?.close();
    } catch (error) {
        errors.push(error);
    }
    try {
        await ytDlpProxy?.close();
    } catch (error) {
        errors.push(error);
    }
    if (errors.length) {
        throw new AggregateError(errors, "Music process or network proxy cleanup failed.");
    }
}

async function closeEffectsRuntime(session) {
    const controller = session.effectsController;
    const lease = session.effectsLease;

    session.effectsController = null;
    session.effectsLease = null;

    if (controller) {
        await controller.close();
        return;
    }

    lease?.release();
}
function destroySession(guildId, session) {
    if (!session) return Promise.resolve();
    if (session.destroyPromise) return session.destroyPromise;
    if (session.closed) return Promise.resolve();

    session.closed = true;

    if (sessions.get(guildId) === session) {
        sessions.delete(guildId);
    }

    session.autoplaySearchController?.abort();

    session.destroyPromise = (async () => {
        const cleanupErrors = [];
        try {
            await cleanupTrack(session);
        } catch (error) {
            cleanupErrors.push(error);
            console.error("[Music Process Cleanup Error]", error);
        }

        try {
            await closeEffectsRuntime(session);
        } catch (error) {
            cleanupErrors.push(error);
            console.error("[Effects Runtime Cleanup Error]", error);
        }

        try {
            session.connection.destroy();
        } catch (error) {
            cleanupErrors.push(error);
            console.error("[Voice Connection Cleanup Error]", error);
        }
        session.destroyErrors = cleanupErrors;
    })();

    return session.destroyPromise;
}

async function createSession(guild, member, runtime = {}) {
    return withSessionLock(guild.id, async () => {
        const existing = sessions.get(guild.id);

        if (existing && !existing.closed) {
            if (existing.channelId !== member.voice.channel?.id) {
                throw new Error("Castorice sedang digunakan di voice channel lain.");
            }

            return existing;
        }

        return createSessionUnlocked(guild, member, runtime);
    });
}

async function shutdown() {
    const activeSessions = Array.from(sessions.entries());
    await Promise.all(activeSessions.map(([guildId, session]) =>
        destroySession(guildId, session)
    ));

    const errors = activeSessions.flatMap(([, session]) => session.destroyErrors || []);
    for (const connection of getVoiceConnections().values()) {
        try {
            connection.destroy();
        } catch (error) {
            errors.push(error);
        }
    }
    if (errors.length) {
        throw new AggregateError(errors, "Voice connection shutdown failed.");
    }
}

async function createSessionUnlocked(guild, member, runtime = {}) {
    if (!guild || !member?.voice?.channel) {
        throw new Error("Masuk ke voice channel terlebih dahulu.");
    }

    const ffmpegBinary = runtime.ffmpegPath ?? ffmpegPath;
    const ytDlpBinary = runtime.ytDlpPath ?? ytDlpPath;
    const fileExists = runtime.existsSync || fs.existsSync;
    const joinVoice = runtime.joinVoiceChannel || joinVoiceChannel;
    const waitForVoiceState = runtime.entersState || entersState;
    const makeAudioPlayer = runtime.createAudioPlayer || createAudioPlayer;
    const onTrackFinished = runtime.finishTrack || finishTrack;
    const trackLifecycleRuntime = runtime.trackLifecycleRuntime || {};

    if (!ffmpegBinary) {
        throw new Error("FFmpeg belum tersedia.");
    }

    if (!fileExists(ytDlpBinary)) {
        throw new Error("Binary yt-dlp untuk platform ini tidak ditemukan di folder bin.");
    }

    const channel = member.voice.channel;
    const permissions = channel.permissionsFor(guild.members.me);

    if (!permissions?.has(["Connect", "Speak"])) {
        throw new Error("Castorice membutuhkan izin Connect dan Speak.");
    }

    const connection = joinVoice({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true
    });

    try {
        await waitForVoiceState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
        connection.destroy();
        throw new Error("Gagal terhubung ke voice channel.");
    }

    const player = makeAudioPlayer();

    const session = {
        guildId: guild.id,
        channelId: channel.id,
        connection,
        player,
        currentTrack: null,
        queue: [],
        history: [],
        ytProcess: null,
        ffmpegProcess: null,
        ytDlpProxy: null,
        resource: null,
        volume: 100,
        effects: {
            bass: DEFAULT_EFFECTS.bass,
            spatial: { ...DEFAULT_EFFECTS.spatial },
            stereo: DEFAULT_EFFECTS.stereo,
            radio: DEFAULT_EFFECTS.radio
        },
        effectsController: null,
        effectsLease: null,
        trackOffset: 0,
        transitioning: false,
        resumeAfterSeek: false,
        trackToken: 0,
        startingTrackToken: null,
        finishing: false,
        autoplayEnabled: false,
        autoplaySearchController: null,
        manualTransition: false,
        reconnecting: false,
        closed: false,
        error: null
    };

    connection.subscribe(player);
    sessions.set(guild.id, session);

    connection.on("stateChange", (oldState, newState) => {
        if (newState.status === VoiceConnectionStatus.Disconnected) {
            if (session.reconnecting || session.closed) return;

            session.reconnecting = true;

            Promise.race([
                waitForVoiceState(connection, VoiceConnectionStatus.Signalling, 5_000),
                waitForVoiceState(connection, VoiceConnectionStatus.Connecting, 5_000)
            ]).catch(() => {
                if (
                    !session.closed &&
                    sessions.get(guild.id) === session &&
                    connection.state.status === VoiceConnectionStatus.Disconnected
                ) {
                    session.error = "Koneksi voice terputus.";
                    destroySession(guild.id, session);
                }
            }).finally(() => {
                session.reconnecting = false;
            });
        }

        if (newState.status === VoiceConnectionStatus.Destroyed) {
            destroySession(guild.id, session);
        }
    });

    player.on("stateChange", (oldState, newState) => {
        if (newState.status === AudioPlayerStatus.Playing) {
            session.transitioning = false;
            session.manualTransition = false;
            session.finishing = false;

            if (session.resumeAfterSeek) {
                session.resumeAfterSeek = false;
                session.player.pause();
            }
        }

        if (
            newState.status === AudioPlayerStatus.Idle &&
            oldState.status !== AudioPlayerStatus.Idle &&
            session.startingTrackToken !== session.trackToken &&
            !session.manualTransition &&
            !session.transitioning &&
            !session.closed
        ) {
            onTrackFinished(session, trackLifecycleRuntime).catch(error => {
                console.error("[Music Queue Error]", error);
            });
        }
    });

    player.on("error", error => {
        session.error = error.message;

        if (player.state.status !== AudioPlayerStatus.Idle) {
            player.stop(true);
        }
    });

    return session;
}

async function startTrack(session, track, offsetSeconds = 0, preserveTransition = false, runtime = {}) {
    if (session.closed) {
        throw new Error("Sesi musik sudah ditutup.");
    }
    if (track.radioStream !== true) {
        assertYtDlpEgressIsolation();
    }
    const source = await validateMusicInput(track.source, {
        resolveDns: track.radioStream !== true
    });

    const allocateEndpoint = runtime.allocateEndpoint ||
        (() => effectsEndpointManager.allocate());
    const spawnChild = runtime.spawn || spawn;
    const resolveFilterGraph = runtime.buildFilterGraph || buildFilterGraph;
    const createResource = runtime.createAudioResource || createAudioResource;
    const AudioStreamType = runtime.streamType ?? StreamType.Raw;
    const EffectsControllerClass = runtime.EffectsController || EffectsController;
    const stopChildren = runtime.stopProcessPair || stopProcessPair;
    const openRadioProxy = runtime.createRadioStreamProxy || createRadioStreamProxy;
    const openYtDlpProxy = runtime.createYtDlpEgressProxy || createYtDlpEgressProxy;
    const endpointRetryCount = Number.isSafeInteger(runtime.endpointRetryCount)
        ? runtime.endpointRetryCount
        : 0;

    const token = ++session.trackToken;
    session.startingTrackToken = token;

    if (!preserveTransition) {
        session.finishing = false;
        session.manualTransition = false;
        session.transitioning = false;
    }

    session.error = null;
    session.currentTrack = track;
    session.trackOffset = offsetSeconds;

    let lease = null;
    let controller = null;
    let ytProcess = null;
    let ffmpegProcess = null;
    let radioProxy = null;
    let ytDlpProxy = null;
    let ytError = "";
    let ytBytes = 0;
    let ffmpegError = "";

    try {
        lease = await allocateEndpoint();

        if (session.closed || token !== session.trackToken) {
            throw new Error("Startup track dibatalkan.");
        }

        const filterGraph = resolveFilterGraph(
            session.effects,
            offsetSeconds,
            lease.endpoint
        );

        const radioStream = track.radioStream === true;
        if (radioStream) {
            radioProxy = await openRadioProxy({
                sourceUrl: source,
                ...(runtime.radioProxyOptions || {})
            });
            if (session.closed || token !== session.trackToken) {
                await radioProxy.close();
                radioProxy = null;
                throw new Error("Startup radio dibatalkan.");
            }
            session.radioStreamProxy = radioProxy;
        }
        if (!radioStream) {
            const secured = await spawnSecuredYtDlp(
                runtime.ytDlpPath || ytDlpPath,
                [
                    "--no-playlist",
                    "--no-warnings",
                    "--no-progress",
                    "--quiet",
                    "-f",
                    "bestaudio/best",
                    "-o",
                    "-",
                    "--",
                    source
                ],
                {
                    spawnImpl: spawnChild,
                    proxyFactory: openYtDlpProxy,
                    spawnOptions: {
                        windowsHide: true,
                        stdio: ["ignore", "pipe", "pipe"]
                    }
                }
            );
            ytProcess = secured.child;
            ytDlpProxy = secured.proxy;
            session.ytDlpProxy = ytDlpProxy;
        }

        const ffmpegArgs = ["-hide_banner", "-loglevel", "error"];
        if (radioStream) {
            ffmpegArgs.push(
                "-reconnect", "1",
                "-reconnect_streamed", "1",
                "-reconnect_delay_max", "5"
            );
        }
        ffmpegArgs.push(
            "-i",
            radioStream ? radioProxy.url : "pipe:0",
            "-vn",
            "-af",
            filterGraph,
            "-f",
            "s16le",
            "-ar",
            "48000",
            "-ac",
            "2",
            "pipe:1"
        );
        ffmpegProcess = spawnChild(
            runtime.ffmpegPath || ffmpegPath,
            ffmpegArgs,
            {
                windowsHide: true,
                stdio: [radioStream ? "ignore" : "pipe", "pipe", "pipe"]
            }
        );

        session.ytProcess = ytProcess;
        session.ffmpegProcess = ffmpegProcess;


        ytProcess?.stderr?.on("data", data => {
            ytError = (ytError + data.toString()).slice(-4000);
        });

        ffmpegProcess.stderr.on("data", data => {
            ffmpegError = (ffmpegError + data.toString()).slice(-4000);
        });

        ytProcess?.on("error", () => {
            if (token !== session.trackToken || session.closed) return;

            session.error = "Gagal menjalankan yt-dlp.";

            if (session.player.state.status !== AudioPlayerStatus.Idle) {
                session.player.stop(true);
            }
        });

        ffmpegProcess.on("error", () => {
            if (token !== session.trackToken || session.closed) return;

            session.error = "Gagal menjalankan FFmpeg.";

            if (session.player.state.status !== AudioPlayerStatus.Idle) {
                session.player.stop(true);
            }
        });

        ytProcess?.on("close", code => {
            if (
                code !== 0 &&
                token === session.trackToken &&
                !session.manualTransition &&
                !session.closed
            ) {
                session.error = ytError.trim() || "Link tidak dapat diproses.";

                if (session.player.state.status !== AudioPlayerStatus.Idle) {
                    session.player.stop(true);
                }
            }
        });

        ffmpegProcess.on("close", code => {
            if (
                code !== 0 &&
                token === session.trackToken &&
                !session.manualTransition &&
                !session.closed
            ) {
                session.error = ffmpegError.trim() || "Audio gagal diproses.";

                if (session.player.state.status !== AudioPlayerStatus.Idle) {
                    session.player.stop(true);
                }
            }
        });

        ffmpegProcess.stdin?.on("error", error => {
            if (error.code === "EPIPE") return;
            if (token !== session.trackToken || session.closed) return;

            session.error = `FFmpeg input error: ${error.message}`;

            if (session.player.state.status !== AudioPlayerStatus.Idle) {
                session.player.stop(true);
            }
        });

        ytProcess?.stdout?.on("error", error => {
            if (token !== session.trackToken || session.closed) return;

            session.error = `yt-dlp stream error: ${error.message}`;

            if (session.player.state.status !== AudioPlayerStatus.Idle) {
                session.player.stop(true);
            }
        });

        ytProcess?.stdout?.pipe(ffmpegProcess.stdin);
        ytProcess?.stdout?.on("data", chunk => {
            ytBytes += chunk.length;
        });

        ffmpegProcess.stdout.on("error", () => {});

        const resource = createResource(ffmpegProcess.stdout, {
            inputType: AudioStreamType,
            inlineVolume: true
        });

        resource.volume.setVolume(session.volume / 100);
        session.resource = resource;

        controller = new EffectsControllerClass({
            endpointLease: lease,
            effects: session.effects,
            client: runtime.effectsClient || null,
            onError: error => {
                if (token !== session.trackToken || session.closed) return;

                session.error = `Audio Effects: ${error.message}`;
                console.error("[Effects Runtime Error]", error);
            }
        });

        session.effectsController = controller;
        session.effectsLease = lease;

        await controller.start();

        if (session.closed || token !== session.trackToken) {
            throw new Error("Startup track dibatalkan.");
        }

        session.player.play(resource);

        session.startingTrackToken = null;
    } catch (error) {
        if (session.startingTrackToken === token) {
            if (
                token === session.trackToken &&
                session.player.state.status !== AudioPlayerStatus.Idle
            ) {
                session.player.stop(true);
            }

            session.startingTrackToken = null;
        }

        console.error("[Effects Startup Diagnostics]", {
            endpoint: lease?.endpoint || null,
            ytPid: ytProcess?.pid || null,
            ytBytes,
            ytExitCode: ytProcess?.exitCode ?? null,
            ytSignalCode: ytProcess?.signalCode ?? null,
            ytStderr: ytError.trim() || null,
            ffmpegPid: ffmpegProcess?.pid || null,
            ffmpegExitCode: ffmpegProcess?.exitCode ?? null,
            ffmpegSignalCode: ffmpegProcess?.signalCode ?? null,
            ffmpegStderr: ffmpegError.trim() || null,
            startupError: error.message
        });

        try {
            await stopChildren(ytProcess, ffmpegProcess);
        } catch (cleanupError) {
            console.error("[Music Startup Process Cleanup Error]", cleanupError);
        }
        try {
            await radioProxy?.close();
        } catch (proxyCleanupError) {
            console.error("[Radio Proxy Cleanup Error]", proxyCleanupError);
        }
        try {
            await ytDlpProxy?.close();
        } catch (proxyCleanupError) {
            console.error("[Music Egress Proxy Cleanup Error]", proxyCleanupError);
        }
        if (session.radioStreamProxy === radioProxy) {
            session.radioStreamProxy = null;
        }
        if (session.ytDlpProxy === ytDlpProxy) {
            session.ytDlpProxy = null;
        }

        if (session.ytProcess === ytProcess) {
            session.ytProcess = null;
        }

        if (session.ffmpegProcess === ffmpegProcess) {
            session.ffmpegProcess = null;
        }

        if (controller) {
            if (session.effectsController === controller) {
                try {
                    await closeEffectsRuntime(session);
                } catch (closeError) {
                    console.error("[Effects Startup Cleanup Error]", closeError);
                }
            } else {
                try {
                    await controller.close();
                } catch (closeError) {
                    console.error("[Effects Startup Cleanup Error]", closeError);
                }
            }
        } else {
            lease?.release();
        }

        if (token === session.trackToken) {
            session.ytProcess = null;
            session.ffmpegProcess = null;
            session.resource = null;
            session.currentTrack = null;
        }

        const bindCollision = /EADDRINUSE|address already in use|(?:could not|unable to|failed to) bind/i
            .test(`${ffmpegError}\n${error.message}`);
        if (
            bindCollision &&
            endpointRetryCount < MAX_ENDPOINT_BIND_RETRIES &&
            !session.closed &&
            token === session.trackToken
        ) {
            return startTrack(session, track, offsetSeconds, preserveTransition, {
                ...runtime,
                endpointRetryCount: endpointRetryCount + 1
            });
        }

        throw error;
    }
}
async function finishTrack(session, runtime = {}) {
    if (
        session.finishing ||
        session.manualTransition ||
        session.closed
    ) {
        return;
    }

    session.finishing = true;
    const cleanTrack = runtime.cleanupTrack || cleanupTrack;
    const closeEffects = runtime.closeEffectsRuntime || closeEffectsRuntime;
    const startNextTrack = runtime.startTrack || startTrack;

    const completedTrack = session.currentTrack;
    let processCleanupFailed = false;
    try {
        await cleanTrack(session);
    } catch (error) {
        processCleanupFailed = true;
        session.error = `Music process cleanup failed: ${error.message}`;
        console.error("[Music Process Cleanup Error]", error);
    }

    try {
        await closeEffects(session);
    } catch (error) {
        console.error("[Effects Track Cleanup Error]", error);
    }

    if (processCleanupFailed) {
        session.finishing = false;
        return;
    }

    if (completedTrack) {
        session.history.push(completedTrack);

        if (session.history.length > 50) {
            session.history.shift();
        }
    }

    session.currentTrack = null;

    if (session.autoplayEnabled && completedTrack && session.queue.length === 0 && !session.closed) {
        const controller = new AbortController();
        session.autoplaySearchController = controller;
        try {
            assertYtDlpEgressIsolation();
            const search = runtime.searchTracks || searchTracks;
            const validateInput = runtime.validateMusicInput || validateMusicInput;
            const query = `${completedTrack.artist || ""} similar to ${completedTrack.title || completedTrack.input || ""} songs`
                .trim()
                .slice(0, 180);
            const recommendations = await search(query, { signal: controller.signal });

            if (
                session.autoplaySearchController === controller &&
                !controller.signal.aborted &&
                session.autoplayEnabled &&
                !session.closed &&
                !session.currentTrack &&
                session.queue.length === 0
            ) {
                const recentTracks = [...(session.history || []).slice(-MAX_AUTOPLAY_HISTORY), completedTrack];
                const seenUrls = new Set(recentTracks.map(track =>
                    String(track.webpageUrl || track.source || track.input || "").toLowerCase()
                ));
                const seenTitles = new Set(recentTracks.map(track =>
                    String(track.title || "").trim().toLocaleLowerCase()
                ));

                for (const candidate of Array.isArray(recommendations) ? recommendations : []) {
                    const url = String(candidate?.webpageUrl || "");
                    const title = String(candidate?.title || "").trim();
                    if (
                        !url ||
                        !title ||
                        seenUrls.has(url.toLowerCase()) ||
                        seenTitles.has(title.toLocaleLowerCase())
                    ) continue;

                    try {
                        const source = await validateInput(url);
                        session.queue.push({
                            input: url,
                            source,
                            requestedBy: null,
                            addedAt: Date.now(),
                            title,
                            artist: candidate.artist || "Unknown Artist",
                            duration: candidate.duration ?? null,
                            thumbnail: candidate.thumbnail || null,
                            webpageUrl: url,
                            autoplay: true
                        });
                        break;
                    } catch (error) {
                        session.error = `Autoplay recommendation rejected: ${error.message}`;
                    }
                }
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                session.error = `Autoplay search failed: ${error.message}`;
                console.error("[Music Autoplay Search Error]", error.message);
            }
        } finally {
            if (session.autoplaySearchController === controller) {
                session.autoplaySearchController = null;
            }
        }
    }

    while (session.queue.length > 0 && !session.closed) {
        const nextTrack = session.queue.shift();

        try {
            await startNextTrack(session, nextTrack);
            return;
        } catch (error) {
            session.error = error.message;
            console.error("[Music Track Start Error]", error);
            try {
                await cleanTrack(session);
            } catch (cleanupError) {
                session.error = `Music process cleanup failed: ${cleanupError.message}`;
                console.error("[Music Process Cleanup Error]", cleanupError);
                session.finishing = false;
                return;
            }
            session.currentTrack = null;
        }
    }

    session.finishing = false;
}

function buildSearchQuery(input) {
    let query = String(input || "").trim().slice(0, 180);

    query = query.replace(
        /^(?:tolong\s+)?(?:carikan|cari|putarkan|mainkan|rekomendasikan)\s+/i,
        ""
    );

    query = query.replace(/^(?:lagu|musik)\s+/i, "");

    const expansions = [
        { pattern: /\b(sedih|galau|patah hati)\b/i, term: "sad songs" },
        { pattern: /\b(santai|chill|tenang)\b/i, term: "chill music" },
        { pattern: /\b(semangat|enerjik|energetic)\b/i, term: "upbeat music" },
        { pattern: /\b(romantis|romantic)\b/i, term: "romantic songs" },
        { pattern: /\b(tidur|sleep)\b/i, term: "sleep music" },
        { pattern: /\b(fokus|focus|belajar)\b/i, term: "focus music" }
    ];

    const extra = expansions
        .filter(item => item.pattern.test(query))
        .map(item => item.term);

    return `${query} ${extra.join(" ")}`.trim();
}

async function searchTracks(input, {
    signal,
    spawnImpl = spawn,
    proxyFactory = createYtDlpEgressProxy,
    timeoutMs = 20000,
    maxOutputBytes = 2 * 1024 * 1024
} = {}) {
    assertYtDlpEgressIsolation();
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
        throw new RangeError("Music search timeout must be between 1 and 60000 ms.");
    }
    if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 10 * 1024 * 1024) {
        throw new RangeError("Music search output limit is invalid.");
    }
    const query = buildSearchQuery(input);
    if (!query || signal?.aborted) return [];

    let secured;
    try {
        secured = await spawnSecuredYtDlp(
            ytDlpPath,
            [
                "--flat-playlist",
                "--dump-json",
                "--skip-download",
                "--no-warnings",
                "--no-progress",
                "--quiet",
                "--",
                `ytsearch8:${query}`
            ],
            {
                spawnImpl,
                proxyFactory,
                spawnOptions: { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
            }
        );
    } catch (error) {
        console.error("[Music Search Error]", error.message);
        throw error;
    }
    if (signal?.aborted) {
        stopSearchProcess(secured.child);
        await secured.proxy.close();
        return [];
    }

    return new Promise(resolve => {
        const child = secured.child;
        let timeout;
        let abortListener;
        let settled = false;
        let output = "";
        let outputBytes = 0;

        const finish = results => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (abortListener) signal?.removeEventListener("abort", abortListener);
            Promise.resolve(secured.proxy.close()).then(
                () => resolve(results),
                error => {
                    console.error("[Music Egress Proxy Cleanup Error]", error.message);
                    resolve([]);
                }
            );
        };

        timeout = setTimeout(() => {
            stopSearchProcess(child);
            finish([]);
        }, timeoutMs);
        abortListener = () => {
            stopSearchProcess(child);
            finish([]);
        };
        signal?.addEventListener("abort", abortListener, { once: true });

        child.stdout.on("data", data => {
            outputBytes += data.length;
            if (outputBytes > maxOutputBytes) {
                stopSearchProcess(child);
                finish([]);
                return;
            }
            output += data.toString();
        });

        child.on("error", error => {
            console.error("[Music Search Error]", error.message);
            finish([]);
        });

        child.on("close", code => {
            if (code !== 0 || settled) {
                finish([]);
                return;
            }

            const results = output
                .split(/\r?\n/)
                .filter(Boolean)
                .slice(0, 8)
                .flatMap(line => {
                    try {
                        const item = JSON.parse(line);
                        const candidate = item.webpage_url ||
                            (item.id
                                ? `https://www.youtube.com/watch?v=${item.id}`
                                : null);
                        if (!item.title || !candidate) return [];
                        const url = parseExternalHttpUrl(candidate).toString();

                        return [{
                            title: item.title,
                            artist: item.artist ||
                                item.uploader ||
                                item.channel ||
                                "Unknown Artist",
                            duration: Number.isFinite(item.duration)
                                ? item.duration
                                : null,
                            thumbnail: item.thumbnail || null,
                            webpageUrl: url
                        }];
                    } catch {
                        return [];
                    }
                });

            finish(results);
        });
    });
}
async function addToQueue(guild, member, input, options = {}) {
    if (!guild || !member?.voice?.channel) {
        throw new Error("Masuk ke voice channel terlebih dahulu.");
    }

    const radioStation = options.radioStation || null;
    if (!radioStation) {
        assertYtDlpEgressIsolation();
    }
    const queueInput = radioStation ? radioStation.streamUrl : input;
    const source = await validateMusicInput(queueInput, { resolveDns: !radioStation });

    if (!ffmpegPath || (!radioStation && !fs.existsSync(ytDlpPath))) {
        throw new Error("FFmpeg atau yt-dlp belum tersedia.");
    }

    if (radioStation && !normalizeStreamUrl(source)) {
        throw new Error("URL Radio tidak valid atau alamat lokal tidak diizinkan.");
    }

    let session = sessions.get(guild.id);

    if (session && session.channelId !== member.voice.channel.id) {
        throw new Error("Castorice sedang digunakan di voice channel lain.");
    }

    if (!session) {
        session = await createSession(guild, member);
    }

    if (session.closed || sessions.get(guild.id) !== session) {
        throw new Error("Sesi musik sudah tidak aktif. Coba tambahkan lagu lagi.");
    }

    if (session.queue.length >= MAX_QUEUE_SIZE) {
        throw new Error(`Antrean sudah mencapai batas ${MAX_QUEUE_SIZE} lagu.`);
    }

    const metadata = radioStation
        ? {
            title: String(radioStation.title || "").trim().slice(0, 100),
            artist: [radioStation.country, radioStation.language].filter(Boolean).join(" • ") || "Live Radio",
            duration: null,
            thumbnail: null,
            webpageUrl: source
        }
        : await getTrackMetadata(source, { binary: ytDlpPath });

    if (radioStation && !metadata.title) {
        throw new Error("Nama stasiun radio tidak valid.");
    }

    if (
        session.closed ||
        sessions.get(guild.id) !== session ||
        session.channelId !== member.voice.channel.id
    ) {
        throw new Error("Sesi musik berubah atau sudah ditutup. Coba tambahkan lagu lagi.");
    }

    if (session.queue.length >= MAX_QUEUE_SIZE) {
        throw new Error(`Antrean sudah mencapai batas ${MAX_QUEUE_SIZE} lagu.`);
    }

    const track = {
        input: radioStation ? metadata.title : input.trim(),
        source,
        requestedBy: member.id,
        addedAt: Date.now(),
        title: metadata?.title || input.trim(),
        artist: metadata?.artist || "Unknown Artist",
        duration: metadata?.duration ?? null,
        thumbnail: metadata?.thumbnail || null,
        webpageUrl: metadata?.webpageUrl || input.trim(),
        radioStream: Boolean(radioStation)
    };

    session.queue.push(track);

    let started = false;

    if (
        !session.currentTrack &&
        !session.finishing &&
        session.player.state.status === AudioPlayerStatus.Idle
    ) {
        const nextTrack = session.queue.shift();

        try {
            await startTrack(session, nextTrack);
            started = true;
        } catch (error) {
            session.queue.unshift(nextTrack);
            throw error;
        }
    }

    return {
        track,
        started,
        position: started ? 0 : session.queue.length
    };
}

async function addRadioStation(guild, member, station) {
    const streamUrl = normalizeStreamUrl(station?.streamUrl);
    const title = String(station?.title || "").trim().slice(0, 100);
    if (!streamUrl || !title) {
        throw new Error("Stasiun radio tidak valid atau stream tidak didukung.");
    }

    return addToQueue(guild, member, streamUrl, {
        radioStation: {
            streamUrl,
            title,
            country: station.country,
            language: station.language
        }
    });
}

function pause(guild) {
    const session = sessions.get(guild.id);

    if (!session || !session.player.pause()) {
        throw new Error("Tidak ada musik yang sedang diputar.");
    }
}

function resume(guild) {
    const session = sessions.get(guild.id);

    if (!session || !session.player.unpause()) {
        throw new Error("Musik tidak sedang dalam keadaan pause.");
    }
}

function assertTransitionAvailable(session) {
    if (session.closed) {
        throw new Error("Sesi musik sudah ditutup.");
    }

    if (
        session.transitioning ||
        session.finishing ||
        (session.startingTrackToken !== null && session.startingTrackToken !== undefined)
    ) {
        throw new Error("Transisi musik sedang berlangsung. Coba lagi sebentar.");
    }
}

async function transitionTrack(session, track, offsetSeconds = 0, runtime = {}) {
    assertTransitionAvailable(session);

    const cleanTrack = runtime.cleanupTrack || cleanupTrack;
    const closeEffects = runtime.closeEffectsRuntime || closeEffectsRuntime;
    const startNextTrack = runtime.startTrack || startTrack;
    const recoverQueue = runtime.finishTrack || finishTrack;

    session.transitioning = true;
    session.manualTransition = true;
    session.finishing = true;

    try {
        await cleanTrack(session);
        session.player.stop(true);
        session.currentTrack = null;
        await closeEffects(session);
        await startNextTrack(session, track, offsetSeconds, true);
    } catch (error) {
        session.error = error.message;
        session.transitioning = false;
        session.manualTransition = false;
        session.finishing = false;
        session.resumeAfterSeek = false;

        let processCleanupFailed = false;
        try {
            await cleanTrack(session);
        } catch (cleanupError) {
            processCleanupFailed = true;
            session.error = `Music process cleanup failed: ${cleanupError.message}`;
            console.error("[Music Process Cleanup Error]", cleanupError);
        }
        try {
            await closeEffects(session);
        } catch (closeError) {
            console.error("[Effects Transition Cleanup Error]", closeError);
        }

        if (!processCleanupFailed) {
            recoverQueue(session, runtime.recoveryRuntime || {}).catch(queueError => {
                console.error("[Music Transition Recovery Error]", queueError);
            });
        }

        throw error;
    }
}

function getPosition(session) {
    if (!session?.resource) return session?.trackOffset || 0;

    return session.trackOffset +
        (session.resource.playbackDuration || 0) / 1000;
}

function setVolume(guild, percentage) {
    const session = sessions.get(guild.id);

    if (!session?.currentTrack) {
        throw new Error("Tidak ada musik yang sedang diputar.");
    }

    const value = Number(percentage);

    if (!Number.isFinite(value) || value < 0 || value > 500) {
        throw new Error("Volume harus antara 0 sampai 500.");
    }

    session.volume = Math.round(value);

    if (session.resource?.volume) {
        session.resource.volume.setVolume(session.volume / 100);
    }

    return session.volume;
}

async function seek(guild, seconds, runtime = {}) {
    const session = sessions.get(guild.id);

    if (!session?.currentTrack) {
        throw new Error("Tidak ada lagu yang sedang diputar.");
    }

    if (session.currentTrack.radioStream) {
        throw new Error("Seek tidak tersedia untuk live radio.");
    }

    if (session.closed) {
        throw new Error("Sesi musik sudah ditutup.");
    }

    const delta = Number(seconds);

    if (!Number.isFinite(delta) || Math.abs(delta) > 5) {
        throw new Error("Seek hanya mendukung perpindahan maksimal 5 detik.");
    }

    const prevSeek = session.seekQueue || Promise.resolve();
    let resolveSeek;
    session.seekQueue = new Promise(resolve => { resolveSeek = resolve; });

    const finish = runtime.finishTrack || finishTrack;
    const nextTrack = runtime.next || next;
    const transition = runtime.transitionTrack || transitionTrack;

    try {
        await prevSeek.catch(() => {});

        if (session.closed || !session.currentTrack) {
            throw new Error("Sesi musik berubah atau sudah ditutup.");
        }

        assertTransitionAvailable(session);

        const currentPosition = getPosition(session);
        const trackDuration = Number(session.currentTrack.duration);
        const targetPosition = Math.max(0, currentPosition + delta);

        if (Number.isFinite(trackDuration) && trackDuration > 0 && targetPosition >= trackDuration) {
            if (session.queue.length > 0) {
                await nextTrack(guild);
                return trackDuration;
            } else {
                await finish(session);
                return trackDuration;
            }
        }

        const wasPaused = session.player?.state?.status === AudioPlayerStatus.Paused;
        session.resumeAfterSeek = wasPaused;

        await transition(session, session.currentTrack, targetPosition, runtime);
        return targetPosition;
    } finally {
        resolveSeek();
    }
}

async function next(guild) {
    const session = sessions.get(guild.id);

    if (!session?.currentTrack) {
        throw new Error("Tidak ada lagu yang sedang diputar.");
    }

    assertTransitionAvailable(session);

    const nextTrack = session.queue[0];

    if (!nextTrack) {
        throw new Error("Belum ada lagu berikutnya di antrean.");
    }

    session.queue.shift();
    session.history.push(session.currentTrack);

    if (session.history.length > 50) {
        session.history.shift();
    }

    await transitionTrack(session, nextTrack);
}

async function previous(guild) {
    const session = sessions.get(guild.id);

    if (!session?.history.length) {
        throw new Error("Belum ada lagu sebelumnya.");
    }

    assertTransitionAvailable(session);

    if (session.currentTrack && session.queue.length >= MAX_QUEUE_SIZE) {
        throw new Error("Antrean penuh. Hapus satu lagu sebelum menggunakan Previous.");
    }

    const previousTrack = session.history.pop();

    if (session.currentTrack) {
        session.queue.unshift(session.currentTrack);
    }

    await transitionTrack(session, previousTrack);
}

function removeFromQueue(guild, index) {
    const session = sessions.get(guild.id);

    if (!session || !Number.isInteger(index) || index < 0 || index >= session.queue.length) {
        throw new Error("Lagu yang dipilih tidak ditemukan di antrean.");
    }

    return session.queue.splice(index, 1)[0];
}

function shuffleQueue(guild) {
    const session = sessions.get(typeof guild === "string" ? guild : guild?.id);

    if (!session) {
        throw new Error("Tidak ada sesi musik aktif.");
    }

    for (let i = session.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [session.queue[i], session.queue[j]] = [session.queue[j], session.queue[i]];
    }

    return session.queue.length;
}

function clearQueue(guild) {
    const session = sessions.get(typeof guild === "string" ? guild : guild?.id);

    if (!session) {
        throw new Error("Tidak ada sesi musik aktif.");
    }

    const removed = session.queue.length;
    session.queue = [];

    return removed;
}

function moveInQueue(guild, fromIndex, toIndex) {
    const session = sessions.get(typeof guild === "string" ? guild : guild?.id);

    if (!session) {
        throw new Error("Tidak ada sesi musik aktif.");
    }

    const length = session.queue.length;

    if (
        !Number.isInteger(fromIndex) ||
        !Number.isInteger(toIndex) ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= length ||
        toIndex >= length
    ) {
        throw new Error("Nomor lagu tidak valid atau di luar antrean.");
    }

    const [track] = session.queue.splice(fromIndex, 1);
    session.queue.splice(toIndex, 0, track);

    return track;
}
async function stop(guild) {
    const session = sessions.get(guild.id);

    if (!session) {
        throw new Error("Tidak ada sesi musik aktif.");
    }

    session.manualTransition = true;
    session.queue = [];
    session.currentTrack = null;

    session.player.stop(true);
    await destroySession(guild.id, session);
}

function setAutoplay(guild, enabled) {
    if (typeof enabled !== "boolean") {
        throw new TypeError("Autoplay status must be true or false.");
    }

    const guildId = typeof guild === "string" ? guild : guild?.id;
    const session = sessions.get(guildId);
    if (!session || session.closed) {
        throw new Error("Tidak ada sesi musik aktif.");
    }

    session.autoplayEnabled = enabled;
    if (!enabled) session.autoplaySearchController?.abort();
    return session.autoplayEnabled;
}

function getSession(guild) {
    const guildId = typeof guild === "string" ? guild : guild?.id;
    return sessions.get(guildId) || null;
}

module.exports = {
    searchTracks,
    createSession,
    destroySession,
    startTrack,
    finishTrack,
    transitionTrack,
    addToQueue,
    addRadioStation,
    pause,
    resume,
    next,
    previous,
    seek,
    setVolume,
    setAutoplay,
    getPosition,
    removeFromQueue,
    shuffleQueue,
    clearQueue,
    moveInQueue,
    stop,
    shutdown,
    getSession,
    getSessions: () => sessions,
    resolveYtDlpPath
};
