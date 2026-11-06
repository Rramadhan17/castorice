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
    buildFeatureSelectionPanel,
    buildVoiceGreeterModal,
    buildServerTemplatesPanel,
    buildServerTemplateCreateModal,
    buildServerTemplatePreviewModal,
    buildServerTemplatePreviewPanel,
    buildServerTemplateDeleteConfirmPanel,
    buildSecurityReportPanel,
    buildSecurityHistoryPanel,
    buildSecurityPolicyModal,
    buildSecurityPolicyPreviewPanel
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
const { validateOfflinePolicy } = require("../security/assistant");

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
const { createAIProviderFromEnv } = require("../ai/openai-compatible-provider");
const { AIConversationError, createAIConversationService } = require("../ai/conversation-service");
const { loadTtsProvider } = require("../voice-ai/greeter-tts");
const { createVoiceAIService } = require("../voice-ai/interaction-service");
const { createVoiceAITagRouter } = require("../voice-ai/interaction-router");
const { createVoiceGreeterTagRouter } = require("../voice-ai/greeter-tag-router");
const musicPanelUpdater = require("../music/panel-updater");
const { searchLyrics } = require("../lyrics/engine");
const { buildLyricsPanel } = require("../lyrics/panel");
const { translateLyrics } = require("../lyrics/translation");
const { createVoiceTagRouter } = require("../voice-ai/tag-router");
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
    const radioSearchResults = new Map();
    const securityAssistant = dependencies.securityAssistant || createSecurityAssistant();
    const aiConversationService = dependencies.aiConversationService ||
        createAIConversationService({
            provider: dependencies.aiProvider || createAIProviderFromEnv()
        });
    const voiceAIService = dependencies.voiceAIService || createVoiceAIService({
        conversationService: aiConversationService,
        ttsProvider: dependencies.ttsProvider,
        loadTtsProvider: dependencies.loadTtsProvider || loadTtsProvider,
        playback: dependencies.voicePlayback
    });
    const voiceAITagRouter = createVoiceAITagRouter({
        service: voiceAIService,
        featureGuard: dependencies.featureGuard || checkFeature
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
    const voiceGreeterTagRouter = dependencies.voiceGreeterTagRouter ||
        createVoiceGreeterTagRouter({
            featureGuard: dependencies.featureGuard || checkFeature
        });

    client.on(Events.InteractionCreate, async interaction => {
        try {
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
                        const reports = await securityAssistant.listReports(interaction.guildId);
                        await interaction.editReply(buildSecurityHistoryPanel(reports));
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
                        await buildSettingsPanel()
                    );
                    return;
                }

                if (action === "feature_selection") {
                    await interaction.update(
                        await buildFeatureSelectionPanel(interaction.guild.id)
                    );
                    return;
                }

                if (action === "feature_toggle") {
                    if (
                        !interaction.memberPermissions?.has(
                            PermissionFlagsBits.ManageGuild
                        )
                    ) {
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

                    await setFeatureEnabled(
                        guildId,
                        featureId,
                        !currentState.enabled
                    );

                    await interaction.update(
                        await buildFeatureSelectionPanel(guildId)
                    );
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
    });
    client.on(Events.MessageCreate, async message => {
        if (!message?.guild || !client?.user) return;
        const trigger = extractTrigger(message, client.user);
        if (!trigger.isTriggered) return;

        const commandText = trigger.cleanText;

        try {
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

        if (/^(?:reset|hapus|lupakan|clear|forget)(?:\s+(?:riwayat|history|percakapan|conversation|memori|memory|chat))*$/i.test(commandText.trim())) {
            aiConversationService.reset({
                guildId: message.guild.id,
                userId: message.author.id
            });
            await message.reply({
                content: "Riwayat percakapan AI kamu telah dihapus.",
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
            const feature = await checkFeature(message.guild.id, "ai_chat");
            if (!feature.allowed) {
                await message.reply(feature.reason);
                return;
            }

            try {
                const result = await aiConversationService.respond({
                    guildId: message.guild.id,
                    userId: message.author.id,
                    text: commandText
                });
                const chunks = splitForDiscord(result.text);
                await message.reply({
                    content: chunks.shift(),
                    allowedMentions: { parse: [] }
                });
                for (const chunk of chunks) {
                    await message.channel.send({
                        content: chunk,
                        allowedMentions: { parse: [] }
                    });
                }
            } catch (error) {
                const messages = {
                    not_configured: "AI belum dikonfigurasi. Admin bot perlu mengisi AI_API_KEY dan AI_MODEL yang didukung provider pada environment.",
                    rate_limited: "Tunggu sebentar sebelum mengirim pesan AI berikutnya.",
                    busy: "Castorice masih memproses pesanmu. Coba lagi sebentar.",
                    input_too_long: error.message,
                    empty_input: error.message
                };
                if (!(error instanceof AIConversationError)) {
                    console.error("[AI Chat Error]", error.code || error.name || "unknown");
                }
                await message.reply({
                    content: messages[error.code] || "AI gagal merespons. Coba lagi nanti atau periksa konfigurasi provider.",
                    allowedMentions: { parse: [] }
                });
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
    });
};
