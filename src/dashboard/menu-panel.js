const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder
} = require("discord.js");

const { AudioPlayerStatus } = require("@discordjs/voice");
const music = require("../music/manager");
const { getGuildConfig } = require("../features/feature-manager");
const { getAllFeatures } = require("../features/feature-registry");
const voiceGreeter = require("../voice-ai/greeter");

const features = [
    { id: "music", label: "Music", implemented: true },
    { id: "translator", label: "Translator", implemented: true },
    { id: "voice_manager", label: "Voice Manager", implemented: true },
    { id: "voice_ai", label: "Voice AI", implemented: true },
    { id: "playlists", label: "Playlists", implemented: true },
    { id: "voice_greeter", label: "Voice Greeter", implemented: true },
    { id: "server_templates", label: "Server Templates", implemented: true },
    { id: "ai_chat", label: "AI", implemented: true },
    { id: "settings", label: "Settings", implemented: true },
    { id: "security_assistant", label: "Security Assistant", implemented: true },
    { id: "owner_panel", label: "Owner Panel", implemented: true }
];

function getVoiceStats(guild) {
    const voiceMembers = guild.voiceStates.cache.filter(
        state => state.channelId && !state.member?.user.bot
    );

    const activeChannels = guild.channels.cache.filter(channel =>
        [
            ChannelType.GuildVoice,
            ChannelType.GuildStageVoice
        ].includes(channel.type) &&
        channel.members.some(member => !member.user.bot)
    );

    return {
        members: voiceMembers.size,
        channels: activeChannels.size,
        botVoice: guild.members.me?.voice?.channel
    };
}

function buildDashboard(guild) {
    const stats = getVoiceStats(guild);
    const session = music.getSession(guild.id);
    const musicStatus = session?.player.state.status;

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Castorice")
        .setDescription(
            "**AI Server Ras Ultra**\n" +
            "Dashboard utama pengelolaan bot."
        )
        .addFields(
            { name: "Bot Status", value: "ONLINE", inline: true },
            {
                name: "Voice Connection",
                value: stats.botVoice
                    ? `CONNECTED - ${stats.botVoice.name}`
                    : "DISCONNECTED",
                inline: true
            },
            { name: "Members in Voice", value: String(stats.members), inline: true },
            { name: "Active Voice Channels", value: String(stats.channels), inline: true },
            {
                name: "Music Streaming",
                value: musicStatus === AudioPlayerStatus.Playing
                    ? "PLAYING"
                    : musicStatus === AudioPlayerStatus.Paused
                        ? "PAUSE"
                        : "Not Streaming",
                inline: true
            },
            { name: "Kick Voice", value: "Belum diaktifkan", inline: true },
            { name: "AI Service", value: "Belum dikonfigurasi", inline: true },
            {
                name: "Now Playing",
                value: session?.currentTrack?.title || session?.currentTrack?.input || "Belum ada lagu diputar.",
                inline: false
            }
        )
        .setFooter({ text: "Castorice | Dashboard" })
        .setTimestamp();

    const rows = [];
    for (let index = 0; index < features.length; index += 3) {
        rows.push(
            new ActionRowBuilder().addComponents(
                features.slice(index, index + 3).map(feature =>
                    new ButtonBuilder()
                        .setCustomId(
                            feature.id === "voice_manager"
                                ? "voice:open"
                                : feature.id === "owner_panel"
                                    ? "owner:open"
                                    : feature.id === "playlists"
                                        ? "castorice:playlists"
                                    : feature.id === "voice_greeter"
                                        ? "castorice:feature_selection"
                                    : `castorice:${feature.id}`
                        )
                        .setLabel(feature.label)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(!feature.implemented)
                )
            )
        );
    }

    return { embeds: [embed], components: rows };
}

function formatMusicTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--";

    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
        : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function buildMusicPanel(guild, options = {}) {
    const session = music.getSession(guild.id);
    const status = session?.player.state.status;
    const track = session?.currentTrack || options.track || null;

    let statusText = "NOT PLAYING";
    let channelText = "Belum terhubung";
    let color = 0x5865F2;

    if (session) {
        channelText = `<#${session.channelId}>`;

        if (status === AudioPlayerStatus.Playing) {
            statusText = "PLAYING";
            color = 0x57F287;
        } else if (status === AudioPlayerStatus.Paused) {
            statusText = "PAUSE";
            color = 0x57F287;
        } else if (track) {
            statusText = "STARTING";
            color = 0xFEE75C;
        } else {
            statusText = "CONNECTED";
        }
    }

    const queue = session?.queue || [];
    const position = track && session?.currentTrack ? music.getPosition(session) : 0;
    const duration = Number.isFinite(track?.duration) && track.duration > 0
        ? track.duration
        : null;

    const safePosition = duration
        ? Math.max(0, Math.min(Number.isFinite(position) ? position : 0, duration))
        : Math.max(0, Number.isFinite(position) ? position : 0);

    const barLength = 18;

    const filled = duration
        ? Math.min(barLength, Math.floor((safePosition / duration) * barLength))
        : 0;

    const progressBar = duration
        ? `${"#".repeat(filled)}${"-".repeat(barLength - filled)}`
        : "LIVE";

    const trackDescription = track
        ? [
            `**${track.title || track.input}**`,
            track.artist || "Unknown Artist",
            "",
            progressBar,
            `\`${formatMusicTime(safePosition)} / ${duration ? formatMusicTime(duration) : "LIVE"}\``
        ].join("\n")
        : "Belum ada lagu yang diputar.";

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle("Castorice | Music Player")
        .setDescription(
            (options.notice ? `**${options.notice}**\n\n` : "") +
            `**Status:** ${statusText}\n` +
            `**Voice Channel:** ${channelText}\n\n` +
            "Tambahkan lagu melalui judul atau link."
        )
        .addFields(
            {
                name: "Now Playing",
                value: trackDescription,
                inline: false
            },
            {
                name: "Queue",
                value: queue.length
                    ? `${queue.length} lagu menunggu diputar.`
                    : "Antrean masih kosong.",
                inline: false
            },
            {
                name: "Volume",
                value: `${session?.volume ?? 100}%`,
                inline: true
            },
            {
                name: "Autoplay",
                value: session?.autoplayEnabled ? "Aktif" : "Nonaktif",
                inline: true
            }
        )
        .setFooter({ text: "Castorice | Music System" })
        .setTimestamp();

    if (track?.thumbnail) {
        try {
            const thumbnailUrl = new URL(track.thumbnail);

            if (["http:", "https:"].includes(thumbnailUrl.protocol)) {
                embed.setThumbnail(thumbnailUrl.toString());
            }
        } catch {}
    }

    const playRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("castorice:music_play")
            .setLabel("Add Music")
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId("castorice:music_queue")
            .setLabel("View Queue")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("castorice:music_search")
            .setLabel("AI Search")
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId("castorice:music_lyrics")
            .setLabel("Lyrics")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(Boolean(track?.radioStream)),

        new ButtonBuilder()
            .setCustomId("castorice:music_radio_search")
            .setLabel("Radio Discovery")
            .setStyle(ButtonStyle.Secondary)
    );

    const seekControls = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("castorice:music_seek_back")
            .setLabel("-5s")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!track || track.radioStream),

        new ButtonBuilder()
            .setCustomId("castorice:music_seek_forward")
            .setLabel("+5s")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!track || track.radioStream)
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
            .setDisabled(!queue.length),

        new ButtonBuilder()
            .setCustomId("castorice:music_autoplay")
            .setLabel(session?.autoplayEnabled ? "Autoplay: On" : "Autoplay: Off")
            .setStyle(session?.autoplayEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setDisabled(!session)
    );

    const volumeOptions = [0, 25, 50, 75, 100, 150, 200, 300, 500].map(value => ({
        label: `${value}%`,
        value: String(value),
        default: session?.volume === value
    }));

    const volumeRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("castorice:music_volume")
            .setPlaceholder(`Volume: ${session?.volume ?? 100}%`)
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(volumeOptions)
            .setDisabled(!track)
    );

    const navigation = new ActionRowBuilder().addComponents(
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
        embeds: [embed],
        components: [playRow, seekControls, controls, volumeRow, navigation]
    };
}
function buildQueuePanel(guild, page = 0) {
    const session = music.getSession(guild.id);
    const queue = session?.queue || [];
    const pageSize = 5;
    const totalPages = Math.max(1, Math.ceil(queue.length / pageSize));
    const currentPage = Math.min(Math.max(0, page), totalPages - 1);
    const start = currentPage * pageSize;
    const pageTracks = queue.slice(start, start + pageSize);

    const description = pageTracks.length
        ? pageTracks.map((track, index) =>
            `**${start + index + 1}.** ${track.input}\nDitambahkan oleh <@${track.requestedBy}>`
        ).join("\n\n")
        : "Antrean masih kosong.";

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Castorice | Music Queue")
        .setDescription(
            `**Now Playing:** ${session?.currentTrack?.input || "Tidak ada"}\n\n` +
            `${description}\n\n` +
            `**Total:** ${queue.length} lagu\n` +
            `**Halaman:** ${currentPage + 1}/${totalPages}`
        )
        .setFooter({ text: queue.length ? "Gunakan tombol Hapus untuk mengeluarkan lagu dari antrean." : "Belum ada lagu dalam antrean." })
        .setTimestamp();

    const components = [];

    if (pageTracks.length) {
        const removeButtons = pageTracks.map((track, index) =>
            new ButtonBuilder()
                .setCustomId(`castorice:queue_delete:${start + index}`)
                .setLabel(`Hapus ${start + index + 1}`)
                .setStyle(ButtonStyle.Danger)
        );

        components.push(
            new ActionRowBuilder().addComponents(removeButtons)
        );
    }

    components.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`castorice:queue_page:${currentPage - 1}`)
                .setLabel("Previous Page")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 0),

            new ButtonBuilder()
                .setCustomId(`castorice:queue_page:${currentPage + 1}`)
                .setLabel("Next Page")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage >= totalPages - 1),

            new ButtonBuilder()
                .setCustomId("castorice:music")
                .setLabel("Music Player")
                .setStyle(ButtonStyle.Primary)
        )
    );

    return { embeds: [embed], components };
}

