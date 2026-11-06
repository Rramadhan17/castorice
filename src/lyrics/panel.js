const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const { AudioPlayerStatus } = require("@discordjs/voice");
const music = require("../music/manager");
const { getActiveLyric } = require("./synchronizer");

function buildLyricsPanel(guild, result, translatedLyrics = null) {
    const session = music.getSession(guild.id);
    const track = session?.currentTrack;
    const status = session?.player?.state?.status;

    const synced = result?.synced && result.lyrics?.length;
    const plainLyrics = result?.plainLyrics || "";

    let description;

    if (!track) {
        description = "Belum ada lagu yang sedang diputar.";
    } else if (result?.instrumental) {
        description = "Lagu ini terdeteksi sebagai instrumental.";
    } else if (synced) {
        const position = music.getPosition(session);
        const active = getActiveLyric(result.lyrics, position);

        const previous = active.previous
            ? `-# ${active.previous.text}`
            : "";

        const current = active.current
            ? `🎤 **${active.current.text}**`
            : "Menunggu baris lirik berikutnya...";

        const translatedCurrent = translatedLyrics?.synchronized &&
            translatedLyrics.alignedLyrics?.[active.index]?.text;
        const translatedCurrentLine = translatedCurrent
            ? `↳ ${translatedCurrent}`
            : "";

        const lineProgress = active.current && active.next
            ? `${"▰".repeat(Math.round(active.progress * 10))}${"▱".repeat(10 - Math.round(active.progress * 10))} ${Math.round(active.progress * 100)}%`
            : active.current
                ? "Baris terakhir"
                : "";

        const next = active.next
            ? `-# ${active.next.text}`
            : "";

        description = [
            previous,
            "",
            current,
            translatedCurrentLine,
            lineProgress,
            "",
            next
        ].filter(Boolean).join("\n");
    } else if (plainLyrics) {
        description = plainLyrics.slice(0, 3500);
    } else {
        description = "Lirik untuk lagu ini belum ditemukan.";
    }

    const embed = new EmbedBuilder()
        .setColor(
            status === AudioPlayerStatus.Playing
                ? 0x57F287
                : 0x5865F2
        )
        .setTitle("Castorice | Lyrics")
        .setDescription(description)
        .addFields({
            name: "Now Playing",
            value: track
                ? `**${track.title || track.input}**\n${track.artist || "Unknown Artist"}`
                : "Tidak ada lagu.",
            inline: false
        })
        .setFooter({
            text: synced
                ? "🎤 Karaoke • progres baris berdasarkan timestamp LRC"
                : "Unsynchronized Lyrics"
        })
        .setTimestamp();

    const navigation = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("castorice:music")
            .setLabel("Back to Player")
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId("castorice:music_seek_back")
            .setLabel("-5s")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!track),

        new ButtonBuilder()
            .setCustomId("castorice:music_seek_forward")
            .setLabel("+5s")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!track)
    );

    const controls = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("castorice:music_previous")
            .setLabel("Previous")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!session?.history.length),

        new ButtonBuilder()
            .setCustomId("castorice:music_pause")
            .setLabel("Pause")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!session || status !== AudioPlayerStatus.Playing),

        new ButtonBuilder()
            .setCustomId("castorice:music_resume")
            .setLabel("Resume")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!session || status !== AudioPlayerStatus.Paused),

        new ButtonBuilder()
            .setCustomId("castorice:music_next")
            .setLabel("Next")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!session?.queue.length)
    );

    const embeds = [embed];
    if (translatedLyrics?.translatedText) {
        let translatedDescription = "";
        for (const character of Array.from(translatedLyrics.translatedText)) {
            if (translatedDescription.length + character.length > 3800) break;
            translatedDescription += character;
        }

        if (translatedDescription.length < translatedLyrics.translatedText.length) {
            translatedDescription += "\n\n-# Terjemahan dipotong agar muat di panel.";
        }

        const translationEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`Translated Lyrics (${translatedLyrics.target})`)
            .setDescription(translatedDescription || "Terjemahan kosong.")
            .setFooter({
                text: translatedLyrics.synchronized
                    ? "Terjemahan tersinkron per baris LRC."
                    : "Terjemahan tidak disinkronkan per baris dengan waktu lagu."
            });
        embeds.push(translationEmbed);
    }

    navigation.addComponents(
        new ButtonBuilder()
            .setCustomId("castorice:lyrics_translate")
            .setLabel("Translate Lyrics → ID")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!track || !(synced || plainLyrics))
    );

    const actions = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("castorice:music_stop")
            .setLabel("Stop")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!session),

        new ButtonBuilder()
            .setCustomId("castorice:home")
            .setLabel("Dashboard")
            .setStyle(ButtonStyle.Primary)
    );

    return {
        embeds,
        components: [navigation, controls, actions]
    };
}

module.exports = { buildLyricsPanel };
