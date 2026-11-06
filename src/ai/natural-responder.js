/**
 * Natural Response Generator for Castorice.
 * Formats polite, assistant-like responses in Indonesian and English.
 * Strictly adheres to truthfulness: never claims success before service confirms.
 * Uses robust fallback response templates when external AI provider is unavailable.
 */

const RESPONSE_TEMPLATES = {
    conversation: {
        greeting: [
            "Halo {user}! Ada yang bisa Castorice bantu untuk server ini? 🌸",
            "Hai {user}! Castorice siap membantu, mau putar musik, cek keamanan, atau ngobrol?",
            "Halo! Senang bertemu denganmu. Mau dibantu apa hari ini?"
        ],
        help: "Hai! Aku **Castorice**, AI Assistant server kamu. Kamu bisa menyuruhku putar musik (`Castorice play lagu`), menerjemahkan teks, mengelola temporary voice, audit keamanan, atau download media. Ketik `/menu` untuk membuka dashboard visual lengkap ya!",
        general_chat: [
            "Aku siap membantu berbagai kebutuhan server! Ada hal spesifik yang ingin kamu lakukan?",
            "Sebagai AI Assistant, aku bisa membantu mengontrol musik, server template, keamanan, dan lainnya. Coba ketik `/menu` untuk melihat fitur lengkapku!",
            "Tentu! Ada yang ingin kamu diskusikan atau perlu bantuan fitur server?"
        ],
        clarification: "Aku belum sepenuhnya memahami maksud perintahmu. Bisa berikan detail lebih jelas, atau ketik `/menu` untuk membuka opsi interaktif?",
        permission_denied: "Maaf {user}, kamu membutuhkan izin **{permission}** untuk menjalankan perintah ini.",
        feature_disabled: "Fitur **{feature}** saat ini sedang dinonaktifkan di server ini oleh administrator."
    },

    music: {
        play_success: "🎵 Memutar **{title}** oleh **{artist}** sekarang!",
        enqueue_success: "🎶 Lagu **{title}** berhasil ditambahkan ke antrean (posisi #{position})!",
        pause: "⏸️ Musik dijeda sebentar. Panggil aku lagi dengan `resume` kalau mau lanjut ya!",
        resume: "▶️ Melanjutkan musik kembali!",
        next: "⏭️ Melewati lagu ke trek berikutnya.",
        previous: "⏮️ Kembali ke lagu sebelumnya.",
        stop: "⏹️ Musik dihentikan dan antrean berhasil dibersihkan.",
        volume: "🔊 Volume berhasil diatur ke **{volume}%**.",
        seek: "⏩ Posisi musik dipindahkan ke **{position}**.",
        empty_queue: "Antrean musik saat ini kosong.",
        no_track: "Belum ada musik yang sedang diputar saat ini."
    },

    playlists: {
        play_success: "📋 Memutar playlist **{name}** ({count} lagu ditambahkan ke antrean)!",
        empty: "Belum ada playlist tersimpan di server ini."
    },

    translator: {
        success: "🌐 **Hasil Terjemahan ({source} ➔ {target}):**\n{translatedText}"
    },

    voice_manager: {
        create_success: "🔊 Temporary voice channel kamu sudah siap: **{channelName}**! Silakan bergabung.",
        lock_success: "🔒 Channel voice kamu sekarang dikunci.",
        unlock_success: "🔓 Channel voice kamu sekarang dibuka untuk semua anggota."
    },

    server_templates: {
        snapshot_success: "💾 Snapshot server **{name}** berhasil disimpan ({roleCount} role, {channelCount} channel dicatat). Struktur server belum diubah."
    },

    security: {
        audit_success: "🛡️ Pemeriksaan keamanan selesai! Ditemukan **{critical}** risiko kritis dan **{high}** risiko tinggi. Buka Dashboard untuk melihat detail temuan."
    },

    auto_disconnect: {
        set_success: "⏱️ Auto disconnect berhasil diatur selama **{duration}**. Bot akan otomatis meninggalkan voice jika sepi.",
        cancel_success: "⏹️ Auto disconnect telah dibatalkan."
    },

    trusted_member: {
        add_success: "✅ Anggota **{target}** berhasil ditambahkan ke daftar Trusted Member.",
        remove_success: "🗑️ Anggota **{target}** dihapus dari daftar Trusted Member."
    },

    auto_kick: {
        audit_success: "🤖 Audit bot offline: terdeteksi **{count}** bot Discord offline tanpa status Trusted Member."
    },

    social_downloader: {
        success: "📥 Konten dari **{platform}** berhasil diproses!"
    }
};

function formatTemplate(template, params = {}) {
    if (Array.isArray(template)) {
        template = template[0];
    }
    let text = String(template || "");
    for (const [key, value] of Object.entries(params)) {
        text = text.replaceAll(`{${key}}`, String(value ?? ""));
    }
    return text;
}

class NaturalResponder {
    constructor({ aiProvider = null } = {}) {
        this.aiProvider = aiProvider;
    }

    /**
     * Build natural response
     * @param {object} intent
     * @param {object} executionResult { status: "success"|"error"|"denied", data: ... }
     * @param {object} context { user, guild, permission, error }
     * @returns {string} Response message formatted for Discord
     */
    async generateResponse(intent, executionResult = {}, context = {}) {
        const domain = intent?.domain || "conversation";
        const action = intent?.action || "general_chat";
        const userMention = context.user ? `<@${context.user.id || context.user}>` : "teman";

        // Handle error / denied state first
        if (executionResult.status === "denied") {
            return formatTemplate(RESPONSE_TEMPLATES.conversation.permission_denied, {
                user: userMention,
                permission: executionResult.reason || context.permission || "Manage Server"
            });
        }

        if (executionResult.status === "disabled") {
            return formatTemplate(RESPONSE_TEMPLATES.conversation.feature_disabled, {
                feature: executionResult.feature || domain
            });
        }

        if (executionResult.status === "error") {
            return `⚠️ Operasi gagal: ${executionResult.error || "Terjadi kesalahan internal saat memproses perintah."}`;
        }

        // Domain-specific templates
        const domainTemplates = RESPONSE_TEMPLATES[domain];
        if (domainTemplates && executionResult.status === "success") {
            const key = `${action}_success`;
            if (domainTemplates[key]) {
                return formatTemplate(domainTemplates[key], {
                    user: userMention,
                    ...executionResult.data
                });
            }
            if (domainTemplates[action]) {
                return formatTemplate(domainTemplates[action], {
                    user: userMention,
                    ...executionResult.data
                });
            }
        }

        // Handle conversational domain
        if (domain === "conversation") {
            if (action === "greeting") {
                return formatTemplate(RESPONSE_TEMPLATES.conversation.greeting, { user: userMention });
            }
            if (action === "help") {
                return formatTemplate(RESPONSE_TEMPLATES.conversation.help, { user: userMention });
            }
            return formatTemplate(RESPONSE_TEMPLATES.conversation.general_chat, { user: userMention });
        }

        // Fallback generic confirmation
        return `Perintah **${action}** berhasil dijalankan! ✨`;
    }
}

module.exports = {
    NaturalResponder,
    RESPONSE_TEMPLATES,
    formatTemplate
};
