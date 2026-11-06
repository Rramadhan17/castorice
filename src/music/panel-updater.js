const { buildMusicPanel } = require("../dashboard/menu-panel");
const { buildLyricsPanel } = require("../lyrics/panel");
const { searchLyrics } = require("../lyrics/engine");
const music = require("./manager");

const timers = new Map();
const MUSIC_REFRESH_MS = 5000;
const LYRICS_REFRESH_MS = 1000;
const MAX_LIFETIME_MS = 14 * 60 * 1000;

function getRefreshInterval(mode, playerStatus) {
    return mode === "lyrics" && playerStatus === "playing"
        ? LYRICS_REFRESH_MS
        : MUSIC_REFRESH_MS;
}

function stop(messageId) {
    if (!messageId) return;

    const state = timers.get(messageId);

    if (state?.timer) {
        clearTimeout(state.timer);
    }

    timers.delete(messageId);
}

function getTrackKey(track) {
    if (!track) return null;

    return [
        track.input,
        track.title,
        track.artist
    ].join("|");
}

function getPanel(guild, messageId) {
    const state = timers.get(messageId);

    if (state?.mode === "lyrics") {
        return buildLyricsPanel(guild, state.result, state.translatedLyrics);
    }

    return buildMusicPanel(guild, { notice: state?.notice });
}

function start(interaction, messageId = interaction.message?.id, options = {}) {
    if (!interaction.guild || !messageId || !interaction.channelId) return;

    const previous = timers.get(messageId);
    const session = music.getSession(interaction.guild.id);

    const mode = options.mode || previous?.mode || "music";
    const currentTrackKey = getTrackKey(session?.currentTrack);

    stop(messageId);

    const state = {
        client: interaction.client,
        channelId: interaction.channelId,
        guild: interaction.guild,
        mode,
        notice: options.notice ?? previous?.notice ?? null,
        result: options.result ?? previous?.result ?? null,
        translatedLyrics: options.translatedLyrics ??
            (previous?.trackKey === currentTrackKey ? previous.translatedLyrics : null),
        trackKey: mode === "lyrics" &&
            previous?.mode === "lyrics" &&
            options.result === undefined
                ? previous.trackKey
                : getTrackKey(session?.currentTrack),
        expiresAt: Date.now() + MAX_LIFETIME_MS,
        timer: null,
        lastDescription: null,
        lastEditedAt: 0
    };

    timers.set(messageId, state);

    async function refresh() {
        if (timers.get(messageId) !== state) return;

        if (Date.now() >= state.expiresAt) {
            stop(messageId);
            return;
        }

        try {
            const currentSession = music.getSession(state.guild.id);
            const currentTrack = currentSession?.currentTrack;
            const currentTrackKey = getTrackKey(currentTrack);

            if (state.mode === "lyrics") {
                if (!currentTrack) {
                    state.result = null;
                    state.translatedLyrics = null;
                    state.trackKey = null;
                } else if (currentTrackKey !== state.trackKey) {
                    state.trackKey = currentTrackKey;
                    state.translatedLyrics = null;

                    try {
                        state.result = await searchLyrics(currentTrack);
                    } catch (error) {
                        console.error("[Lyrics Refresh Error]", error);
                        state.result = {
                            found: false,
                            synced: false,
                            lyrics: [],
                            plainLyrics: ""
                        };
                    }
                }
            }

            const channel = await state.client.channels.fetch(
                state.channelId
            );

            if (!channel?.messages) {
                stop(messageId);
                return;
            }

            const message = await channel.messages.fetch(messageId);

            const panel = state.mode === "lyrics"
                ? buildLyricsPanel(state.guild, state.result, state.translatedLyrics)
                : buildMusicPanel(state.guild, { notice: state.notice });

            const currentDesc = panel.embeds?.[0]?.data?.description || "";
            // Edit Discord when content changes (new active line) or after 5 seconds to throttle rate limits
            if (
                state.lastDescription !== currentDesc ||
                !state.lastEditedAt ||
                (Date.now() - state.lastEditedAt >= 5000)
            ) {
                await message.edit(panel);
                state.lastDescription = currentDesc;
                state.lastEditedAt = Date.now();
            }
        } catch (error) {
            console.error("[Music Panel Updater]", error);
            stop(messageId);
            return;
        }

        if (timers.get(messageId) !== state) return;

        const currentSession = music.getSession(state.guild.id);
        const interval = getRefreshInterval(
            state.mode,
            currentSession?.player?.state?.status
        );

        state.timer = setTimeout(refresh, interval);
        state.timer.unref?.();
    }

    const interval = getRefreshInterval(mode, session?.player?.state?.status);

    state.timer = setTimeout(refresh, interval);
    state.timer.unref?.();
}

module.exports = {
    start,
    stop,
    getPanel,
    getRefreshInterval
};
