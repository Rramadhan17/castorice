function registerVoiceManagerEvents(client, { service, stateStore, logger = console, timers = globalThis } = {}) {
    if (!client?.on || !service || !stateStore) throw new TypeError("client, service, dan stateStore wajib diisi.");
    const scheduled = new Map();
    let disposed = false;

    const report = (message, error) => {
        try { logger.error?.(`[VoiceManager] ${message}`, error); } catch {}
    };

    function clear(channelKey) {
        const timer = scheduled.get(channelKey);
        if (timer !== undefined) timers.clearTimeout(timer);
        scheduled.delete(channelKey);
    }

    function schedule(guild, guildId, channelId, dueAt) {
        const key = `${guildId}:${channelId}`;
        clear(key);
        const delay = Math.max(0, dueAt - Date.now());
        const timer = timers.setTimeout(async () => {
            scheduled.delete(key);
            if (disposed) return;
            try {
                const removed = await service.cleanupDue(guild, guildId, channelId);
                if (!removed) {
                    const latest = await stateStore.getVoiceState(guildId, channelId);
                    if (latest?.status === "deletion_pending" && latest.pendingDeletionAt != null) {
                        schedule(guild, guildId, channelId, latest.pendingDeletionAt);
                    }
                }
            } catch (error) {
                report(`cleanup gagal untuk ${guildId}/${channelId}`, error);
            }
        }, delay);
        timer?.unref?.();
        scheduled.set(key, timer);
    }

    async function safely(label, operation) {
        try { await operation(); } catch (error) { report(label, error); }
    }

    async function onVoiceStateUpdate(oldState, newState) {
        const guild = newState.guild || oldState.guild;
        const guildId = String(guild?.id || "");
        const member = newState.member || oldState.member;
        const memberId = String(member?.id || "");
        if (!/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(memberId) || member?.user?.bot) return;
        const oldChannelId = oldState.channelId ? String(oldState.channelId) : null;
        const newChannelId = newState.channelId ? String(newState.channelId) : null;
        if (oldChannelId === newChannelId) return;

        if (oldChannelId) {
            const record = await stateStore.getVoiceState(guildId, oldChannelId).catch(error => {
                report(`gagal membaca ${guildId}/${oldChannelId}`, error); return null;
            });
            if (record) {
                await safely(`gagal memproses leave ${guildId}/${oldChannelId}`, async () => {
                    const updated = await service.onMemberLeave(guild, guildId, oldChannelId, memberId);
                    if (updated?.status === "deletion_pending" && updated.pendingDeletionAt != null) {
                        schedule(guild, guildId, oldChannelId, updated.pendingDeletionAt);
                    }
                });
            }
        }

        if (newChannelId) {
            const record = await stateStore.getVoiceState(guildId, newChannelId).catch(error => {
                report(`gagal membaca ${guildId}/${newChannelId}`, error); return null;
            });
            if (record) {
                await safely(`gagal memproses join ${guildId}/${newChannelId}`, async () => {
                    const updated = await service.onMemberJoin(guild, guildId, newChannelId, memberId);
                    if (updated?.status !== "deletion_pending") clear(`${guildId}:${newChannelId}`);
                    else if (updated.pendingDeletionAt != null) schedule(guild, guildId, newChannelId, updated.pendingDeletionAt);
                });
            }
        }
    }

    async function onReady() {
        const guilds = client.guilds?.cache;
        if (!guilds) return;
        for (const guild of guilds.values()) {
            await safely(`gagal memulihkan cleanup guild ${guild.id}`, async () => {
                const state = await stateStore.getGuildState(guild.id);
                for (const record of Object.values(state.temporaryVoices || {})) {
                    if (record.status === "deletion_pending" && record.pendingDeletionAt != null) {
                        schedule(guild, String(guild.id), record.channelId, record.pendingDeletionAt);
                    }
                }
            });
        }
    }

    client.on("voiceStateUpdate", onVoiceStateUpdate);
    client.on("clientReady", onReady);

    return {
        dispose() {
            disposed = true;
            client.off?.("voiceStateUpdate", onVoiceStateUpdate);
            client.off?.("clientReady", onReady);
            for (const key of [...scheduled.keys()]) clear(key);
        },
        onVoiceStateUpdate,
        onReady,
        scheduledCount: () => scheduled.size
    };
}

module.exports = { registerVoiceManagerEvents };