function buildPlayModal() {
    const input = new TextInputBuilder()
        .setCustomId("music_input")
        .setLabel("Judul lagu atau link")
        .setPlaceholder("Contoh: The Weeknd Blinding Lights atau link YouTube")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(1000);

    return new ModalBuilder()
        .setCustomId("castorice:music_submit")
        .setTitle("Tambah Musik ke Queue")
        .addComponents(
            new ActionRowBuilder().addComponents(input)
        );
}

function buildSearchModal() {
    const input = new TextInputBuilder()
        .setCustomId("music_search_input")
        .setLabel("Cari lagu, artis, atau suasana")
        .setPlaceholder("Contoh: lagu sedih buat malam")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(180);

    return new ModalBuilder()
        .setCustomId("castorice:music_search_submit")
        .setTitle("Castorice AI Music Search")
        .addComponents(
            new ActionRowBuilder().addComponents(input)
        );
}

function buildTranslatorModal({ targetLanguage = "id" } = {}) {
    const text = new TextInputBuilder()
        .setCustomId("translator_text")
        .setLabel("Teks yang akan diterjemahkan")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(4000);

    const source = new TextInputBuilder()
        .setCustomId("translator_source")
        .setLabel("Bahasa sumber (auto untuk deteksi)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue("auto")
        .setMaxLength(16);

    const target = new TextInputBuilder()
        .setCustomId("translator_target")
        .setLabel("Bahasa tujuan (contoh: id, en, tl)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(String(targetLanguage).slice(0, 16))
        .setMaxLength(16);

    return new ModalBuilder()
        .setCustomId("castorice:translator_submit")
        .setTitle("Castorice Translator")
        .addComponents(
            new ActionRowBuilder().addComponents(text),
            new ActionRowBuilder().addComponents(source),
            new ActionRowBuilder().addComponents(target)
        );
}

function buildRadioSearchModal() {
    const input = new TextInputBuilder()
        .setCustomId("radio_search_input")
        .setLabel("Stasiun radio atau nama")
        .setPlaceholder("Contoh: BBC World Service")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

    return new ModalBuilder()
        .setCustomId("castorice:radio_search_submit")
        .setTitle("Castorice Radio Discovery")
        .addComponents(new ActionRowBuilder().addComponents(input));
}

function buildRadioResultsPanel(stations = []) {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Castorice | Radio Discovery")
        .setDescription(
            stations.length
                ? stations.map((station, index) => {
                    const details = [
                        station.country,
                        station.codec,
                        station.bitrate ? `${station.bitrate} kbps` : null
                    ].filter(Boolean).join(" • ");
                    return `**${index + 1}. ${station.title}**${details ? `\n${details}` : ""}`;
                }).join("\n\n")
                : "Stasiun radio tidak ditemukan. Coba nama stasiun lain."
        )
        .setFooter({ text: "Pilih stasiun untuk memutar live stream." })
        .setTimestamp();

    const components = [];
    if (stations.length) {
        const select = new StringSelectMenuBuilder()
            .setCustomId("castorice:music_radio_select")
            .setPlaceholder("Pilih stasiun radio")
            .addOptions(stations.slice(0, 8).map((station, index) => ({
                label: String(station.title || "Unknown Station").slice(0, 100),
                description: [
                    station.country,
                    station.codec,
                    station.bitrate ? `${station.bitrate} kbps` : null
                ].filter(Boolean).join(" • ").slice(0, 100) || "Live radio station",
                value: String(index)
            })));
        components.push(new ActionRowBuilder().addComponents(select));
    }

    components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("castorice:music_open_player")
            .setLabel("Buka Music Player")
            .setStyle(ButtonStyle.Primary)
    ));

    return { embeds: [embed], components };
}

