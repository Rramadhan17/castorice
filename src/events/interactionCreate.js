const {
    Events,
    MessageFlags,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const { randomUUID } = require("node:crypto");

const {
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
    SETTINGS_ACTION_IDS,
    buildFeatureSelectionPanel,
    buildGlobalAISettingsPanel,
    buildVoiceGreeterModal,
    buildServerTemplatesPanel,
    buildServerTemplateCreateModal,
    buildServerTemplatePreviewModal,
    buildServerTemplatePreviewPanel,
    buildServerTemplateDeleteConfirmPanel,
    buildSecurityReportPanel,
    buildSecurityHistoryPanel,
    buildSecurityPolicyModal,
    buildSecurityPolicyPreviewPanel,
    buildSecuritySpamPolicyModal,
    buildSecuritySpamPolicyPreviewPanel
} = require("../dashboard/menu-panel");

const {
    getFeatureState,
    setFeatureEnabled
} = require("../features/feature-manager");
const { checkFeature } = require("../core/feature-guard");
const { createTranslatorFromEnv } = require("../translator/libretranslate-provider");
const voiceGreeter = require("../voice-ai/greeter");
const { createServerTemplateService } = require("../server-templates/service");
const { createServerTemplateTagRouter } = require("../server-templates/tag-router");
const {
    createServerTemplateExecutor,
    hashTemplatePlan,
    getConfirmationPhrase
} = require("../server-templates/executor");
const { createSecurityAssistant } = require("../security/assistant");
const { createSecurityTagRouter } = require("../security/tag-router");
const { validateOfflinePolicy, validateSpamPolicy } = require("../security/assistant");

const music = require("../music/manager");
const { createRadioDiscovery } = require("../music/radio-discovery");
const { checkMusicAccess } = require("../core/music-access-guard");

const protectedMusicActions = new Set([
    "music_pause",
    "music_resume",
    "music_next",
    "music_autoplay",
    "music_previous",
    "music_stop",
    "lyrics_translate",
    "music_seek_back",
    "music_seek_forward",
    "queue_remove",
    "queue_delete"
]);
const musicActions = new Set([
    "music",
    "music_play",
    "music_queue",
    "music_search",
    "music_radio_search",
    "music_lyrics",
    "music_seek_back",
    "music_seek_forward",
    "music_pause",
    "music_resume",
    "music_next",
    "music_autoplay",
    "music_previous",
    "music_stop",
    "lyrics_translate",
    "music_volume",
    "music_open_player",
    "queue_remove",
    "queue_delete",
    "queue_page",
    "queue_shuffle",
    "music_search_select",
    "music_radio_select"
]);
const translatorActions = new Set([
    "translator",
    "translator_open",
    "translator_languages",
    "translator_languages_page"
]);
const { parseMusicIntent } = require("../ai/music-intent");
const { extractTrigger } = require("../ai/natural-trigger");
const { resolveIntent } = require("../ai/intent-router");
const { createGeminiProviderFromEnv } = require("../ai/provider-manager");
const { globalAISettings: defaultGlobalAISettings } = require("../ai/global-settings");
const {
    formatAIProviderStatus,
    parseAIProviderSettingsIntent
} = require("../ai/provider-settings");
const { AIConversationError, createAIConversationService } = require("../ai/conversation-service");
const { loadTtsProvider } = require("../voice-ai/greeter-tts");
const { createVoiceAIService } = require("../voice-ai/interaction-service");
const { createVoiceAITagRouter } = require("../voice-ai/interaction-router");
const { createVoiceGreeterTagRouter } = require("../voice-ai/greeter-tag-router");
const musicPanelUpdater = require("../music/panel-updater");
const { searchLyrics } = require("../lyrics/engine");
const { buildLyricsPanel } = require("../lyrics/panel");
const { buildVoiceGreeterHelpCenter } = require("../dashboard/voice-greeter-help-center");
const { translateLyrics } = require("../lyrics/translation");
const { createVoiceTagRouter } = require("../voice-ai/tag-router");
const { createVoiceCenterTagRouter } = require("../voice-ai/center-tag-router");
const { createVoiceCenterInteractionHandler } = require("../voice-ai/center-interactions");
const { createPlaylistService } = require("../playlists/service");
const { enqueuePlaylist } = require("../playlists/queue");
const { createPlaylistTagRouter } = require("../playlists/tag-router");
const queueSelections = new Map();
const searchResults = new Map();
const { isOwner } = require("../owner/auth");

const {
    buildOwnerPanel,
    buildOwnerSubPanel
} = require("../owner/panel");

function splitForDiscord(text, maxLength = 1800) {
    const characters = Array.from(String(text).replace(/@/g, "@\u200b"));
    const chunks = [];
    let chunk = "";

    for (const character of characters) {
        if (chunk.length + character.length > maxLength) {
            chunks.push(chunk);
            chunk = "";
        }

        chunk += character;
    }

    if (chunk) chunks.push(chunk);

    return chunks.length ? chunks : [""];
}

function translationLabel(result) {
    const source = result.detectedLanguage || result.source;
    return `Terjemahan (${source} → ${result.target}):`;
}

function parseSettingsRequest(text) {
    const requests = [
        {
            action: "tutor",
            pattern: /\b(?:tutor|tutorial|panduan(?:\s+fitur|\s+penggunaan)?|cara\s+menggunakan(?:\s+castorice)?)\b/i
        },
        {
            action: "rate",
            pattern: /\b(?:rate\s+(?:the\s+)?bot|rating(?:\s+(?:bot|castorice))?|beri(?:kan)?\s+nilai(?:\s+(?:bot|castorice))?|nilai\s+(?:bot|castorice))\b/i
        },
        {
            action: "suggestion",
            pattern: /\b(?:suggestion|feedback|saran\s+(?:fitur|untuk\s+bot)|kirim\s+saran|beri(?:kan)?\s+saran|ajukan\s+saran)\b/i
        },
        {
            action: "report",
            pattern: /\b(?:report|lapor(?:kan)?)\s+(?:a\s+)?(?:bug|masalah|kesalahan)\b|\bbug\s+report\b/i
        }
    ];
    return requests.find(request => request.pattern.test(String(text || "")))?.action || null;
}

function unavailableSettingsMessage(action) {
    const messages = {
        rate: "Fitur Rate Bot belum tersedia. Belum ada sistem rating aktif, dan tidak ada rating yang disimpan.",
        suggestion: "Pengiriman Suggestion belum tersedia. Belum ada layanan penyimpanan saran yang dikonfigurasi, jadi belum ada saran yang dikirim.",
        report: "Report Bug belum tersedia. Belum ada layanan pelaporan yang dikonfigurasi, jadi belum ada laporan yang disimpan."
    };
    return messages[action] || "Aksi Settings ini belum tersedia.";
}

function aiFailureMessage(error) {
    const messages = {
        not_configured: "Gemini belum dikonfigurasi. Pemilik bot perlu menetapkan GEMINI_API_KEY; GEMINI_MODEL opsional.",
        configuration_error: "Konfigurasi Gemini tidak valid. Pemilik bot perlu memeriksa GEMINI_API_KEY, GEMINI_MODEL, dan AI_TIMEOUT_MS.",
        request_error: "Gemini menolak format request atau konfigurasi model. Periksa GEMINI_MODEL lalu coba lagi.",
        authentication_failed: "Gemini menolak autentikasi atau akses. Pemilik bot perlu memeriksa konfigurasi Gemini.",
        invalid_api_key: "Kredensial Gemini tidak valid. Pemilik bot perlu memeriksa konfigurasi Gemini.",
        quota_exceeded: "Kuota Gemini telah habis. Periksa kuota atau billing Gemini.",
        rate_limited: "Gemini sedang membatasi permintaan. Coba lagi nanti.",
        timeout: "Gemini tidak merespons tepat waktu. Coba lagi nanti.",
        model_discovery_failed: "Daftar model Gemini gagal dimuat. Periksa akses Gemini atau tentukan GEMINI_MODEL.",
        model_unavailable: "Tidak ditemukan model Gemini yang mendukung pembuatan jawaban.",
        model_not_compatible: "Model Gemini yang dikonfigurasi tidak tersedia atau tidak kompatibel.",
        invalid_model: "Model Gemini yang dikonfigurasi tidak tersedia.",
        invalid_response: "Gemini mengembalikan respons yang tidak dapat digunakan.",
        provider_error: "Gemini gagal memproses permintaan. Tidak ada jawaban yang dibuat.",
        provider_unavailable: "Gemini sedang tidak tersedia. Coba lagi nanti.",
        unavailable: "Gemini tidak dapat dijangkau. Coba lagi nanti.",
        cancelled: "Permintaan AI dibatalkan.",
        rate_limited_chat: "Tunggu sebentar sebelum mengirim pesan AI berikutnya.",
        busy: "Castorice masih memproses pesanmu. Coba lagi sebentar.",
        input_too_long: error.message,
        empty_input: error.message
    };
    if (error?.code === "rate_limited" && error instanceof AIConversationError) {
        return messages.rate_limited_chat;
    }
    return messages[error?.code] || "AI gagal merespons. Coba lagi nanti.";
}

function safeAIErrorCode(error) {
    const safeCodes = new Set([
        "not_configured",
        "configuration_error",
        "request_error",
        "authentication_failed",
        "invalid_api_key",
        "quota_exceeded",
        "rate_limited",
        "timeout",
        "model_discovery_failed",
        "model_unavailable",
        "model_not_compatible",
        "invalid_model",
        "invalid_response",
        "provider_error",
        "provider_unavailable",
        "unavailable",
        "cancelled",
        "busy",
        "input_too_long",
        "empty_input"
    ]);
    return safeCodes.has(error?.code) ? error.code : "provider_error";
}

async function replyToAIMessage(message, payload, logger) {
    try {
        return await message.reply(payload);
    } catch {
        logger.error?.("[AI Chat Discord Reply Error]", "reply_failed");
        return null;
    }
}

async function replyToOwnerPrivately(message, content, logger) {
    try {
        if (typeof message.author?.send !== "function") throw new Error("dm_unavailable");
        await message.author.send({ content, allowedMentions: { parse: [] } });
        return true;
    } catch {
        logger.warn?.("[AI Provider Settings DM Error]", "dm_unavailable");
        await message.reply({
            content: "Pengaturan provider AI hanya ditampilkan lewat DM. Aktifkan DM dari anggota server lalu coba lagi.",
            allowedMentions: { parse: [] }
        });
        return false;
    }
}

module.exports = function registerInteractionHandler(client, dependencies = {}) {
    const translatorFactory = dependencies.translatorFactory || createTranslatorFromEnv;
    const lyricsSearch = dependencies.lyricsSearch || searchLyrics;
    const playlistService = dependencies.playlistService || createPlaylistService();
    const serverTemplateService = dependencies.serverTemplateService || createServerTemplateService();
    const serverTemplateExecutor = dependencies.serverTemplateExecutor ||
        createServerTemplateExecutor({ service: serverTemplateService });
    const serverTemplateTagRouter = typeof serverTemplateService.list === "function" &&
        typeof serverTemplateService.create === "function"
        ? createServerTemplateTagRouter({
            service: serverTemplateService,
            featureGuard: dependencies.featureGuard || checkFeature
        })
        : null;
    const pendingTemplatePreviews = new Map();
    const pendingTemplateDeletions = new Map();
    const activeTemplateApplyGuilds = new Set();
    const pendingSecurityPolicies = new Map();
    const pendingSecuritySpamPolicies = new Map();
    const radioSearchResults = new Map();
    const securityAssistant = dependencies.securityAssistant || createSecurityAssistant();
    const logger = dependencies.logger || console;
    const ownerCheck = dependencies.isOwner || isOwner;
    const globalAISettings = dependencies.globalAISettings || defaultGlobalAISettings;
    let aiProvider = dependencies.aiProvider || null;
    let aiProviderConfigurationError = null;
    if (!aiProvider && !dependencies.aiConversationService) {
        try {
            aiProvider = createGeminiProviderFromEnv(
                dependencies.environment || process.env,
                { fetchImpl: dependencies.fetchImpl }
            );
        } catch {
            aiProviderConfigurationError = true;
            logger.error?.("[Gemini AI Configuration Error]", "invalid_configuration");
        }
    }
    const aiConversationService = dependencies.aiConversationService ||
        createAIConversationService({
            provider: aiProvider
        });
    async function applyGlobalAISettings() {
        return globalAISettings.getSettings();
    }
    function getProviderStatus() {
        return {
            configured: Boolean(aiProvider),
            configurationError: aiProviderConfigurationError
        };
    }
    async function buildSettingsCenter(guildId, canManageGuild, userId) {
        const globalSettings = await applyGlobalAISettings();
        const serverAI = /^\d{17,20}$/.test(String(guildId || ""))
            ? await getFeatureState(guildId, "ai_chat")
            : null;
        return buildSettingsPanel({
            guildId,
            canManageGuild,
            globalAIEnabled: globalSettings.enabled,
            serverAIEnabled: serverAI?.enabled ?? null,
            providerStatus: getProviderStatus(),
            isOwner: ownerCheck(userId)
        });
    }
    async function buildGlobalSettingsCenter() {
        const settings = await applyGlobalAISettings();
        return buildGlobalAISettingsPanel({
            settings,
            providerStatus: getProviderStatus()
        });
    }
    const featureGuard = dependencies.featureGuard || checkFeature;
    async function checkAIFeature(guildId, featureId) {
        if (featureId === "ai_chat" || featureId === "voice_ai") {
            let settings;
            try {
                settings = await applyGlobalAISettings();
            } catch {
                return {
                    allowed: false,
                    reason: "Status AI global gagal dibaca. Fitur AI dinonaktifkan sementara; hubungi pemilik bot."
                };
            }
            if (!settings.enabled) {
                return {
                    allowed: false,
                    reason: "Layanan AI sedang dinonaktifkan secara global oleh pemilik bot."
                };
            }
        }
        return featureGuard(guildId, featureId);
    }
    const voiceAIService = dependencies.voiceAIService || createVoiceAIService({
        conversationService: aiConversationService,
        ttsProvider: dependencies.ttsProvider,
        loadTtsProvider: dependencies.loadTtsProvider || loadTtsProvider,
        playback: dependencies.voicePlayback
    });
    const voiceAITagRouter = createVoiceAITagRouter({
        service: voiceAIService,
        featureGuard: checkAIFeature
    });
    const securityTagRouter = createSecurityTagRouter({
        service: securityAssistant,
        featureGuard: dependencies.featureGuard || checkFeature
    });
    const playlistMusic = dependencies.musicManager || music;
    const radioDiscovery = dependencies.radioDiscovery || createRadioDiscovery();
    const radioMusicManager = dependencies.musicManager || music;
    const playlistTagRouter = createPlaylistTagRouter({
        service: playlistService,
        musicManager: playlistMusic,
        featureGuard: dependencies.featureGuard || checkFeature
    });
    const voiceTagRouter = dependencies.voiceManager && dependencies.voiceStateStore
        ? createVoiceTagRouter({
            service: dependencies.voiceManager,
            stateStore: dependencies.voiceStateStore
        })
        : null;
    const voiceCenterTagRouter = dependencies.voiceCenterService
        ? createVoiceCenterTagRouter({
            service: dependencies.voiceCenterService,
            logger
        })
        : null;
    const voiceCenterInteractionHandler = dependencies.voiceCenterService
        ? createVoiceCenterInteractionHandler({
            service: dependencies.voiceCenterService,
            ownerId: dependencies.ownerId || null,
            logger
        })
        : null;
    const voiceGreeterTagRouter = dependencies.voiceGreeterTagRouter ||
        createVoiceGreeterTagRouter({
            featureGuard: dependencies.featureGuard || checkFeature
        });

    const handleInteractionCreate = async interaction => {
        try {
            if (voiceCenterInteractionHandler && await voiceCenterInteractionHandler(interaction)) return;
            if (interaction.isChatInputCommand()) {
                const command = interaction.commandName;

                if (command === "owner") {
                    if (!isOwner(interaction.user.id)) {
                        await interaction.reply({
                            content: "Akses ditolak. Khusus Owner Castorice.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    if (!interaction.guild) {
                        await interaction.reply({
                            content: "Jalankan command ini dari server Discord.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    await interaction.deferReply({
                        flags: MessageFlags.Ephemeral
                    });

                    try {
                        await client.users.send(
                            interaction.user.id,
                            buildOwnerPanel(client)
                        );

                        await interaction.editReply(
                            "Owner Control Panel dikirim ke DM."
                        );
                    } catch {
                        await interaction.editReply(
                            "Gagal mengirim DM. Periksa pengaturan privasi Discord."
                        );
                    }

                    return;
                }

                if (command === "menu") {
                    if (!interaction.guild) {
                        await interaction.reply({
                            content: "Dashboard hanya tersedia di server.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    await interaction.reply(
                        buildDashboard(interaction.guild)
                    );
                    return;
                }
            }

            if (interaction.isModalSubmit()) {
                if (interaction.customId === "castorice:template_create_submit") {
                    const feature = await checkFeature(interaction.guildId, "server_templates");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk membuat template.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    const actor = await interaction.guild.members.fetch(interaction.user.id);
                    const template = await serverTemplateService.create(
                        interaction.guild,
                        actor,
                        interaction.fields.getTextInputValue("template_name")
                    );
                    await interaction.editReply(buildServerTemplatesPanel(
                        interaction.guild.id,
                        await serverTemplateService.list(interaction.guild.id),
                        `Snapshot '${template.name}' berhasil disimpan. ID: ${template.id}`
                    ));
                    return;
                }

                if (interaction.customId === "castorice:template_preview_submit") {
                    const feature = await checkFeature(interaction.guildId, "server_templates");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk preview template.", flags: MessageFlags.Ephemeral });
                        return;
                    }

                    const sourceGuildId = interaction.fields.getTextInputValue("template_source_guild").trim();
                    const templateId = interaction.fields.getTextInputValue("template_id").trim();
                    const mode = interaction.fields.getTextInputValue("template_mode").trim().toLowerCase();
                    if (!/^\d{17,20}$/.test(sourceGuildId) || !templateId || templateId.length > 128) {
                        await interaction.reply({ content: "ID server sumber atau ID template tidak valid.", flags: MessageFlags.Ephemeral });
                        return;
                    }

                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    try {
                        const sourceGuild = await client.guilds.fetch(sourceGuildId);
                        const [sourceActor, targetActor] = await Promise.all([
                            sourceGuild.members.fetch(interaction.user.id),
                            interaction.guild.members.fetch(interaction.user.id)
                        ]);
                        const plan = await serverTemplateService.preview({
                            sourceGuild,
                            targetGuild: interaction.guild,
                            sourceActor,
                            targetActor,
                            templateId,
                            mode
                        });
                        const previewId = randomUUID();
                        const template = await serverTemplateService.get(sourceGuild.id, templateId);
                        const pending = {
                            sourceGuildId: sourceGuild.id,
                            targetGuildId: interaction.guild.id,
                            templateId,
                            mode,
                            requesterId: interaction.user.id,
                            planHash: hashTemplatePlan(plan),
                            confirmation: getConfirmationPhrase(mode, template.name),
                            expiresAt: Date.now() + 5 * 60 * 1000,
                            executing: false
                        };
                        for (const [key, value] of pendingTemplatePreviews) {
                            if (value.expiresAt <= Date.now()) pendingTemplatePreviews.delete(key);
                        }
                        pendingTemplatePreviews.set(previewId, pending);
                        await interaction.editReply(buildServerTemplatePreviewPanel(
                            plan,
                            previewId,
                            interaction.user.id,
                            pending.confirmation
                        ));
                    } catch (error) {
                        await interaction.editReply({ content: error.message || "Preview template gagal dibuat." });
                    }
                    return;
                }

                if (interaction.customId === "castorice:greeter_submit") {
                    const feature = await checkFeature(interaction.guildId, "voice_greeter");
                    if (!feature.allowed) {
                        await interaction.reply({
                            content: feature.reason,
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({
                            content: "Kamu membutuhkan izin Manage Server untuk mengubah pesan Voice Greeter.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    const greeting = interaction.fields.getTextInputValue("greeter_message");
                    await voiceGreeter.setGreeting(interaction.guild.id, greeting);
                    await interaction.editReply({
                        content: "Pesan Voice Greeter berhasil disimpan. Gunakan `{user}` untuk menyebut anggota yang bergabung."
                    });
                    return;
                }

                if (interaction.customId === "castorice:security_policy_submit") {
                    const feature = await checkFeature(interaction.guildId, "security_assistant");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk mengubah kebijakan keamanan.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    try {
                        const enabledValue = interaction.fields.getTextInputValue("security_policy_enabled").trim().toUpperCase();
                        if (!["ON", "OFF"].includes(enabledValue)) {
                            throw new Error("Status kebijakan harus berupa ON atau OFF.");
                        }
                        const policy = validateOfflinePolicy({
                            enabled: enabledValue === "ON",
                            thresholdMinutes: Number(interaction.fields.getTextInputValue("security_policy_threshold")),
                            maxObservationGapMinutes: Number(interaction.fields.getTextInputValue("security_policy_gap")),
                            excludedBotIds: interaction.fields.getTextInputValue("security_policy_excluded")
                                .split(",")
                                .map(value => value.trim())
                                .filter(Boolean)
                        });
                        for (const [id, pending] of pendingSecurityPolicies) {
                            if (pending.expiresAt <= Date.now()) pendingSecurityPolicies.delete(id);
                        }
                        if (pendingSecurityPolicies.size >= 100) {
                            pendingSecurityPolicies.delete(pendingSecurityPolicies.keys().next().value);
                        }
                        const confirmationId = randomUUID();
                        pendingSecurityPolicies.set(confirmationId, {
                            guildId: interaction.guild.id,
                            requesterId: interaction.user.id,
                            policy,
                            expiresAt: Date.now() + 5 * 60 * 1000
                        });
                        await interaction.reply({
                            ...buildSecurityPolicyPreviewPanel(policy, confirmationId, interaction.user.id),
                            flags: MessageFlags.Ephemeral
                        });
                    } catch (error) {
                        await interaction.reply({
                            content: error.message || "Kebijakan keamanan tidak valid.",
                            flags: MessageFlags.Ephemeral
                        });
                    }
                    return;
                }

                if (interaction.customId === "castorice:security_spam_policy_submit") {
                    const feature = await checkFeature(interaction.guildId, "security_assistant");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk mengubah kebijakan moderasi spam.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    try {
                        const enabledValue = interaction.fields.getTextInputValue("security_spam_enabled").trim().toUpperCase();
                        if (!["ON", "OFF"].includes(enabledValue)) {
                            throw new Error("Status moderasi harus berupa ON atau OFF.");
                        }
                        const policy = validateSpamPolicy({
                            enabled: enabledValue === "ON",
                            deleteThreshold: Number(interaction.fields.getTextInputValue("security_spam_delete_threshold")),
                            timeoutThreshold: Number(interaction.fields.getTextInputValue("security_spam_timeout_threshold")),
                            timeoutSeconds: Number(interaction.fields.getTextInputValue("security_spam_timeout_seconds"))
                        });
                        for (const [id, pending] of pendingSecuritySpamPolicies) {
                            if (pending.expiresAt <= Date.now()) pendingSecuritySpamPolicies.delete(id);
                        }
                        if (pendingSecuritySpamPolicies.size >= 100) {
                            pendingSecuritySpamPolicies.delete(pendingSecuritySpamPolicies.keys().next().value);
                        }
                        const confirmationId = randomUUID();
                        pendingSecuritySpamPolicies.set(confirmationId, {
                            guildId: interaction.guild.id,
                            requesterId: interaction.user.id,
                            policy,
                            expiresAt: Date.now() + 5 * 60 * 1000
                        });
                        await interaction.reply({
                            ...buildSecuritySpamPolicyPreviewPanel(policy, confirmationId, interaction.user.id),
                            flags: MessageFlags.Ephemeral
                        });
                    } catch (error) {
                        await interaction.reply({
                            content: error.message || "Kebijakan moderasi spam tidak valid.",
                            flags: MessageFlags.Ephemeral
                        });
                    }
                    return;
                }

                if (interaction.customId === "castorice:playlist_create_submit") {
                    const feature = await checkFeature(interaction.guildId, "playlists");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk mengelola playlist.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const actor = await interaction.guild.members.fetch(interaction.user.id);
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    const name = interaction.fields.getTextInputValue("playlist_name");
                    const tracks = interaction.fields.getTextInputValue("playlist_tracks")
                        .split(/\r?\n/).map(value => value.trim()).filter(Boolean);
                    await playlistService.create(interaction.guild.id, name, tracks, actor);
                    await interaction.editReply(buildPlaylistPanel(
                        interaction.guild.id,
                        await playlistService.list(interaction.guild.id),
                        0,
                        "Playlist berhasil dibuat"
                    ));
                    return;
                }

                const playlistEditMatch = interaction.customId.match(/^castorice:playlist_(add|rename)_submit:(.+)$/);
                if (playlistEditMatch) {
                    const feature = await checkFeature(interaction.guildId, "playlists");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk mengelola playlist.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const [, action, playlistId] = playlistEditMatch;
                    const actor = await interaction.guild.members.fetch(interaction.user.id);
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    if (action === "rename") {
                        await playlistService.rename(
                            interaction.guild.id,
                            playlistId,
                            interaction.fields.getTextInputValue("playlist_name"),
                            actor
                        );
                    } else {
                        const tracks = interaction.fields.getTextInputValue("playlist_tracks")
                            .split(/\r?\n/).map(value => value.trim()).filter(Boolean);
                        await playlistService.addTracks(interaction.guild.id, playlistId, tracks, actor);
                    }
                    await interaction.editReply(buildPlaylistPanel(
                        interaction.guild.id,
                        await playlistService.list(interaction.guild.id),
                        0,
                        action === "rename" ? "Nama playlist diperbarui" : "Track berhasil ditambahkan"
                    ));
                    return;
                }

                if (interaction.customId === "castorice:translator_submit") {
                    const feature = await checkFeature(interaction.guildId, "translator");
                    if (!feature.allowed) {
                        await interaction.reply({
                            content: feature.reason,
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    let result;
                    try {
                        result = await translatorFactory().translate({
                            text: interaction.fields.getTextInputValue("translator_text"),
                            source: interaction.fields.getTextInputValue("translator_source").trim(),
                            target: interaction.fields.getTextInputValue("translator_target").trim()
                        });
                    } catch (error) {
                        await interaction.editReply({
                            content: error.message || "Terjemahan gagal diproses."
                        });
                        return;
                    }
                    const chunks = splitForDiscord(result.translatedText);
                    await interaction.editReply({
                        content: `${translationLabel(result)}\n${chunks.shift()}`
                    });

                    for (const chunk of chunks) {
                        await interaction.followUp({
                            content: chunk,
                            flags: MessageFlags.Ephemeral
                        });
                    }
                    return;
                }

                if (interaction.customId === "castorice:music_search_submit") {
                    const feature = await checkFeature(interaction.guildId, "music");
                    if (!feature.allowed) {
                        await interaction.reply({
                            content: feature.reason,
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    if (!interaction.guild) {
                        await interaction.reply({
                            content: "Music hanya dapat digunakan di server.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    await interaction.deferReply();

                    const input = interaction.fields.getTextInputValue(
                        "music_search_input"
                    );

                    const results = await music.searchTracks(input);

                    await interaction.editReply(
                        buildSearchResultsPanel(results)
                    );

                    const message = await interaction.fetchReply();

                    searchResults.set(message.id, results);

                    if (searchResults.size > 100) {
                        const oldestId = searchResults.keys().next().value;
                        searchResults.delete(oldestId);
                    }

                    return;
                }
                if (interaction.customId === "castorice:radio_search_submit") {
                    const feature = await checkFeature(interaction.guildId, "music");
                    if (!feature.allowed) {
                        await interaction.reply({
                            content: feature.reason,
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    if (!interaction.guild) {
                        await interaction.reply({
                            content: "Radio Discovery hanya dapat digunakan di server.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    await interaction.deferReply();
                    const stations = await radioDiscovery.search(
                        interaction.fields.getTextInputValue("radio_search_input")
                    );
                    await interaction.editReply(buildRadioResultsPanel(stations));
                    const resultMessage = await interaction.fetchReply();
                    radioSearchResults.set(resultMessage.id, stations);
                    if (radioSearchResults.size > 100) {
                        radioSearchResults.delete(radioSearchResults.keys().next().value);
                    }
                    return;
                }
                if (interaction.customId === "castorice:music_submit") {
                    const feature = await checkFeature(interaction.guildId, "music");
                    if (!feature.allowed) {
                        await interaction.reply({
                            content: feature.reason,
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    if (!interaction.guild) {
                        await interaction.reply({
                            content: "Music hanya dapat digunakan di server.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    await interaction.deferUpdate();

                    const member = await interaction.guild.members.fetch(
                        interaction.user.id
                    );

                    const input = interaction.fields.getTextInputValue("music_input");

                    const result = await music.addToQueue(
                        interaction.guild,
                        member,
                        input
                    );

                    const message = result.started
                        ? `Memulai pemutaran: **${result.track.input}**`
                        : `Ditambahkan ke antrean posisi **${result.position}**: **${result.track.input}**`;

                    await interaction.editReply({
                        ...buildMusicPanel(interaction.guild),
                        content: message
                    });

                    const panelMessage = await interaction.fetchReply();
                    musicPanelUpdater.start(interaction, panelMessage.id);
                    return;
                }
            }

            if (interaction.isStringSelectMenu()) {
                if (interaction.customId === "castorice:voice_help_select") {
                    try {
                        const panel = buildVoiceGreeterHelpCenter(interaction.values?.[0]);
                        await interaction.update({
                            content: interaction.message.content,
                            ...panel
                        });
                    } catch (error) {
                        if (error instanceof RangeError) {
                            await interaction.reply({
                                content: "Topik Help Center tidak valid. Pilih topik dari menu.",
                                flags: MessageFlags.Ephemeral
                            });
                            return;
                        }
                        throw error;
                    }
                    return;
                }

                if (interaction.customId === "castorice:translator_language_select") {
                    const feature = await checkFeature(interaction.guildId, "translator");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const targetLanguage = interaction.values?.[0];
                    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(targetLanguage || "")) {
                        await interaction.reply({ content: "Pilihan bahasa tujuan tidak valid.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.showModal(buildTranslatorModal({ targetLanguage }));
                    return;
                }

                if (interaction.customId === "castorice:template_delete_select") {
                    const feature = await checkFeature(interaction.guildId, "server_templates");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk menghapus template.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const templateId = interaction.values?.[0];
                    if (!templateId) {
                        await interaction.reply({ content: "Pilih template yang ingin dihapus.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const template = await serverTemplateService.get(interaction.guild.id, templateId);
                    const confirmationId = randomUUID();
                    for (const [id, pending] of pendingTemplateDeletions) {
                        if (pending.expiresAt <= Date.now() || (
                            pending.guildId === interaction.guild.id &&
                            pending.requesterId === interaction.user.id
                        )) pendingTemplateDeletions.delete(id);
                    }
                    pendingTemplateDeletions.set(confirmationId, {
                        guildId: interaction.guild.id,
                        templateId,
                        requesterId: interaction.user.id,
                        expiresAt: Date.now() + 5 * 60 * 1000,
                        executing: false
                    });
                    await interaction.reply({
                        ...buildServerTemplateDeleteConfirmPanel(template, confirmationId, interaction.user.id),
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                if (interaction.customId.startsWith("castorice:playlist_manage_select:")) {
                    const playlistFeature = await checkFeature(interaction.guildId, "playlists");
                    if (!playlistFeature.allowed) {
                        await interaction.reply({ content: playlistFeature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const [action, playlistId] = interaction.values[0].split(":");
                    const data = await playlistService.list(interaction.guild.id);
                    const playlist = data.items[playlistId];
                    if (!playlist) throw new Error("Playlist tidak ditemukan.");
                    if (action === "play") {
                        const musicFeature = await checkFeature(interaction.guildId, "music");
                        if (!musicFeature.allowed) {
                            await interaction.reply({ content: musicFeature.reason, flags: MessageFlags.Ephemeral });
                            return;
                        }
                        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                        const member = await interaction.guild.members.fetch(interaction.user.id);
                        const result = await enqueuePlaylist({ guild: interaction.guild, member, playlist, addToQueue: playlistMusic.addToQueue });
                        const message = result.partial
                            ? `${result.added}/${result.total} track masuk antrean. Queue berhenti: ${result.error.message}`
                            : `${result.added} track dari **${playlist.name}** masuk antrean.`;
                        await interaction.editReply({ content: message, allowedMentions: { parse: [] } });
                        return;
                    }
                    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk mengelola playlist.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (action === "add" || action === "rename") {
                        await interaction.showModal(buildPlaylistEditModal(action, playlistId));
                        return;
                    }
                    if (action === "delete") {
                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`castorice:playlist_delete_confirm:${playlistId}:${interaction.user.id}`)
                                .setLabel("Konfirmasi Hapus")
                                .setStyle(ButtonStyle.Danger)
                        );
                        await interaction.reply({
                            content: `Hapus playlist **${playlist.name}** secara permanen?`,
                            components: [row],
                            flags: MessageFlags.Ephemeral,
                            allowedMentions: { parse: [] }
                        });
                        return;
                    }
                    return;
                }

                if (musicActions.has(interaction.customId.split(":")[1])) {
                    const feature = await checkFeature(interaction.guildId, "music");
                    if (!feature.allowed) {
                        await interaction.reply({
                            content: feature.reason,
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                }

                if (interaction.customId === "castorice:music_search_select") {
                    const results = searchResults.get(interaction.message.id);
                    const index = Number(interaction.values[0]);
                    const track = results?.[index];

                    if (!track) {
                        await interaction.reply({
                            content: "Hasil pencarian sudah tidak tersedia. Cari lagu kembali.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    await interaction.deferUpdate();

                    try {
                        const member = await interaction.guild.members.fetch(
                            interaction.user.id
                        );

                        const result = await music.addToQueue(
                            interaction.guild,
                            member,
                            track.webpageUrl
                        );

                        const notice = result.started
                            ? "Memulai pemutaran: " + result.track.title
                            : "Ditambahkan ke antrean posisi " + result.position + ": " + result.track.title;

                        const playerMessage = await interaction.channel.send(
                            buildMusicPanel(interaction.guild, {
                                track: result.started ? result.track : null,
                                notice
                            })
                        );

                        musicPanelUpdater.start(
                            interaction,
                            playerMessage.id,
                            { notice }
                        );
                        await interaction.message.delete().catch(error => {
                            console.error("[Search Message Delete Error]", error);
                        });
                    } catch (error) {
                        console.error("[Music Selection Error]", error);

                        await interaction.followUp({
                            content: "Gagal menambahkan lagu. Silakan coba kembali.",
                            flags: MessageFlags.Ephemeral
                        }).catch(() => {});
                    }

                    return;
                }
                if (interaction.customId === "castorice:music_radio_select") {
                    const stations = radioSearchResults.get(interaction.message.id);
                    const index = Number(interaction.values?.[0]);
                    const station = Number.isInteger(index) ? stations?.[index] : null;
                    if (!station) {
                        await interaction.reply({
                            content: "Hasil Radio Discovery sudah tidak tersedia. Cari stasiun kembali.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    await interaction.deferUpdate();
                    try {
                        const member = await interaction.guild.members.fetch(interaction.user.id);
                        const result = await radioMusicManager.addRadioStation(
                            interaction.guild,
                            member,
                            station
                        );
                        const notice = result.started
                            ? `Memulai radio: ${result.track.title}`
                            : `Radio ditambahkan ke antrean posisi ${result.position}: ${result.track.title}`;
                        const playerMessage = await interaction.channel.send(
                            buildMusicPanel(interaction.guild, { notice })
                        );
                        musicPanelUpdater.start(interaction, playerMessage.id, { notice });
                        radioSearchResults.delete(interaction.message.id);
                        await interaction.message.delete().catch(error => {
                            console.error("[Radio Search Message Delete Error]", error);
                        });
                    } catch (error) {
                        console.error("[Radio Selection Error]", error);
                        await interaction.followUp({
                            content: error.message || "Gagal memutar stasiun radio.",
                            flags: MessageFlags.Ephemeral
                        });
                    }
                    return;
                }
                if (interaction.customId === "castorice:music_volume") {
                    const access = await checkMusicAccess(
                        interaction.guild,
                        interaction.user.id
                    );

                    if (!access.allowed) {
                        await interaction.reply({
                            content: access.reason,
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    await interaction.deferUpdate();

                    music.setVolume(
                        interaction.guild,
                        interaction.values[0]
                    );

                    await interaction.editReply(
                        musicPanelUpdater.getPanel(
                            interaction.guild,
                            interaction.message.id
                        )
                    );

                    musicPanelUpdater.start(interaction);
                    return;
                }
            }

            if (interaction.isButton()) {
                if (interaction.customId.startsWith("owner:")) {
                    if (!isOwner(interaction.user.id)) {
                        await interaction.reply({
                            content: "Akses ditolak.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const action = interaction.customId.split(":")[1];

                    if (action === "open") {
                        await interaction.reply({
                            ...buildOwnerPanel(client),
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    if (action === "home") {
                        await interaction.update(buildOwnerPanel(client));
                        return;
                    }

                    const panel = buildOwnerSubPanel(action, client);

                    if (panel) {
                        await interaction.update(panel);
                    }
                    return;
                }

                if (!interaction.customId.startsWith("castorice:")) return;

                const parts = interaction.customId.split(":");
                const action = parts[1];

                if (action === "ai_global_open" || action === "ai_global_toggle") {
                    if (!ownerCheck(interaction.user?.id)) {
                        await interaction.reply({
                            content: "Akses ditolak. Kontrol AI global hanya tersedia untuk pemilik bot.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    if (action === "ai_global_open") {
                        await interaction.update(await buildGlobalSettingsCenter());
                        return;
                    }
                    const current = await applyGlobalAISettings();
                    await globalAISettings.setEnabled(!current.enabled);
                    await interaction.update(await buildGlobalSettingsCenter());
                    return;
                }

                if (action === "ai_server_toggle") {
                    if (!interaction.guild || !interaction.guildId ||
                        interaction.guild.id !== interaction.guildId) {
                        await interaction.reply({
                            content: "Pengaturan AI server hanya dapat digunakan di server Discord yang sesuai.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({
                            content: "Kamu membutuhkan izin Manage Server untuk mengubah AI Chat server.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    const settings = await applyGlobalAISettings();
                    const currentState = await getFeatureState(interaction.guildId, "ai_chat");
                    if (!currentState.enabled && !settings.enabled) {
                        await interaction.reply({
                            content: "AI global sedang nonaktif. Pemilik bot harus mengaktifkannya sebelum admin server dapat mengaktifkan AI Chat.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    await setFeatureEnabled(
                        interaction.guildId,
                        "ai_chat",
                        !currentState.enabled
                    );
                    await interaction.update(await buildSettingsCenter(
                        interaction.guildId,
                        true,
                        interaction.user?.id
                    ));
                    return;
                }

                const settingsEntry = Object.entries(SETTINGS_ACTION_IDS)
                    .find(([, customId]) => interaction.customId === customId);
                if (settingsEntry) {
                    const [settingsAction] = settingsEntry;
                    if (settingsAction === "tutor") {
                        await interaction.update(buildVoiceGreeterHelpCenter("overview"));
                    } else {
                        await interaction.reply({
                            content: unavailableSettingsMessage(settingsAction),
                            flags: MessageFlags.Ephemeral
                        });
                    }
                    return;
                }

                if (action === "voice_help_overview") {
                    await interaction.update({
                        content: interaction.message.content,
                        ...buildVoiceGreeterHelpCenter("overview")
                    });
                    return;
                }

                if (action === "template_delete_confirm" || action === "template_delete_cancel") {
                    const [, , confirmationId, requesterId] = parts;
                    if (requesterId !== interaction.user.id) {
                        await interaction.reply({ content: "Konfirmasi ini hanya dapat digunakan oleh pemintanya.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const pending = pendingTemplateDeletions.get(confirmationId);
                    if (!pending || pending.requesterId !== requesterId || pending.guildId !== interaction.guildId || pending.expiresAt <= Date.now()) {
                        pendingTemplateDeletions.delete(confirmationId);
                        await interaction.reply({ content: "Konfirmasi sudah kedaluwarsa atau tidak berlaku di server ini. Pilih template lagi.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const feature = await checkFeature(interaction.guildId, "server_templates");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk menghapus template.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (action === "template_delete_cancel") {
                        pendingTemplateDeletions.delete(confirmationId);
                        await interaction.reply({ content: "Penghapusan template dibatalkan.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (pending.executing) {
                        await interaction.reply({ content: "Penghapusan template ini sedang diproses.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    pending.executing = true;
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    try {
                        const actor = await interaction.guild.members.fetch(interaction.user.id);
                        const removed = await serverTemplateService.remove(interaction.guild, actor, pending.templateId);
                        pendingTemplateDeletions.delete(confirmationId);
                        await interaction.editReply(buildServerTemplatesPanel(
                            interaction.guild.id,
                            await serverTemplateService.list(interaction.guild.id),
                            removed ? "Template dihapus dari penyimpanan server." : "Template sudah tidak ada."
                        ));
                    } catch (error) {
                        pending.executing = false;
                        await interaction.editReply({ content: error.message || "Template gagal dihapus." });
                    }
                    return;
                }

                if (action === "greeter_configure") {
                    const feature = await checkFeature(interaction.guildId, "voice_greeter");
                    if (!feature.allowed) {
                        await interaction.reply({
                            content: feature.reason,
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({
                            content: "Kamu membutuhkan izin Manage Server untuk mengubah pesan Voice Greeter.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    await interaction.showModal(
                        buildVoiceGreeterModal(await voiceGreeter.getGreeting(interaction.guild.id))
                    );
                    return;
                }

                if (musicActions.has(action)) {
                    const feature = await checkFeature(interaction.guildId, "music");
                    if (!feature.allowed) {
                        await interaction.reply({
                            content: feature.reason,
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                }

                if (translatorActions.has(action)) {
                    const feature = await checkFeature(interaction.guildId, "translator");
                    if (!feature.allowed) {
                        await interaction.reply({
                            content: feature.reason,
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                }

                if (protectedMusicActions.has(action)) {
                    const access = await checkMusicAccess(
                        interaction.guild,
                        interaction.user.id
                    );

                    if (!access.allowed) {
                        await interaction.reply({
                            content: access.reason,
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                }

                if (action === "music_open_player") {
                    await interaction.deferReply();

                    const playerMessage = await interaction.editReply(
                        buildMusicPanel(interaction.guild)
                    );

                    musicPanelUpdater.start(
                        interaction,
                        playerMessage.id
                    );
                    return;
                }

                if (action === "translator_open") {
                    await interaction.showModal(buildTranslatorModal());
                    return;
                }

                if (action === "translator_languages" || action === "translator_languages_page") {
                    const page = action === "translator_languages_page"
                        ? Number(parts[2])
                        : 0;
                    if (!Number.isInteger(page) || page < 0) {
                        await interaction.reply({ content: "Halaman bahasa tidak valid.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    try {
                        const languages = await translatorFactory().getLanguages();
                        await interaction.editReply(buildTranslatorLanguagePanel(languages, page));
                    } catch (error) {
                        await interaction.editReply({
                            content: error.message || "Daftar bahasa tidak tersedia saat ini."
                        });
                    }
                    return;
                }

                if (action === "security_audit") {
                    const feature = await checkFeature(interaction.guildId, "security_assistant");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk menjalankan audit keamanan.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    try {
                        const actor = await interaction.guild.members.fetch(interaction.user.id);
                        const report = await securityAssistant.audit(interaction.guild, actor);
                        await interaction.editReply(buildSecurityReportPanel(report));
                    } catch (error) {
                        await interaction.editReply({ content: error.message || "Security Assistant gagal menjalankan audit." });
                    }
                    return;
                }

                if (action === "security_policy") {
                    const feature = await checkFeature(interaction.guildId, "security_assistant");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk mengubah kebijakan keamanan.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const policy = await securityAssistant.getPolicy(interaction.guildId);
                    await interaction.showModal(buildSecurityPolicyModal(policy));
                    return;
                }

                if (action === "security_policy_confirm") {
                    const [, , confirmationId, requesterId] = parts;
                    const pending = pendingSecurityPolicies.get(confirmationId);
                    if (
                        !pending ||
                        pending.requesterId !== interaction.user.id ||
                        requesterId !== interaction.user.id
                    ) {
                        await interaction.reply({ content: "Konfirmasi kebijakan ini kedaluwarsa atau hanya dapat digunakan oleh pemintanya.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (pending.expiresAt <= Date.now() || pending.guildId !== interaction.guildId) {
                        pendingSecurityPolicies.delete(confirmationId);
                        await interaction.reply({ content: "Konfirmasi kebijakan kedaluwarsa atau bukan untuk server ini.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const feature = await checkFeature(interaction.guildId, "security_assistant");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk mengonfirmasi kebijakan keamanan.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    try {
                        const actor = await interaction.guild.members.fetch(interaction.user.id);
                        const policy = await securityAssistant.setPolicy(interaction.guild, actor, pending.policy);
                        pendingSecurityPolicies.delete(confirmationId);
                        await interaction.editReply({
                            content: `Kebijakan alert-only ${policy.enabled ? "diaktifkan" : "dinonaktifkan"}. Tidak ada tindakan otomatis terhadap anggota.`
                        });
                    } catch (error) {
                        await interaction.editReply({ content: error.message || "Kebijakan keamanan gagal disimpan." });
                    }
                    return;
                }

                if (action === "security_spam_policy") {
                    const feature = await checkFeature(interaction.guildId, "security_assistant");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk mengubah kebijakan moderasi spam.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    try {
                        const policy = await securityAssistant.getSpamPolicy(interaction.guildId);
                        await interaction.showModal(buildSecuritySpamPolicyModal(policy));
                    } catch (error) {
                        await interaction.reply({ content: error.message || "Kebijakan moderasi spam gagal dimuat.", flags: MessageFlags.Ephemeral });
                    }
                    return;
                }

                if (action === "security_spam_policy_confirm") {
                    const [, , confirmationId, requesterId] = parts;
                    const pending = pendingSecuritySpamPolicies.get(confirmationId);
                    if (
                        !pending ||
                        pending.requesterId !== interaction.user.id ||
                        requesterId !== interaction.user.id
                    ) {
                        await interaction.reply({ content: "Konfirmasi moderasi ini kedaluwarsa atau hanya dapat digunakan oleh pemintanya.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (pending.expiresAt <= Date.now() || pending.guildId !== interaction.guildId) {
                        pendingSecuritySpamPolicies.delete(confirmationId);
                        await interaction.reply({ content: "Konfirmasi moderasi kedaluwarsa atau bukan untuk server ini.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const feature = await checkFeature(interaction.guildId, "security_assistant");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk mengonfirmasi kebijakan moderasi spam.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    try {
                        const actor = await interaction.guild.members.fetch(interaction.user.id);
                        const policy = await securityAssistant.setSpamPolicy(interaction.guild, actor, pending.policy);
                        pendingSecuritySpamPolicies.delete(confirmationId);
                        await interaction.editReply({
                            content: `Kebijakan moderasi spam ${policy.enabled ? "diaktifkan" : "dinonaktifkan"} untuk server ini.`
                        });
                    } catch (error) {
                        await interaction.editReply({ content: error.message || "Kebijakan moderasi spam gagal disimpan." });
                    }
                    return;
                }

                if (action === "security_history") {
                    const feature = await checkFeature(interaction.guildId, "security_assistant");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk melihat riwayat audit keamanan.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    try {
                        const [reports, auditEvents] = await Promise.all([
                            securityAssistant.listReports(interaction.guildId),
                            typeof securityAssistant.listAuditLog === "function"
                                ? securityAssistant.listAuditLog(interaction.guildId, 20)
                                : []
                        ]);
                        await interaction.editReply(buildSecurityHistoryPanel(reports, auditEvents));
                    } catch (error) {
                        await interaction.editReply({ content: error.message || "Riwayat audit keamanan gagal dimuat." });
                    }
                    return;
                }

                if (action === "server_templates") {
                    const feature = await checkFeature(interaction.guildId, "server_templates");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.update(buildFeaturePanel("server_templates"));
                    return;
                }

                if (action === "templates_open" || action === "templates_refresh") {
                    const feature = await checkFeature(interaction.guildId, "server_templates");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk melihat template server.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.update(buildServerTemplatesPanel(
                        interaction.guild.id,
                        await serverTemplateService.list(interaction.guild.id)
                    ));
                    return;
                }

                if (action === "template_create") {
                    const feature = await checkFeature(interaction.guildId, "server_templates");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk membuat template.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.showModal(buildServerTemplateCreateModal());
                    return;
                }

                if (action === "template_preview_open") {
                    const feature = await checkFeature(interaction.guildId, "server_templates");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk preview template.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const mode = parts[2] || "smart_merge";
                    if (!["create", "rebuild", "clone", "smart_merge"].includes(mode)) {
                        await interaction.reply({ content: "Mode template tidak valid. Buka preview baru dari Dashboard atau AI Tag.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.showModal(buildServerTemplatePreviewModal(mode));
                    return;
                }

                if (action === "template_apply") {
                    const [, , previewId, requesterId] = parts;
                    if (requesterId !== interaction.user.id) {
                        await interaction.reply({ content: "Preview ini hanya dapat diterapkan oleh pemintanya.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const pending = pendingTemplatePreviews.get(previewId);
                    if (!pending) {
                        await interaction.reply({ content: "Preview sudah kedaluwarsa atau bukan untuk server ini. Buat preview baru.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (pending.requesterId !== interaction.user.id || requesterId !== pending.requesterId) {
                        await interaction.reply({ content: "Preview ini hanya dapat diterapkan oleh pemintanya.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (pending.expiresAt <= Date.now() || pending.targetGuildId !== interaction.guildId) {
                        pendingTemplatePreviews.delete(previewId);
                        await interaction.reply({ content: "Preview sudah kedaluwarsa atau bukan untuk server ini. Buat preview baru.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const feature = await checkFeature(interaction.guildId, "server_templates");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk menerapkan template.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (pending.executing || activeTemplateApplyGuilds.has(interaction.guildId)) {
                        await interaction.reply({ content: "Template ini sedang diterapkan.", flags: MessageFlags.Ephemeral });
                        return;
                    }

                    pending.executing = true;
                    activeTemplateApplyGuilds.add(interaction.guildId);
                    try {
                        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                        const sourceGuild = await client.guilds.fetch(pending.sourceGuildId);
                        const [sourceActor, targetActor] = await Promise.all([
                            sourceGuild.members.fetch(interaction.user.id),
                            interaction.guild.members.fetch(interaction.user.id)
                        ]);
                        const result = await serverTemplateExecutor.execute({
                            sourceGuild,
                            targetGuild: interaction.guild,
                            sourceActor,
                            targetActor,
                            templateId: pending.templateId,
                            mode: pending.mode,
                            expectedPlanHash: pending.planHash,
                            confirmation: pending.confirmation
                        });
                        pendingTemplatePreviews.delete(previewId);
                        await interaction.editReply({
                            content: `Template diterapkan (${result.mode}). ${result.completed.length} operasi berhasil.`
                        });
                    } catch (error) {
                        pendingTemplatePreviews.delete(previewId);
                        const message = error.message || "Template gagal diterapkan.";
                        if (interaction.deferred) {
                            await interaction.editReply({ content: message });
                        } else {
                            await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
                        }
                    } finally {
                        activeTemplateApplyGuilds.delete(interaction.guildId);
                        pending.executing = false;
                    }
                    return;
                }

                if (action === "playlists") {
                    const feature = await checkFeature(interaction.guildId, "playlists");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.update(buildFeaturePanel("playlists"));
                    return;
                }

                if (action === "playlists_refresh") {
                    const feature = await checkFeature(interaction.guildId, "playlists");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.update(buildPlaylistPanel(
                        interaction.guild.id,
                        await playlistService.list(interaction.guild.id),
                        Number(parts[2] || 0)
                    ));
                    return;
                }

                if (action === "playlist_create") {
                    const feature = await checkFeature(interaction.guildId, "playlists");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk mengelola playlist.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    await interaction.showModal(buildPlaylistCreateModal());
                    return;
                }

                if (action === "playlist_delete_confirm") {
                    if (parts[3] !== interaction.user.id) {
                        await interaction.reply({ content: "Konfirmasi ini hanya dapat digunakan oleh pemintanya.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const feature = await checkFeature(interaction.guildId, "playlists");
                    if (!feature.allowed) {
                        await interaction.reply({ content: feature.reason, flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({ content: "Kamu membutuhkan izin Manage Server untuk mengelola playlist.", flags: MessageFlags.Ephemeral });
                        return;
                    }
                    const actor = await interaction.guild.members.fetch(interaction.user.id);
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                    const removed = await playlistService.remove(interaction.guild.id, parts[2], actor);
                    await interaction.editReply(buildPlaylistPanel(
                        interaction.guild.id,
                        await playlistService.list(interaction.guild.id),
                        0,
                        removed ? "Playlist dihapus" : "Playlist sudah tidak ada"
                    ));
                    return;
                }

                if (action === "music") {
                    await interaction.update(buildMusicPanel(interaction.guild));
                    musicPanelUpdater.start(interaction, interaction.message.id, {
                        mode: "music"
                    });
                    return;
                }

                if (action === "music_lyrics") {
                    const session = music.getSession(interaction.guild.id);
                    const track = session?.currentTrack;

                    if (!track) {
                        await interaction.reply({
                            content: "Belum ada lagu yang sedang diputar.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    if (track.radioStream) {
                        await interaction.reply({
                            content: "Metadata lirik tidak tersedia untuk live radio.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    await interaction.deferUpdate();

                    let result;

                    try {
                        result = await searchLyrics(track);
                    } catch (error) {
                        console.error("[Lyrics Search Error]", error);

                        result = {
                            found: false,
                            synced: false,
                            lyrics: [],
                            plainLyrics: ""
                        };
                    }

                    await interaction.message.edit(
                        buildLyricsPanel(interaction.guild, result)
                    );

                    musicPanelUpdater.start(
                        interaction,
                        interaction.message.id,
                        {
                            mode: "lyrics",
                            result
                        }
                    );
                    return;
                }

                if (action === "lyrics_translate") {
                    const translatorFeature = await checkFeature(interaction.guildId, "translator");
                    if (!translatorFeature.allowed) {
                        await interaction.reply({
                            content: translatorFeature.reason,
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const session = music.getSession(interaction.guild.id);
                    const track = session?.currentTrack;
                    if (!track) {
                        await interaction.reply({
                            content: "Belum ada lagu yang sedang diputar.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    if (track.radioStream) {
                        await interaction.reply({
                            content: "Terjemahan lirik tidak tersedia untuk live radio.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    await interaction.deferUpdate();
                    const result = await lyricsSearch(track);
                    if (!result?.found) {
                        await interaction.followUp({
                            content: "Lirik lagu ini tidak tersedia untuk diterjemahkan.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const translatedLyrics = await translateLyrics(
                        result,
                        translatorFactory(),
                        { target: "id" }
                    );
                    await interaction.message.edit(
                        buildLyricsPanel(interaction.guild, result, translatedLyrics)
                    );
                    musicPanelUpdater.start(interaction, interaction.message.id, {
                        mode: "lyrics",
                        result,
                        translatedLyrics
                    });
                    return;
                }
                if (action === "music_search") {
                    await interaction.showModal(buildSearchModal());
                    return;
                }
                if (action === "music_radio_search") {
                    await interaction.showModal(buildRadioSearchModal());
                    return;
                }
                if (action === "music_play") {
                    await interaction.showModal(buildPlayModal());
                    return;
                }

                if (action === "music_queue") {
                    musicPanelUpdater.stop(interaction.message.id);
                    await interaction.update(
                        buildQueuePanel(interaction.guild)
                    );
                    return;
                }

                if (action === "music_seek_back") {
                    await interaction.deferUpdate().catch(() => {});
                    try {
                        await music.seek(interaction.guild, -5);
                    } catch (seekError) {
                        console.error("[Seek Back Error]", seekError.message);
                    }
                    await interaction.editReply(musicPanelUpdater.getPanel(interaction.guild, interaction.message.id)).catch(() => {});
                    musicPanelUpdater.start(interaction);
                    return;
                }

                if (action === "music_seek_forward") {
                    await interaction.deferUpdate().catch(() => {});
                    try {
                        await music.seek(interaction.guild, 5);
                    } catch (seekError) {
                        console.error("[Seek Forward Error]", seekError.message);
                    }
                    await interaction.editReply(musicPanelUpdater.getPanel(interaction.guild, interaction.message.id)).catch(() => {});
                    musicPanelUpdater.start(interaction);
                    return;
                }

                if (action === "queue_remove") {
                    const selection = queueSelections.get(interaction.message.id);
                    const session = music.getSession(interaction.guild);

                    if (!selection || !session) {
                        await interaction.reply({
                            content: "Pilih lagu yang ingin dihapus terlebih dahulu.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const currentTrack = session.queue[selection.index];

                    if (!currentTrack || currentTrack.input !== selection.input) {
                        queueSelections.delete(interaction.message.id);
                        await interaction.update({
                            ...buildQueuePanel(interaction.guild),
                            content: "Antrean berubah. Pilih lagu kembali."
                        });
                        return;
                    }

                    const removed = music.removeFromQueue(
                        interaction.guild,
                        selection.index
                    );

                    queueSelections.delete(interaction.message.id);

                    await interaction.update({
                        ...buildQueuePanel(interaction.guild),
                        content: `Dihapus dari antrean: **${removed.input}**`
                    });
                    return;
                }

                if (action === "queue_delete") {
                    await interaction.deferUpdate();

                    const index = Number(parts[2]);

                    if (!Number.isInteger(index)) {
                        await interaction.editReply({
                            content: "Pilihan lagu tidak valid.",
                            ...buildQueuePanel(interaction.guild)
                        });
                        return;
                    }

                    const removed = music.removeFromQueue(
                        interaction.guild,
                        index
                    );

                    await interaction.editReply({
                        content: `Dihapus dari antrean: **${removed.input}**`,
                        ...buildQueuePanel(interaction.guild)
                    });
                    return;
                }

                if (action === "queue_page") {
                    const page = Number(parts[2]);

                    await interaction.update(
                        buildQueuePanel(interaction.guild, page)
                    );
                    return;
                }

                if (action === "music_pause") {
                    await interaction.deferUpdate();
                    music.pause(interaction.guild);
                    await interaction.editReply(musicPanelUpdater.getPanel(interaction.guild, interaction.message.id));
                    musicPanelUpdater.start(interaction);
                    return;
                }

                if (action === "music_resume") {
                    await interaction.deferUpdate();
                    music.resume(interaction.guild);
                    await interaction.editReply(musicPanelUpdater.getPanel(interaction.guild, interaction.message.id));
                    musicPanelUpdater.start(interaction);
                    return;
                }

                if (action === "music_next") {
                    await interaction.deferUpdate();
                    await music.next(interaction.guild);
                    await interaction.editReply(musicPanelUpdater.getPanel(interaction.guild, interaction.message.id));
                    musicPanelUpdater.start(interaction);
                    return;
                }

                if (action === "music_autoplay") {
                    await interaction.deferUpdate();
                    const session = music.getSession(interaction.guild);
                    const enabled = music.setAutoplay(interaction.guild, !session?.autoplayEnabled);
                    await interaction.editReply(buildMusicPanel(interaction.guild, {
                        notice: `Autoplay ${enabled ? "diaktifkan" : "dinonaktifkan"}.`
                    }));
                    musicPanelUpdater.start(interaction);
                    return;
                }

                if (action === "music_previous") {
                    await interaction.deferUpdate();
                    await music.previous(interaction.guild);
                    await interaction.editReply(musicPanelUpdater.getPanel(interaction.guild, interaction.message.id));
                    musicPanelUpdater.start(interaction);
                    return;
                }

                if (action === "music_stop") {
                    await interaction.deferUpdate();
                    await music.stop(interaction.guild);
                    musicPanelUpdater.stop(interaction.message.id);
                    await interaction.editReply(buildMusicPanel(interaction.guild));
                    return;
                }

                if (action === "settings") {
                    await interaction.update(
                        await buildSettingsCenter(
                            interaction.guildId,
                            interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild),
                            interaction.user?.id
                        )
                    );
                    return;
                }

                if (action === "feature_selection") {
                    if (!interaction.guild ||
                        interaction.guild.id !== interaction.guildId ||
                        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({
                            content: "Kamu membutuhkan izin Manage Server untuk membuka pengaturan fitur server.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }
                    const settings = await applyGlobalAISettings();
                    await interaction.update(await buildFeatureSelectionPanel(
                        interaction.guild.id,
                        { globalAIEnabled: settings.enabled }
                    ));
                    return;
                }

                if (action === "feature_toggle") {
                    if (!interaction.guild ||
                        interaction.guild.id !== interaction.guildId ||
                        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                        await interaction.reply({
                            content: "Kamu membutuhkan izin Manage Server untuk mengubah pengaturan fitur.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const featureId = parts[2];

                    if (!featureId) {
                        await interaction.reply({
                            content: "ID fitur tidak valid.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const guildId = interaction.guild.id;
                    const currentState = await getFeatureState(
                        guildId,
                        featureId
                    );

                    if (!currentState.implemented) {
                        await interaction.reply({
                            content: "Fitur ini belum tersedia.",
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    if (featureId === "ai_chat" && !currentState.enabled) {
                        const settings = await applyGlobalAISettings();
                        if (!settings.enabled) {
                            await interaction.reply({
                                content: "AI global sedang nonaktif. Pemilik bot harus mengaktifkannya sebelum AI Chat dapat diaktifkan untuk server ini.",
                                flags: MessageFlags.Ephemeral
                            });
                            return;
                        }
                    }

                    await setFeatureEnabled(
                        guildId,
                        featureId,
                        !currentState.enabled
                    );

                    const settings = await applyGlobalAISettings();
                    await interaction.update(await buildFeatureSelectionPanel(
                        guildId,
                        { globalAIEnabled: settings.enabled }
                    ));
                    return;
                }

                if (action === "home") {
                    musicPanelUpdater.stop(interaction.message.id);
                    await interaction.update(
                        buildDashboard(interaction.guild)
                    );
                    return;
                }

                const panel = buildFeaturePanel(action);

                if (panel) {
                    await interaction.update(panel);
                }
            }
        } catch (error) {
            console.error("[Interaction Error]", error);

            const response = {
                content: error.message || "Terjadi kesalahan.",
                flags: MessageFlags.Ephemeral
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(response).catch(() => {});
            } else {
                await interaction.reply(response).catch(() => {});
            }
        }
    };
    const handleMessageCreate = async message => {
        if (!message?.guild || !client?.user) return;
        const trigger = extractTrigger(message, client.user);
        if (!trigger.isTriggered) return;

        const commandText = trigger.cleanText;
        const providerSettingsIntent = parseAIProviderSettingsIntent(commandText);
        if (providerSettingsIntent) {
            if (!ownerCheck(message.author.id)) {
                await message.reply({
                    content: "Status AI global hanya dapat dilihat oleh pemilik bot.",
                    allowedMentions: { parse: [] }
                });
                return;
            }
            const globalSettings = await applyGlobalAISettings();
            await replyToOwnerPrivately(message, [
                `AI global: ${globalSettings.enabled ? "aktif" : "nonaktif"}.`,
                formatAIProviderStatus(getProviderStatus())
            ].join("\n"), logger);
            return;
        }

        try {
            if (voiceCenterTagRouter && await voiceCenterTagRouter({ message, commandText })) return;
            if (serverTemplateTagRouter && await serverTemplateTagRouter({ message, commandText })) return;
            if (await securityTagRouter({ message, commandText })) return;
            if (await playlistTagRouter({ message, commandText })) return;
            if (await voiceAITagRouter({ message, commandText })) return;
            if (await voiceGreeterTagRouter({ message, commandText })) return;
            if (voiceTagRouter && await voiceTagRouter({ message, commandText })) return;
        } catch (error) {
            await message.reply(error.message || "Playlist gagal diproses.");
            return;
        }

        const settingsRequest = parseSettingsRequest(commandText);
        if (settingsRequest) {
            if (settingsRequest === "tutor") {
                await message.reply(buildVoiceGreeterHelpCenter("overview"));
            } else {
                await message.reply({
                    content: unavailableSettingsMessage(settingsRequest),
                    allowedMentions: { parse: [] }
                });
            }
            return;
        }

        const resolvedIntent = resolveIntent(commandText);
        if (resolvedIntent.domain === "auto_kick" || resolvedIntent.domain === "manual_kick") {
            await message.reply({
                content: "Fitur kick otomatis/manual melalui natural language belum tersedia. Tidak ada anggota yang dikeluarkan; tindakan kick hanya boleh dilakukan melalui alur Discord yang memeriksa izin, kebijakan server, konfirmasi, dan audit.",
                allowedMentions: { parse: [] }
            });
            return;
        }
        if (["auto_disconnect", "trusted_member", "social_downloader"].includes(resolvedIntent.domain)) {
            const unavailableLabels = {
                auto_disconnect: "Auto Disconnect",
                trusted_member: "Trusted Member management",
                social_downloader: "Social Downloader"
            };
            await message.reply({
                content: `${unavailableLabels[resolvedIntent.domain]} belum tersedia melalui handler ini. Tidak ada tindakan yang dijalankan.`,
                allowedMentions: { parse: [] }
            });
            return;
        }
        if (!["conversation", "music", "translator", "playlists"].includes(resolvedIntent.domain)) {
            await message.reply({
                content: "Intent fitur ini belum terhubung ke handler aktif. Tidak ada tindakan yang dijalankan.",
                allowedMentions: { parse: [] }
            });
            return;
        }

        if (/^(?:reset|hapus|lupakan|clear|forget)(?:\s+(?:riwayat|history|percakapan|conversation|memori|memory|chat))*$/i.test(commandText.trim())) {
            aiConversationService.reset({
                guildId: message.guild.id,
                userId: message.author.id,
                channelId: message.channel?.id ? String(message.channel.id) : null
            });
            await message.reply({
                content: "Riwayat percakapan AI di channel ini telah dihapus.",
                allowedMentions: { parse: [] }
            });
            return;
        }

        const intent = parseMusicIntent(commandText);

        if (intent.type !== "help" && intent.type !== "unknown" && intent.type !== "translate") {
            const feature = await checkFeature(message.guild.id, "music");
            if (!feature.allowed) {
                await message.reply(feature.reason);
                return;
            }
        }

        if (intent.type === "help") {
            await message.reply(
                "Aku bisa mengontrol musik dan antrean, memutar playlist server, menerjemahkan teks, atau lirik lagu. Contoh: `@Castorice putar playlist Road Trip`, `@Castorice terjemahkan hello ke id`, dan `@Castorice terjemahkan lirik ke id`."
            );
            return;
        }

        if (intent.type === "unknown") {
            if (resolvedIntent.domain !== "conversation") {
                await message.reply({
                    content: "Perintah fitur ini belum dikenali oleh handler yang tersedia. Tidak ada tindakan yang dijalankan.",
                    allowedMentions: { parse: [] }
                });
                return;
            }
            let globalSettings;
            try {
                globalSettings = await applyGlobalAISettings();
            } catch {
                await replyToAIMessage(message, {
                    content: "Status AI global gagal dibaca. AI Chat dinonaktifkan sementara; hubungi pemilik bot.",
                    allowedMentions: { parse: [] }
                }, logger);
                return;
            }
            if (!globalSettings.enabled) {
                await replyToAIMessage(message, {
                    content: "AI Chat dinonaktifkan secara global oleh pemilik bot.",
                    allowedMentions: { parse: [] }
                }, logger);
                return;
            }
            const feature = await checkFeature(message.guild.id, "ai_chat");
            if (!feature.allowed) {
                await replyToAIMessage(message, feature.reason, logger);
                return;
            }

            if (aiProviderConfigurationError) {
                await replyToAIMessage(message, {
                    content: aiFailureMessage({ code: "configuration_error" }),
                    allowedMentions: { parse: [] }
                }, logger);
                return;
            }

            let result;
            try {
                if (typeof message.channel?.sendTyping === "function") {
                    try {
                        await message.channel.sendTyping();
                    } catch {}
                }
                result = await aiConversationService.respond({
                    guildId: message.guild.id,
                    userId: message.author.id,
                    channelId: message.channel?.id ? String(message.channel.id) : null,
                    text: commandText
                });
            } catch (error) {
                if (!(error instanceof AIConversationError)) {
                    logger.error?.("[Gemini AI Error]", {
                        provider: "gemini",
                        operation: ["generate", "model_discovery", "configuration"].includes(error?.operation)
                            ? error.operation
                            : "respond",
                        statusCode: Number.isInteger(error?.statusCode) &&
                            error.statusCode >= 100 && error.statusCode <= 599
                            ? error.statusCode
                            : null,
                        category: safeAIErrorCode(error)
                    });
                }
                await replyToAIMessage(message, {
                    content: aiFailureMessage(error),
                    allowedMentions: { parse: [] }
                }, logger);
                return;
            }

            if (typeof result?.text !== "string" || !result.text.trim()) {
                await replyToAIMessage(message, {
                    content: aiFailureMessage({ code: "invalid_response" }),
                    allowedMentions: { parse: [] }
                }, logger);
                return;
            }

            const chunks = splitForDiscord(result.text);
            const firstReply = await replyToAIMessage(message, {
                content: chunks.shift(),
                allowedMentions: { parse: [] }
            }, logger);
            if (!firstReply) return;
            for (const chunk of chunks) {
                try {
                    await message.channel.send({
                        content: chunk,
                        allowedMentions: { parse: [] }
                    });
                } catch {
                    logger.error?.("[AI Chat Discord Reply Error]", "chunk_send_failed");
                    return;
                }
            }
            return;
        }

        let response;

        try {
            if (intent.type === "translate_lyrics") {
                const translatorFeature = await checkFeature(message.guild.id, "translator");
                if (!translatorFeature.allowed) {
                    await message.reply(translatorFeature.reason);
                    return;
                }

                const access = await checkMusicAccess(message.guild, message.author.id);
                if (!access.allowed) {
                    await message.reply(access.reason);
                    return;
                }

                const session = access.session;
                if (!session?.currentTrack) {
                    await message.reply("Belum ada lagu yang sedang diputar.");
                    return;
                }
                if (session.currentTrack.radioStream) {
                    await message.reply("Terjemahan lirik tidak tersedia untuk live radio.");
                    return;
                }

                const lyrics = await lyricsSearch(session.currentTrack);
                if (!lyrics?.found) {
                    await message.reply("Lirik lagu ini tidak tersedia untuk diterjemahkan.");
                    return;
                }

                const translatedLyrics = await translateLyrics(
                    lyrics,
                    translatorFactory(),
                    { target: intent.target }
                );
                const chunks = splitForDiscord(translatedLyrics.translatedText);
                response = await message.reply({
                    content: `Terjemahan Lirik (${translatedLyrics.target}):\n${chunks.shift()}`,
                    allowedMentions: { parse: [] }
                });
                for (const chunk of chunks) {
                    await message.channel.send({
                        content: chunk,
                        allowedMentions: { parse: [] }
                    });
                }
                return;
            }

            if (intent.type === "translate") {
                const feature = await checkFeature(message.guild.id, "translator");
                if (!feature.allowed) {
                    await message.reply(feature.reason);
                    return;
                }

                const result = await translatorFactory().translate({
                    text: intent.text,
                    source: intent.source,
                    target: intent.target
                });
                const chunks = splitForDiscord(result.translatedText);
                response = await message.reply({
                    content: `${translationLabel(result)}\n${chunks.shift()}`,
                    allowedMentions: { parse: [] }
                });

                for (const chunk of chunks) {
                    await message.channel.send({
                        content: chunk,
                        allowedMentions: { parse: [] }
                    });
                }
                return;
            }

            if (intent.type === "search") {
                if (!intent.query) {
                    await message.reply("Masukkan judul lagu yang ingin dicari.");
                    return;
                }

                response = await message.reply({
                    content: "Sedang mencari lagu..."
                });

                const results = await music.searchTracks(intent.query);

                await response.edit(buildSearchResultsPanel(results));

                searchResults.set(response.id, results);

                if (searchResults.size > 100) {
                    const oldestId = searchResults.keys().next().value;
                    searchResults.delete(oldestId);
                }

                return;
            }

            if (intent.type === "radio_search") {
                if (!intent.query) {
                    await message.reply("Masukkan nama stasiun atau genre radio.");
                    return;
                }

                response = await message.reply("Sedang mencari stasiun radio...");
                const stations = await radioDiscovery.search(intent.query);
                await response.edit(buildRadioResultsPanel(stations));
                radioSearchResults.set(response.id, stations);
                if (radioSearchResults.size > 100) {
                    radioSearchResults.delete(radioSearchResults.keys().next().value);
                }
                return;
            }

            if (intent.type === "play") {
                if (!intent.query) {
                    await message.reply("Masukkan judul lagu yang ingin diputar.");
                    return;
                }

                response = await message.reply("Sedang menambahkan lagu...");

                const result = await music.addToQueue(
                    message.guild,
                    message.member,
                    intent.query
                );

                await response.edit(
                    result.started
                        ? `Sekarang memutar: **${result.track.title}**`
                        : `Ditambahkan ke antrean: **${result.track.title}** (posisi ${result.position}).`
                );

                return;
            }

            const access = await checkMusicAccess(
                message.guild,
                message.author.id
            );

            if (!access.allowed) {
                throw new Error(access.reason);
            }

            const session = access.session;

            if (intent.type === "queue_show") {
            await message.reply(buildQueuePanel(message.guild));
            return;
        }
        switch (intent.type) {
                case "queue_remove": {
                const index = intent.index - 1;
                const removed = music.removeFromQueue(message.guild, index);
                response = `Dihapus dari antrean: **${removed.title}**`;
                break;
            }

            case "queue_shuffle": {
                const count = music.shuffleQueue(message.guild);
                response = count > 1
                    ? `Antrean berhasil diacak. Total ${count} lagu.`
                    : "Antrean belum memiliki cukup lagu untuk diacak.";
                break;
            }

            case "queue_clear": {
                const count = music.clearQueue(message.guild);
                response = count
                    ? `${count} lagu di antrean berhasil dihapus. Lagu yang sedang diputar tetap berjalan.`
                    : "Antrean sudah kosong.";
                break;
            }

            case "autoplay": {
                const enabled = music.setAutoplay(message.guild, intent.enabled);
                response = `Autoplay ${enabled ? "diaktifkan" : "dinonaktifkan"} untuk sesi ini.`;
                break;
            }

            case "queue_move": {
                const moved = music.moveInQueue(
                    message.guild,
                    intent.from - 1,
                    intent.to - 1
                );
                response = `**${moved.title}** dipindahkan ke posisi ${intent.to}.`;
                break;
            }

            case "queue_requester": {
                const track = session.currentTrack;

                if (!track) {
                    response = "Tidak ada lagu yang sedang diputar.";
                } else if (track.requestedBy) {
                    response = `Lagu **${track.title}** diminta oleh <@${track.requestedBy}>.`;
                } else {
                    response = "Informasi requester lagu ini tidak tersedia.";
                }
                break;
            }
            case "pause":
                    music.pause(message.guild);
                    response = "Musik dijeda.";
                    break;

                case "resume":
                    music.resume(message.guild);
                    response = "Musik dilanjutkan.";
                    break;

                case "next":
                    await music.next(message.guild);
                    response = "Memutar lagu berikutnya.";
                    break;

                case "previous":
                    await music.previous(message.guild);
                    response = "Kembali ke lagu sebelumnya.";
                    break;

                case "stop":
                    await music.stop(message.guild);
                    response = "Musik dihentikan dan sesi ditutup.";
                    break;

                case "volume": {
                    const volume = music.setVolume(message.guild, intent.value);
                    response = `Volume diatur ke ${volume}%.`;
                    break;
                }

                case "volume_change": {
                    const volume = Math.max(
                        0,
                        Math.min(500, session.volume + intent.amount)
                    );

                    const updated = music.setVolume(message.guild, volume);
                    response = `Volume sekarang ${updated}%.`;
                    break;
                }

                case "status": {
                    const track = session.currentTrack;

                    if (!track) {
                        response = "Belum ada lagu yang sedang diputar.";
                        break;
                    }

                    const position = Math.floor(music.getPosition(session));
                    const minutes = Math.floor(position / 60);
                    const seconds = String(position % 60).padStart(2, "0");
                    const state = session.player.state.status === "paused"
                        ? "Dijeda"
                        : "Diputar";

                    response =
                        `**${track.title}**\n` +
                        `Artis: ${track.artist}\n` +
                        `Status: ${state}\n` +
                        `Posisi: ${minutes}:${seconds}\n` +
                        `Volume: ${session.volume}%\n` +
                        `Antrean: ${session.queue.length} lagu`;
                    break;
                }

                default:
                    response = "Perintah belum didukung.";
            }

            await message.reply(response);
        } catch (error) {
            console.error("[Mention Music Controller Error]", error);

            const errorMessage = error.message || "Perintah gagal dijalankan.";

            if (response) {
                await response.edit(errorMessage).catch(() => {});
            } else {
                await message.reply(errorMessage).catch(() => {});
            }
        }
    };

    try {
        client.on(Events.InteractionCreate, handleInteractionCreate);
        client.on(Events.MessageCreate, handleMessageCreate);
    } catch (error) {
        client.off?.(Events.InteractionCreate, handleInteractionCreate);
        client.off?.(Events.MessageCreate, handleMessageCreate);
        throw error;
    }

    let disposed = false;
    return function disposeInteractionHandlers() {
        if (disposed) return;
        disposed = true;
        client.off?.(Events.InteractionCreate, handleInteractionCreate);
        client.off?.(Events.MessageCreate, handleMessageCreate);
    };
};
