/**
 * Global Natural Intent Router for Castorice.
 * Unified intent recognition covering Music, Playlists, Lyrics, Translator,
 * Voice Manager, Server Templates, Security Assistant, Auto Disconnect,
 * Trusted Members, Auto Kick, Social Downloader, and Conversational AI.
 */

const { parseMusicIntent } = require("./music-intent");
const { parseServerTemplateIntent } = require("../server-templates/tag-router");
const { parseVoiceIntent } = require("../voice-ai/tag-router");

// In-memory conversation context storage per channel with TTL
const conversationContexts = new Map();
const CONTEXT_TTL_MS = 3 * 60 * 1000; // 3 minutes

function setChannelContext(channelId, contextData) {
    if (!channelId) return;
    conversationContexts.set(channelId, {
        ...contextData,
        expiresAt: Date.now() + CONTEXT_TTL_MS
    });
}

function getChannelContext(channelId) {
    if (!channelId) return null;
    const ctx = conversationContexts.get(channelId);
    if (!ctx) return null;
    if (Date.now() > ctx.expiresAt) {
        conversationContexts.delete(channelId);
        return null;
    }
    return ctx;
}

function clearChannelContext(channelId) {
    if (!channelId) return;
    conversationContexts.delete(channelId);
}

function cleanInput(text) {
    return String(text || "")
        .trim()
        .replace(/^[;:,.]+|[;:,.]+$/g, "")
        .replace(/\s+/g, " ");
}

/**
 * Parse Auto Disconnect intents
 * Example: "atur auto disconnect 2 menit 10 detik"
 */
function parseAutoDisconnectIntent(text) {
    const matchSet = text.match(/^(?:atur|set|jadwalkan)?\s*auto\s*disconnect\s+(.+)$/i);
    if (matchSet) {
        const durationStr = matchSet[1].trim();
        if (/^(?:mati|matikan|off|disable|nonaktif|nonaktifkan|batal|batalkan|cancel)$/i.test(durationStr)) {
            return { domain: "auto_disconnect", action: "cancel" };
        }
        return { domain: "auto_disconnect", action: "set", rawDuration: durationStr };
    }

    if (/^(?:status|cek|lihat)?\s*auto\s*disconnect$/i.test(text)) {
        return { domain: "auto_disconnect", action: "status" };
    }

    if (/^(?:matikan|batalkan|cancel|nonaktifkan)\s*auto\s*disconnect$/i.test(text)) {
        return { domain: "auto_disconnect", action: "cancel" };
    }

    return null;
}

/**
 * Parse Trusted Member intents
 * Example: "tambah trusted member @user", "hapus trusted member 123456", "daftar trusted member"
 */
function parseTrustedMemberIntent(text) {
    const addMatch = text.match(/^(?:tambah(?:kan)?|add)\s+trusted\s*(?:member|user)\s+(.+)$/i);
    if (addMatch) {
        return { domain: "trusted_member", action: "add", target: addMatch[1].trim() };
    }

    const removeMatch = text.match(/^(?:hapus|remove|del(?:ete)?)\s+trusted\s*(?:member|user)\s+(.+)$/i);
    if (removeMatch) {
        return { domain: "trusted_member", action: "remove", target: removeMatch[1].trim() };
    }

    if (/^(?:daftar|list|lihat|tampilkan|cek)\s+trusted\s*(?:member|members|users?)$/i.test(text)) {
        return { domain: "trusted_member", action: "list" };
    }

    return null;
}

/**
 * Parse Auto Kick / Offline Bot intents
 * Example: "audit bot offline", "kick bot offline"
 */
function parseAutoKickIntent(text) {
    if (/^(?:audit|cek|periksa|lihat|scan)\s+bot\s*(?:offline|tidak aktif)?$/i.test(text) ||
        /^(?:bot\s*(?:offline|tidak aktif)\s*(?:audit|cek|scan))$/i.test(text)) {
        return { domain: "auto_kick", action: "audit" };
    }

    if (/^(?:kick|keluarkan)\s+bot\s*offline$/i.test(text)) {
        return { domain: "auto_kick", action: "kick_offline" };
    }

    const manualKickMatch = text.match(/^(?:kick|keluarkan)\s+(?:member|anggota|user)?\s*(.+)$/i);
    if (manualKickMatch && !/bot\s*offline/i.test(text)) {
        return { domain: "manual_kick", action: "kick", target: manualKickMatch[1].trim() };
    }

    return null;
}

/**
 * Parse Social Media Downloader intents
 * Example: "download tiktok https://...", "unduh instagram https://..."
 */