function buildSearchResultsPanel(results = []) {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Castorice | Music Search")
        .setDescription(
            results.length
                ? results.map((track, index) =>
                    `**${index + 1}. ${track.title}**\n${track.artist || "Unknown Artist"}`
                ).join("\n\n")
                : "Tidak ada hasil ditemukan. Coba kata kunci lain."
        )
        .setFooter({ text: "Pilih lagu dari daftar untuk memasukkannya ke Queue." })
        .setTimestamp();

    const components = [];

    if (results.length) {
        const select = new StringSelectMenuBuilder()
            .setCustomId("castorice:music_search_select")
            .setPlaceholder("Pilih lagu yang ingin diputar")
            .addOptions(
                results.slice(0, 8).map((track, index) => ({
                    label: String(track.title || "Unknown Title").slice(0, 100),
                    description: String(track.artist || "Unknown Artist").slice(0, 100),
                    value: String(index)
                }))
            );

        components.push(
            new ActionRowBuilder().addComponents(select)
        );
    }

    components.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("castorice:music_open_player")
                .setLabel("Buka Music Player")
                .setStyle(ButtonStyle.Primary)
        )
    );

    return { embeds: [embed], components };
}
function buildFeaturePanel(featureId) {
    const feature = features.find(item => item.id === featureId);

    if (!feature) return null;

    if (featureId === "translator") {
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle("Castorice | Translator")
            .setDescription(
                "Terjemahkan teks menggunakan provider yang dikonfigurasi server.\n" +
                "Gunakan kode bahasa seperti `auto`, `en`, `id`, atau `tl`."
            )
            .setFooter({ text: "Input dibatasi sesuai konfigurasi provider." })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("castorice:translator_open")
                .setLabel("Terjemahkan Teks")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId("castorice:translator_languages")
                .setLabel("Pilih Bahasa")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId("castorice:home")
                .setLabel("Dashboard")
                .setStyle(ButtonStyle.Secondary)
        );

        return { embeds: [embed], components: [row] };
    }

    if (featureId === "playlists") {
        return {
            embeds: [new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle("Castorice | Playlists")
                .setDescription("Simpan track untuk server ini, lalu putar kembali ke antrean musik.")
                .setFooter({ text: "Perubahan playlist memerlukan izin Manage Server." })
                .setTimestamp()],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("castorice:playlists_refresh:0").setLabel("Buka Playlist").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId("castorice:home").setLabel("Dashboard").setStyle(ButtonStyle.Secondary)
            )]
        };
    }

    if (featureId === "server_templates") {
        return {
            embeds: [new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle("Castorice | Server Templates")
                .setDescription("Simpan struktur server, lalu preview Smart Merge, Clone, Create, atau Rebuild sebelum menerapkannya.")
                .setFooter({ text: "Membuat dan menerapkan template memerlukan Manage Server." })
                .setTimestamp()],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("castorice:templates_open").setLabel("Buka Template Server").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId("castorice:home").setLabel("Dashboard").setStyle(ButtonStyle.Secondary)
            )]
        };
    }

    if (featureId === "security_assistant") {
        return {
            embeds: [new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle("Castorice | Security Assistant")
                .setDescription("Audit role dan permission overwrite channel untuk menemukan izin berisiko. Laporan bersifat informatif; audit tidak mengubah konfigurasi server atau menindak anggota.")
                .setFooter({ text: "Menjalankan audit memerlukan izin Manage Server." })
                .setTimestamp()],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("castorice:security_audit").setLabel("Jalankan Audit").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId("castorice:security_history").setLabel("Riwayat Audit").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId("castorice:security_policy").setLabel("Kebijakan Bot Offline").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId("castorice:home").setLabel("Dashboard").setStyle(ButtonStyle.Secondary)
            )]
        };
    }

    if (featureId === "ai_chat") {
        return {
            embeds: [new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle("Castorice | AI")
                .setDescription(
                    "Aktifkan AI Chat melalui **Settings → Feature Selection**, lalu panggil `@Castorice` atau awali pesan dengan `Castorice:`.\n\n" +
                    "Provider memerlukan konfigurasi `AI_API_KEY`, `AI_MODEL`, dan opsional `AI_BASE_URL` pada environment bot. Riwayat percakapan hanya disimpan sementara di memori dan dapat dihapus dengan `reset percakapan`."
                )
                .setFooter({ text: "Jangan kirim informasi sensitif ke provider AI." })
                .setTimestamp()],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("castorice:settings").setLabel("Settings").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId("castorice:home").setLabel("Dashboard").setStyle(ButtonStyle.Secondary)
            )]
        };
    }

    if (featureId === "voice_ai") {
        return {
            embeds: [new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle("Castorice | Voice AI")
                .setDescription(
                    "Aktifkan **Voice AI** melalui **Settings → Feature Selection**. Setelah itu, masuk ke voice channel dan gunakan `@Castorice voice ai <pertanyaan>` atau `Castorice: jawab pakai suara <pertanyaan>`.\n\n" +
                    "Fitur ini menghasilkan jawaban AI lalu membacakannya melalui TTS. Konfigurasikan AI_API_KEY, AI_MODEL, dan VOICE_GREETER_TTS_MODULE terlebih dahulu. Audio tidak akan memotong sesi musik atau koneksi voice bot yang sudah aktif."
                )
                .setFooter({ text: "Tidak menyediakan speech recognition atau live conversation." })
                .setTimestamp()],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("castorice:settings").setLabel("Settings").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId("castorice:home").setLabel("Dashboard").setStyle(ButtonStyle.Secondary)
            )]
        };
    }

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`Castorice | ${feature.label}`)
        .setDescription(
            `Halaman **${feature.label}**.\n\n` +
            "Modul ini belum diaktifkan. Fungsi lengkapnya akan " +
            "dibangun pada tahap pengembangan berikutnya."
        )
        .setFooter({ text: "Castorice | Feature Panel" })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("castorice:home")
            .setLabel("Kembali ke Dashboard")
            .setStyle(ButtonStyle.Primary)
    );

    return { embeds: [embed], components: [row] };
}

