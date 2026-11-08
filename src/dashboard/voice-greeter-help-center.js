const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    StringSelectMenuBuilder
} = require("discord.js");

const HELP_CENTER_PAGES = [
    {
        id: "overview",
        label: "Ringkasan",
        description: "Pilih topik pada menu ini untuk melihat panduan. Help Center hanya berisi informasi dan navigasi; tidak menjalankan aksi server."
    },
    {
        id: "greeter",
        label: "Voice Greeter",
        description: "Castorice mengirim satu pesan sambutan saat anggota masuk ke voice channel. Teks tetap sama seperti greeting yang dikonfigurasi administrator. Audio TTS bersifat opsional dan hanya berjalan bila provider tersedia."
    },
    {
        id: "music",
        label: "Music dan Radio",
        description: [
            "Contoh: `@Castorice play lagu`, `@Castorice cari lagu`, `@Castorice cari radio station jazz`, `@Castorice queue`, `@Castorice volume 70`, atau `@Castorice autoplay on`.",
            "Pemutaran memerlukan bot dan anggota berada di voice channel yang sama. Provider, koneksi voice, dan dependensi runtime harus tersedia."
        ].join("\n\n")
    },
    {
        id: "ai",
        label: "AI Chat",
        description: "Sebut Castorice atau gunakan mention untuk bertanya. Contoh: `@Castorice jelaskan ...` atau `Castorice: ...`. AI Chat memerlukan provider dan API key yang dikonfigurasi; ketersediaan layanan eksternal tidak dijamin."
    },
    {
        id: "voice_ai",
        label: "Voice AI",
        description: "Contoh: `@Castorice voice ai jelaskan ...`. Pengguna harus berada di voice channel. Jawaban tetap dapat diberikan sebagai teks jika TTS tidak tersedia. Voice AI dan TTS memerlukan konfigurasi provider dan belum tentu aktif di server."
    },
    {
        id: "voice_manager",
        label: "Voice Manager",
        description: "Contoh: `@Castorice buat voice`, `@Castorice kunci voice`, atau `@Castorice hapus voice saya`. Aksi dibatasi kepemilikan channel dan izin Discord; penghapusan meminta konfirmasi."
    },
    {
        id: "translator",
        label: "Translator",
        description: "Contoh: `@Castorice terjemahkan hello ke id` atau `@Castorice translate hello dari en ke id`. Memerlukan provider LibreTranslate yang dapat dijangkau dan konfigurasi yang sesuai."
    },
    {
        id: "templates",
        label: "Server Templates",
        description: "Administrator dapat meminta `@Castorice preview create template`, `preview rebuild`, `preview clone`, atau `preview smart_merge`. Perubahan hanya diterapkan melalui alur Dashboard yang memiliki preview, permission check, dan konfirmasi."
    },
    {
        id: "security",
        label: "Security Assistant",
        description: "Gunakan `@Castorice cek keamanan` atau `@Castorice riwayat audit`. Pemantauan berjalan dalam mode alert-only; tindakan moderasi destruktif memerlukan kebijakan server yang dikonfirmasi administrator."
    },
    {
        id: "dashboard",
        label: "Dashboard /menu",
        description: "Gunakan `/menu` untuk membuka Dashboard server. Fitur diatur per server melalui Settings. Aksi administratif tetap mengikuti permission Discord dan konfirmasi yang ditampilkan."
    },
    {
        id: "media",
        label: "Media Downloader",
        description: "Downloader media sosial belum tersedia sebagai layanan aktif di Castorice. Mengirim tautan atau perintah download tidak menghasilkan file media."
    }
];

const pageById = new Map(HELP_CENTER_PAGES.map(page => [page.id, page]));

function buildVoiceGreeterHelpCenter(pageId = "overview") {
    const page = pageById.get(pageId);
    if (!page) {
        throw new RangeError("Help Center page is not supported.");
    }

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`Help Center Castorice — ${page.label}`)
        .setDescription(page.description)
        .setFooter({ text: "Panduan informasi saja • pilih topik untuk navigasi" });

    const selector = new StringSelectMenuBuilder()
        .setCustomId("castorice:voice_help_select")
        .setPlaceholder("Pilih topik panduan")
        .addOptions(HELP_CENTER_PAGES.map(item => ({
            label: item.label,
            value: item.id,
            default: item.id === page.id
        })));
    const summaryButton = new ButtonBuilder()
        .setCustomId("castorice:voice_help_overview")
        .setLabel("Ringkasan")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page.id === "overview");
    const settingsButton = new ButtonBuilder()
        .setCustomId("castorice:settings")
        .setLabel("Kembali ke Settings")
        .setStyle(ButtonStyle.Secondary);

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(selector),
            new ActionRowBuilder().addComponents(summaryButton, settingsButton)
        ]
    };
}

module.exports = {
    HELP_CENTER_PAGES,
    buildVoiceGreeterHelpCenter
};