function parseSocialDownloaderIntent(text) {
    const urlMatch = text.match(/(https?:\/\/[^\s]+)/i);
    const hasDownloadKeyword = /^(?:download|unduh|ambilkan|save|unduhkan)\b/i.test(text);

    if (urlMatch) {
        const url = urlMatch[1];
        const isTikTok = /tiktok\.com/i.test(url);
        const isInstagram = /instagram\.com/i.test(url);

        if (isTikTok || isInstagram || hasDownloadKeyword) {
            return {
                domain: "social_downloader",
                action: "download",
                url,
                platform: isTikTok ? "tiktok" : isInstagram ? "instagram" : "generic"
            };
        }
    }

    if (hasDownloadKeyword && !urlMatch) {
        return {
            domain: "social_downloader",
            action: "missing_url"
        };
    }

    return null;
}

/**
 * Parse Security Assistant intents
 */
function parseSecurityIntent(text) {
    if (/^(?:audit\s+keamanan|security\s+audit|periksa\s+risiko|cek\s+keamanan|pemeriksaan\s+keamanan)$/i.test(text)) {
        return { domain: "security", action: "audit" };
    }
    return null;
}

/**
 * Main Global Intent Resolver
 * @param {string} rawInput
 * @param {object} context
 * @returns {object} Normalized Intent
 */
function resolveIntent(rawInput, context = {}) {
    const text = cleanInput(rawInput);
    if (!text) {
        return {
            domain: "conversation",
            action: "greet_or_help",
            confidence: 1.0,
            rawText: ""
        };
    }

    // 1. Check Auto Disconnect
    const autoDisconnect = parseAutoDisconnectIntent(text);
    if (autoDisconnect) return { ...autoDisconnect, rawText: text, confidence: 0.95 };

    // 2. Check Trusted Members
    const trustedMember = parseTrustedMemberIntent(text);
    if (trustedMember) return { ...trustedMember, rawText: text, confidence: 0.95 };

    // 3. Check Auto Kick & Bot Audit
    const autoKick = parseAutoKickIntent(text);
    if (autoKick) return { ...autoKick, rawText: text, confidence: 0.95 };

    // 4. Check Social Downloader
    const social = parseSocialDownloaderIntent(text);
    if (social) return { ...social, rawText: text, confidence: 0.95 };

    // 5. Check Security Assistant
    const security = parseSecurityIntent(text);
    if (security) return { ...security, rawText: text, confidence: 0.95 };

    // 6. Check Server Templates
    const templateIntent = parseServerTemplateIntent(text);
    if (templateIntent && templateIntent.type !== "unknown") {
        return {
            domain: "server_templates",
            action: templateIntent.type,
            name: templateIntent.name || null,
            rawText: text,
            confidence: 0.95
        };
    }

    // 7. Check Voice Manager
    const voiceIntent = parseVoiceIntent(text);
    if (voiceIntent && voiceIntent.type !== "unknown") {
        return {
            domain: "voice_manager",
            action: voiceIntent.type,
            details: voiceIntent,
            rawText: text,
            confidence: 0.95
        };
    }

    // 8. Check Music, Queue, Lyrics, and Translator
    const musicIntent = parseMusicIntent(text);
    if (musicIntent && musicIntent.type !== "unknown" && musicIntent.type !== "help") {
        if (musicIntent.type.startsWith("translate")) {
            return {
                domain: "translator",
                action: musicIntent.type,
                details: musicIntent,
                rawText: text,
                confidence: 0.95
            };
        }
        if (musicIntent.type.startsWith("playlist")) {
            return {
                domain: "playlists",
                action: musicIntent.type,
                details: musicIntent,
                rawText: text,
                confidence: 0.95
            };
        }
        return {
            domain: "music",
            action: musicIntent.type,
            details: musicIntent,
            rawText: text,
            confidence: 0.95
        };
    }

    // 9. Conversational, Greetings & Help
    if (/^(?:halo|hai|hey|hi|hello|pagi|siang|malam|yo)\b/i.test(text)) {
        return {
            domain: "conversation",
            action: "greeting",
            rawText: text,
            confidence: 0.9
        };
    }

    if (/^(?:help|bantuan|menu|cara pakai|apa yang bisa kamu lakukan|bisa apa aja)\b/i.test(text)) {
        return {
            domain: "conversation",
            action: "help",
            rawText: text,
            confidence: 0.9
        };
    }

    // Default to natural conversation fallback
    return {
        domain: "conversation",
        action: "general_chat",
        rawText: text,
        confidence: 0.5
    };
}

module.exports = {
    resolveIntent,
    setChannelContext,
    getChannelContext,
    clearChannelContext,
    parseAutoDisconnectIntent,
    parseTrustedMemberIntent,
    parseAutoKickIntent,
    parseSocialDownloaderIntent,
    parseSecurityIntent
};