function buildSecurityReportPanel(report) {
    const findings = report.findings.slice(0, 12).map(finding =>
        `**[${finding.severity.toUpperCase()}] ${finding.title}**\n${finding.detail}`
    );
    const summary = report.summary;
    const policyDecisions = report.offlinePolicy?.decisions || [];
    const policySummary = report.offlinePolicy?.enabled
        ? `Offline alert-only: ${policyDecisions.filter(item => item.type === "offline_policy_alert_candidate").length} kandidat alert dari presence cache eksplisit; unknown bukan bukti offline. Tidak ada tindakan anggota.`
        : "Kebijakan offline alert-only nonaktif; status presence hanya dilaporkan sebagai snapshot cache.";
    const embed = new EmbedBuilder()
        .setColor(summary.critical ? 0xED4245 : summary.high ? 0xFEE75C : 0x57F287)
        .setTitle("Castorice | Security Audit")
        .setDescription([
            `Waktu: ${report.scannedAt}`,
            `**${summary.critical} critical • ${summary.high} high • ${summary.medium} medium • ${summary.low} low**`,
            report.botPresence
                ? `Bot di cache (${report.botPresence.cachedBots}): online ${report.botPresence.online} • idle ${report.botPresence.idle} • DND ${report.botPresence.dnd} • offline/invisible ${report.botPresence.offlineOrInvisible} • tidak diketahui ${report.botPresence.unknown}.`
                : "Data presence bot tidak tersedia pada laporan ini.",
            "Presence hanya mencerminkan data gateway/cache yang tersedia; offline/invisible tidak membuktikan bot mati dan tidak ada tindakan otomatis.",
            policySummary,
            "",
            ...(findings.length ? findings : ["Tidak ada temuan berdasarkan aturan audit saat ini."]),
            summary.total > findings.length ? `\n...dan ${summary.total - findings.length} temuan lainnya.` : "",
            "\nAudit ini hanya menghasilkan laporan. Tidak ada perubahan server atau tindakan otomatis."
        ].filter(Boolean).join("\n"))
        .setFooter({ text: `Report ID: ${report.id}` })
        .setTimestamp();
    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("castorice:security_audit").setLabel("Audit Ulang").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("castorice:home").setLabel("Dashboard").setStyle(ButtonStyle.Primary)
        )]
    };
}

function buildSecurityHistoryPanel(reports = []) {
    const lines = reports.slice(0, 10).map(report => {
        const { critical, high, medium, low } = report.summary;
        return `• **${report.scannedAt}** — ${critical} critical, ${high} high, ${medium} medium, ${low} low\n  Report ID: \`${report.id}\``;
    });
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Castorice | Security Audit History")
        .setDescription(lines.length ? lines.join("\n") : "Belum ada riwayat audit keamanan untuk server ini.")
        .setFooter({ text: "Riwayat berisi maksimal 20 laporan per server; audit hanya membaca dan melaporkan." })
        .setTimestamp();
    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("castorice:security_audit").setLabel("Jalankan Audit").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("castorice:home").setLabel("Dashboard").setStyle(ButtonStyle.Primary)
        )]
    };
}

function buildSecurityPolicyModal(policy) {
    const enabled = new TextInputBuilder()
        .setCustomId("security_policy_enabled")
        .setLabel("Monitoring alert-only (ON atau OFF)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(3)
        .setValue(policy.enabled ? "ON" : "OFF");
    const threshold = new TextInputBuilder()
        .setCustomId("security_policy_threshold")
        .setLabel("Threshold offline (menit, 5-10080)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(5)
        .setValue(String(policy.thresholdMinutes));
    const gap = new TextInputBuilder()
        .setCustomId("security_policy_gap")
        .setLabel("Jarak sampel maksimum (menit, 1-60)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(2)
        .setValue(String(policy.maxObservationGapMinutes));
    const excluded = new TextInputBuilder()
        .setCustomId("security_policy_excluded")
        .setLabel("ID bot dikecualikan (pisahkan koma)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(2000)
        .setValue(policy.excludedBotIds.join(", "));
    return new ModalBuilder()
        .setCustomId("castorice:security_policy_submit")
        .setTitle("Kebijakan Offline Bot")
        .addComponents(
            new ActionRowBuilder().addComponents(enabled),
            new ActionRowBuilder().addComponents(threshold),
            new ActionRowBuilder().addComponents(gap),
            new ActionRowBuilder().addComponents(excluded)
        );
}

function buildSecurityPolicyPreviewPanel(policy, confirmationId, requesterId) {
    const exclusions = policy.excludedBotIds.length
        ? policy.excludedBotIds.map(id => `\`${id}\``).join(", ")
        : "Tidak ada";
    const embed = new EmbedBuilder()
        .setColor(policy.enabled ? 0xFEE75C : 0x5865F2)
        .setTitle("Castorice | Preview Kebijakan Offline")
        .setDescription([
            `Monitoring alert-only: **${policy.enabled ? "AKTIF" : "NONAKTIF"}**`,
            `Threshold: **${policy.thresholdMinutes} menit**`,
            `Jarak sampel maksimum: **${policy.maxObservationGapMinutes} menit**`,
            `Bot dikecualikan: ${exclusions}`,
            "",
            "Aktivasi hanya menghasilkan kandidat alert dari sampel presence eksplisit dan berurutan. Missing/unknown presence mereset kontinuitas. Bot tidak akan dikeluarkan, diban, atau diubah.",
            "Discord presence cache bukan bukti bot mati dan audit manual bukan pemantauan kontinu."
        ].join("\n"))
        .setFooter({ text: "Konfirmasi administrator berlaku 5 menit." })
        .setTimestamp();
    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`castorice:security_policy_confirm:${confirmationId}:${requesterId}`)
                .setLabel(policy.enabled ? "Konfirmasi Kebijakan" : "Konfirmasi Nonaktifkan")
                .setStyle(policy.enabled ? ButtonStyle.Danger : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId("castorice:home")
                .setLabel("Batal")
                .setStyle(ButtonStyle.Secondary)
        )]
    };
}

function buildServerTemplatesPanel(guildId, templates = [], notice = "") {
    const lines = templates.length
        ? templates.map(template =>
            `• **${template.name}** — ${template.roleCount} role, ${template.channelCount} channel\n  ID: \`${template.id}\` • sumber: \`${template.sourceGuildId}\``
        ).join("\n")
        : "Belum ada template tersimpan. Buat snapshot server ini atau preview template dari server lain.";
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Castorice | Server Templates")
        .setDescription(`${notice ? `**${notice}**\n\n` : ""}${lines}`.slice(0, 4000))
        .setFooter({ text: `Server target: ${guildId} • perubahan struktur selalu melalui preview` })
        .setTimestamp();
    const components = [];
    if (templates.length) {
        components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId("castorice:template_delete_select")
                .setPlaceholder("Pilih template untuk dihapus")
                .addOptions(templates.slice(0, 25).map(template => ({
                    label: template.name.slice(0, 100),
                    description: `${template.roleCount} role • ${template.channelCount} channel`,
                    value: template.id
                })))
        ));
    }
    components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("castorice:template_create").setLabel("Simpan Snapshot").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("castorice:template_preview_open").setLabel("Preview / Terapkan").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("castorice:templates_refresh").setLabel("Refresh").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("castorice:home").setLabel("Dashboard").setStyle(ButtonStyle.Secondary)
    ));
    return {
        embeds: [embed],
        components
    };
}

function buildServerTemplateDeleteConfirmPanel(template, confirmationId, requesterId) {
    const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle("Konfirmasi Hapus Template")
        .setDescription(`Hapus template **${template.name}** secara permanen dari penyimpanan server ini? Tindakan ini tidak mengubah channel atau role Discord.`)
        .setFooter({ text: "Konfirmasi hanya berlaku untuk peminta selama lima menit." })
        .setTimestamp();
    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`castorice:template_delete_confirm:${confirmationId}:${requesterId}`)
                .setLabel("Konfirmasi Hapus")
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`castorice:template_delete_cancel:${confirmationId}:${requesterId}`)
                .setLabel("Batal")
                .setStyle(ButtonStyle.Secondary)
        )]
    };
}

function buildServerTemplateCreateModal() {
    const modal = new ModalBuilder()
        .setCustomId("castorice:template_create_submit")
        .setTitle("Simpan Snapshot Server");
    const input = new TextInputBuilder()
        .setCustomId("template_name")
        .setLabel("Nama template")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50);
    return modal.addComponents(new ActionRowBuilder().addComponents(input));
}

function buildServerTemplatePreviewModal(previewMode = "smart_merge") {
    if (!["create", "rebuild", "clone", "smart_merge"].includes(previewMode)) {
        throw new Error("Mode template tidak valid.");
    }
    const modal = new ModalBuilder()
        .setCustomId("castorice:template_preview_submit")
        .setTitle("Preview Server Template");
    const sourceGuild = new TextInputBuilder()
        .setCustomId("template_source_guild")
        .setLabel("ID server sumber")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(17)
        .setMaxLength(20);
    const templateId = new TextInputBuilder()
        .setCustomId("template_id")
        .setLabel("ID template")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(128);
    const mode = new TextInputBuilder()
        .setCustomId("template_mode")
        .setLabel("Mode: create / clone / smart_merge / rebuild")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
        .setValue(previewMode);
    return modal.addComponents(
        new ActionRowBuilder().addComponents(sourceGuild),
        new ActionRowBuilder().addComponents(templateId),
        new ActionRowBuilder().addComponents(mode)
    );
}

function buildServerTemplatePreviewPanel(plan, previewId, requesterId, confirmationPhrase) {
    const summary = plan.summary;
    const warnings = plan.warnings?.length
        ? `\n\n**Peringatan**\n${plan.warnings.slice(0, 5).map(value => `• ${value}`).join("\n")}`
        : "";
    const embed = new EmbedBuilder()
        .setColor(plan.mode === "rebuild" ? 0xED4245 : 0x5865F2)
        .setTitle(`Preview ${plan.mode}: ${plan.templateName}`)
        .setDescription(
            `Target server ID: ${plan.targetGuildId}\n` +
            `Role: ${summary.create} buat, ${summary.update} ubah, ${summary.preserve} pertahankan.\n` +
            `Channel: ${plan.channels.filter(item => item.action === "create").length} buat, ` +
            `${plan.channels.filter(item => item.action === "update").length} ubah, ` +
            `${plan.channels.filter(item => item.action === "delete").length} hapus.` + warnings +
            `\n\nKonfirmasi dengan tombol ini akan menjalankan: \`${confirmationPhrase}\`.`
        )
        .setFooter({ text: "Preview terikat pada kondisi target saat ini dan kedaluwarsa dalam 5 menit." })
        .setTimestamp();
    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`castorice:template_apply:${previewId}:${requesterId}`)
                .setLabel(`Konfirmasi ${plan.mode}`.slice(0, 80))
                .setStyle(plan.mode === "rebuild" ? ButtonStyle.Danger : ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId("castorice:home")
                .setLabel("Batal")
                .setStyle(ButtonStyle.Secondary)
        )]
    };
}

function buildTranslatorLanguagePanel(languages, page = 0) {
    if (!Array.isArray(languages) || !languages.length) {
        throw new TypeError("Translator language options must be a non-empty array.");
    }

    const pageSize = 25;
    const pageCount = Math.ceil(languages.length / pageSize);
    const currentPage = Number.isInteger(page)
        ? Math.max(0, Math.min(page, pageCount - 1))
        : 0;
    const options = languages
        .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
        .map(language => ({
            label: String(language.name).slice(0, 100),
            value: String(language.code),
            description: String(language.code).slice(0, 100)
        }));
    const components = [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("castorice:translator_language_select")
            .setPlaceholder("Pilih bahasa tujuan")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(options)
    )];

    if (pageCount > 1) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`castorice:translator_languages_page:${currentPage - 1}`)
                .setLabel("Sebelumnya")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 0),
            new ButtonBuilder()
                .setCustomId(`castorice:translator_languages_page:${currentPage + 1}`)
                .setLabel("Berikutnya")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage >= pageCount - 1)
        ));
    }

    return {
        content: `Pilih bahasa tujuan (halaman ${currentPage + 1}/${pageCount}).`,
        components
    };
}

function buildPlaylistCreateModal() {
    const modal = new ModalBuilder()
        .setCustomId("castorice:playlist_create_submit")
        .setTitle("Buat Playlist Server");

    const name = new TextInputBuilder()
        .setCustomId("playlist_name")
        .setLabel("Nama playlist")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80);
    const tracks = new TextInputBuilder()
        .setCustomId("playlist_tracks")
        .setLabel("Track atau URL, satu per baris")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(4000);

    modal.addComponents(
        new ActionRowBuilder().addComponents(name),
        new ActionRowBuilder().addComponents(tracks)
    );
    return modal;
}

function buildPlaylistEditModal(action, playlistId) {
    if (!new Set(["rename", "add"]).has(action) || typeof playlistId !== "string") {
        throw new TypeError("Operasi playlist tidak valid.");
    }
    const isRename = action === "rename";
    const modal = new ModalBuilder()
        .setCustomId(`castorice:playlist_${action}_submit:${playlistId}`)
        .setTitle(isRename ? "Ubah Nama Playlist" : "Tambah Track Playlist");
    const field = new TextInputBuilder()
        .setCustomId(isRename ? "playlist_name" : "playlist_tracks")
        .setLabel(isRename ? "Nama playlist baru" : "Track atau URL, satu per baris")
        .setStyle(isRename ? TextInputStyle.Short : TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(isRename ? 80 : 4000);
    modal.addComponents(new ActionRowBuilder().addComponents(field));
    return modal;
}

function buildPlaylistPanel(guildId, playlistData, page = 0, notice = "") {
    const playlists = Object.values(playlistData?.items || {}).sort((a, b) => a.name.localeCompare(b.name));
    const pageSize = 6;
    const pageCount = Math.max(1, Math.ceil(playlists.length / pageSize));
    const safePage = Math.min(Math.max(0, Number.isInteger(page) ? page : 0), pageCount - 1);
    const visible = playlists.slice(safePage * pageSize, (safePage + 1) * pageSize);
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Castorice | Playlist Server")
        .setDescription(`${notice ? `**${notice}**\n\n` : ""}${playlists.length ? `Tersimpan: **${playlists.length}** playlist. Pilih aksi untuk playlist yang ingin dikelola.` : "Belum ada playlist. Buat playlist dengan daftar URL atau judul, satu per baris."}`)
        .setFooter({ text: `Halaman ${safePage + 1}/${pageCount} • Playlist server` })
        .setTimestamp();
    const rows = [];
    if (visible.length) {
        rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`castorice:playlist_manage_select:${safePage}`)
                .setPlaceholder("Pilih aksi playlist")
                .addOptions(visible.flatMap(playlist => [
                    { label: `Putar · ${playlist.name}`.slice(0, 100), description: `${playlist.tracks.length} track`, value: `play:${playlist.id}` },
                    { label: `Tambah track · ${playlist.name}`.slice(0, 100), description: "Manage Server diperlukan", value: `add:${playlist.id}` },
                    { label: `Ubah nama · ${playlist.name}`.slice(0, 100), description: "Manage Server diperlukan", value: `rename:${playlist.id}` },
                    { label: `Hapus · ${playlist.name}`.slice(0, 100), description: "Manage Server dan konfirmasi diperlukan", value: `delete:${playlist.id}` }
                ]))
        ));
    }
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("castorice:playlist_create").setLabel("Buat Playlist").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`castorice:playlists_refresh:${Math.max(0, safePage - 1)}`).setLabel("Sebelumnya").setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
        new ButtonBuilder().setCustomId(`castorice:playlists_refresh:${Math.min(pageCount - 1, safePage + 1)}`).setLabel("Berikutnya").setStyle(ButtonStyle.Secondary).setDisabled(safePage >= pageCount - 1),
        new ButtonBuilder().setCustomId("castorice:home").setLabel("Dashboard").setStyle(ButtonStyle.Secondary)
    ));
    return { embeds: [embed], components: rows };
}

async function buildSettingsPanel() {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Castorice | Settings")
        .setDescription(
            "Pengaturan dan bantuan untuk server ini.\n\n" +
            "**Pilih pengaturan yang ingin dibuka:**"
        )
        .setFooter({ text: "Castorice | Settings" })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("castorice:settings_tutor")
            .setLabel("Tutor")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("castorice:settings_rate")
            .setLabel("Rate Bot")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("castorice:settings_suggestion")
            .setLabel("Saran")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("castorice:settings_report")
            .setLabel("Report Bug")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("castorice:feature_selection")
            .setLabel("Feature Selection")
            .setStyle(ButtonStyle.Primary)
    );

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("castorice:home")
            .setLabel("Dashboard")
            .setStyle(ButtonStyle.Primary)
    );

    return {
        embeds: [embed],
        components: [row, backRow]
    };
}

function buildVoiceGreeterModal(greeting = voiceGreeter.DEFAULT_GREETING) {
    const modal = new ModalBuilder()
        .setCustomId("castorice:greeter_submit")
        .setTitle("Atur Pesan Voice Greeter");

    const input = new TextInputBuilder()
        .setCustomId("greeter_message")
        .setLabel("Pesan sambutan ({user} untuk mention anggota)")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(500)
        .setRequired(true)
        .setValue(String(greeting).slice(0, 500));

    return modal.addComponents(new ActionRowBuilder().addComponents(input));
}

async function buildFeatureSelectionPanel(guildId) {
    const config = await getGuildConfig(guildId);
    const definitions = getAllFeatures();

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Castorice | Feature Selection")
        .setDescription(
            "Atur fitur yang tersedia untuk server ini.\n" +
            "Hanya fitur yang sudah diimplementasikan yang dapat diaktifkan."
        )
        .setFooter({ text: "Perubahan konfigurasi berlaku untuk server ini." })
        .setTimestamp();

    const rows = [];

    for (let index = 0; index < definitions.length; index += 5) {
        const rowFeatures = definitions.slice(index, index + 5);

        const row = new ActionRowBuilder().addComponents(
            rowFeatures.map(feature => {
                const enabled = feature.implemented &&
                    config.features[feature.id] === true;

                const label = !feature.implemented
                    ? `${feature.label}: SOON`
                    : `${feature.label}: ${enabled ? "ON" : "OFF"}`;

                return new ButtonBuilder()
                    .setCustomId(`castorice:feature_toggle:${feature.id}`)
                    .setLabel(label.slice(0, 80))
                    .setStyle(
                        !feature.implemented
                            ? ButtonStyle.Secondary
                            : enabled
                                ? ButtonStyle.Success
                                : ButtonStyle.Danger
                    )
                    .setDisabled(!feature.implemented);
            })
        );

        rows.push(row);
    }

    rows.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("castorice:settings")
                .setLabel("Kembali ke Settings")
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId("castorice:home")
                .setLabel("Dashboard")
                .setStyle(ButtonStyle.Secondary)
        )
    );

    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("castorice:greeter_configure")
            .setLabel("Atur Pesan Voice Greeter")
            .setStyle(ButtonStyle.Secondary)
    ));

    return {
        embeds: [embed],
        components: rows
    };
}
module.exports = {
    buildDashboard,
    buildMusicPanel,
    buildQueuePanel,
    buildPlayModal,
    buildSearchModal,
    buildRadioSearchModal,
    buildRadioResultsPanel,
    buildTranslatorModal,
    buildTranslatorLanguagePanel,
    buildPlaylistCreateModal,
    buildPlaylistEditModal,
    buildPlaylistPanel,
    buildSearchResultsPanel,
    buildFeaturePanel,
    buildSettingsPanel,
    buildFeatureSelectionPanel,
    buildVoiceGreeterModal,
    buildServerTemplatesPanel,
    buildServerTemplateDeleteConfirmPanel,
    buildServerTemplateCreateModal,
    buildServerTemplatePreviewModal,
    buildServerTemplatePreviewPanel,
    buildSecurityReportPanel,
    buildSecurityHistoryPanel,
    buildSecurityPolicyModal,
    buildSecurityPolicyPreviewPanel
};
