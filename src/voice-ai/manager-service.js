const { PermissionFlagsBits, ChannelType } = require("discord.js");

const ID = /^\d{17,20}$/;
const VOICE_CHANNEL_TYPES = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);

function assertId(value, label) {
    if (!ID.test(String(value ?? ""))) throw new Error(`${label} tidak valid.`);
    return String(value);
}

function permissionsFor(member) {
    return member?.permissions;
}

function createVoiceManager({ stateStore, clock = () => Date.now() }) {
    if (!stateStore) throw new TypeError("stateStore wajib diisi.");

    function assertGuild(guild, guildId) {
        assertId(guildId, "Guild ID");
        if (!guild || String(guild.id) !== String(guildId)) throw new Error("Guild tidak cocok.");
    }

    function assertBotPermissions(guild, needMove = false) {
        const me = guild.members?.me;
        const perms = permissionsFor(me);
        if (!perms?.has?.(PermissionFlagsBits.ManageChannels)) {
            throw new Error("Bot memerlukan permission Manage Channels.");
        }
        if (needMove && !perms?.has?.(PermissionFlagsBits.MoveMembers)) {
            throw new Error("Bot memerlukan permission Move Members.");
        }
        return me;
    }

    function assertMember(guild, member) {
        const id = assertId(member?.id, "Member ID");
        if (!member.guild || String(member.guild.id) !== String(guild.id)) {
            throw new Error("Anggota harus berasal dari guild yang sama.");
        }
        return id;
    }

    async function getOwned(guild, guildId, member) {
        const memberId = assertMember(guild, member);
        const state = await stateStore.getGuildState(guildId);
        const record = Object.values(state.temporaryVoices).find(v => v.ownerId === memberId && v.status !== "deleting");
        if (!record) throw new Error("Temporary voice milik Anda tidak ditemukan.");
        const channel = await guild.channels.fetch(record.channelId).catch(() => null);
        if (!channel || String(channel.guildId ?? channel.guild?.id) !== String(guildId) || !VOICE_CHANNEL_TYPES.has(channel.type)) {
            throw new Error("Temporary voice tidak ditemukan di Discord.");
        }
        return { memberId, record, channel };
    }

    async function createTemporaryVoice(guild, guildId, member, options = {}) {
        assertGuild(guild, guildId);
        const ownerId = assertMember(guild, member);
        const botMember = assertBotPermissions(guild, true);
        const current = member.voice?.channel;
        if (!current || String(current.guildId ?? current.guild?.id) !== String(guildId) || !VOICE_CHANNEL_TYPES.has(current.type)) {
            throw new Error("Masuk ke voice channel di guild ini terlebih dahulu.");
        }

        const guildState = await stateStore.getGuildState(guildId);
        const config = guildState.settings;
        const ownedCount = Object.values(guildState.temporaryVoices)
            .filter(voice => voice.ownerId === ownerId && ["creating", "active", "deletion_pending"].includes(voice.status))
            .length;
        if (ownedCount >= config.maxChannelsPerMember) {
            throw new Error("Batas temporary voice per anggota sudah tercapai.");
        }
        const privacy = options.privacy ?? config.defaultPrivacy;
        const userLimit = options.userLimit ?? config.defaultUserLimit;
        if (!new Set(["public", "private"]).has(privacy)) throw new Error("Privacy tidak valid.");
        if (!Number.isInteger(userLimit) || userLimit < 0 || userLimit > 99) throw new Error("User limit harus antara 0 sampai 99.");

        let parent = null;
        if (config.temporaryCategoryId) {
            parent = await guild.channels.fetch(config.temporaryCategoryId).catch(() => null);
            if (!parent || parent.type !== ChannelType.GuildCategory || String(parent.guildId ?? parent.guild?.id) !== String(guildId)) {
                throw new Error("Kategori temporary voice tidak valid.");
            }
        } else if (config.categoryMode === "existing" || config.categoryMode === "dedicated") {
            parent = current.parent;
        }

        const overwrites = [];
        if (privacy === "private") {
            overwrites.push({ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect] });
            overwrites.push({ id: ownerId, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel] });
            overwrites.push({ id: botMember.id, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] });
        }

        const channel = await guild.channels.create({
            name: options.name || `${member.displayName || member.user?.username || "User"}'s room`,
            type: ChannelType.GuildVoice,
            parent: parent?.id ?? undefined,
            userLimit,
            permissionOverwrites: overwrites
        });
        let recordCreated = false;
        try {
            assertId(channel?.id, "Temporary voice channel ID");
            if (String(channel.guildId ?? channel.guild?.id) !== String(guildId)) {
                throw new Error("Temporary voice channel dibuat pada guild yang salah.");
            }
            const botChannelPermissions = channel.permissionsFor?.(botMember);
            if (!botChannelPermissions?.has?.(PermissionFlagsBits.Connect)) {
                throw new Error("Bot memerlukan permission Connect pada temporary voice.");
            }
            const memberChannelPermissions = channel.permissionsFor?.(member);
            if (!memberChannelPermissions?.has?.(PermissionFlagsBits.Connect)) {
                throw new Error("Kamu tidak memiliki permission Connect pada temporary voice.");
            }

            const now = clock();
            await stateStore.createVoiceRecord(guildId, {
                channelId: channel.id,
                ownerId,
                createdBy: ownerId,
                categoryId: channel.parentId ?? null,
                privacy,
                isLocked: privacy === "private",
                userLimit,
                createdAt: now,
                members: { [ownerId]: { joinedAt: now } }
            });
            recordCreated = true;
            await member.voice.setChannel(channel);
            return channel;
        } catch (error) {
            try {
                await channel.delete("Temporary voice setup failed");
                if (recordCreated) {
                    await stateStore.removeVoiceRecord(guildId, channel.id);
                }
            } catch (cleanupError) {
                if (recordCreated) {
                    await stateStore.updateVoiceRecord(guildId, channel.id, {
                        status: "recovery_required",
                        pendingDeletionAt: null
                    }).catch(() => {});
                }
                throw new Error(
                    `Temporary voice setup failed and cleanup needs recovery: ${cleanupError.message}`,
                    { cause: error }
                );
            }
            throw error;
        }
    }

    async function rename(guild, guildId, member, name) {
        if (typeof name !== "string" || !name.trim() || name.length > 100) throw new Error("Nama channel harus 1 sampai 100 karakter.");
        assertGuild(guild, guildId); assertBotPermissions(guild);
        const { channel } = await getOwned(guild, guildId, member);
        await channel.setName(name.trim());
        return channel;
    }

    async function setLimit(guild, guildId, member, limit) {
        if (!Number.isInteger(limit) || limit < 0 || limit > 99) throw new Error("User limit harus antara 0 sampai 99.");
        assertGuild(guild, guildId); assertBotPermissions(guild);
        const { record, channel } = await getOwned(guild, guildId, member);
        await channel.setUserLimit(limit);
        try {
            return await stateStore.updateVoiceRecord(guildId, channel.id, { userLimit: limit, status: record.status === "deletion_pending" ? "active" : record.status, pendingDeletionAt: null });
        } catch (error) {
            await channel.setUserLimit(record.userLimit).catch(() => {});
            throw error;
        }
    }

    async function setLocked(guild, guildId, member, locked) {
        if (typeof locked !== "boolean") throw new Error("Status lock tidak valid.");
        assertGuild(guild, guildId); assertBotPermissions(guild);
        const { record, channel } = await getOwned(guild, guildId, member);
        const owner = await guild.members.fetch(record.ownerId);
        const everyone = guild.roles.everyone;
        await channel.permissionOverwrites.edit(everyone, { Connect: locked ? false : null });
        await channel.permissionOverwrites.edit(owner, { Connect: true, ViewChannel: true });
        return stateStore.updateVoiceRecord(guildId, channel.id, { isLocked: locked, privacy: locked ? "private" : "public" });
    }

    async function transfer(guild, guildId, member, targetId) {
        assertGuild(guild, guildId); assertBotPermissions(guild);
        targetId = assertId(targetId, "Target member ID");
        const { record, channel } = await getOwned(guild, guildId, member);
        if (targetId === record.ownerId) throw new Error("Target sudah menjadi pemilik.");
        const target = await guild.members.fetch(targetId).catch(() => null);
        if (!target || String(target.guild.id) !== String(guildId) || target.voice?.channelId !== channel.id) {
            throw new Error("Pemilik baru harus menjadi anggota voice channel tersebut.");
        }
        const privateChannel = record.privacy === "private" || record.isLocked;
        const oldOwner = privateChannel
            ? await guild.members.fetch(record.ownerId).catch(() => null)
            : null;

        if (privateChannel) {
            await channel.permissionOverwrites.edit(target, {
                Connect: true,
                ViewChannel: true
            });
            try {
                if (oldOwner) {
                    await channel.permissionOverwrites.edit(oldOwner, {
                        Connect: null,
                        ViewChannel: null
                    });
                }
                await stateStore.updateMemberState(guildId, channel.id, targetId, clock());
                return await stateStore.transferOwnership(guildId, channel.id, targetId);
            } catch (error) {
                if (oldOwner) {
                    await channel.permissionOverwrites.edit(oldOwner, {
                        Connect: true,
                        ViewChannel: true
                    }).catch(() => {});
                }
                await channel.permissionOverwrites.edit(target, {
                    Connect: null,
                    ViewChannel: null
                }).catch(() => {});
                throw error;
            }
        }

        await stateStore.updateMemberState(guildId, channel.id, targetId, clock());
        return stateStore.transferOwnership(guildId, channel.id, targetId);
    }

    async function deleteOwned(guild, guildId, member) {
        assertGuild(guild, guildId); assertBotPermissions(guild);
        const { channel } = await getOwned(guild, guildId, member);
        await channel.delete("Temporary voice deleted by owner");
        await stateStore.removeVoiceRecord(guildId, channel.id);
        return true;
    }

    async function onMemberLeave(guild, guildId, channelId, memberId) {
        assertGuild(guild, guildId); assertId(channelId, "Channel ID"); assertId(memberId, "Member ID");
        const record = await stateStore.getVoiceState(guildId, channelId);
        if (!record) return null;
        const updated = await stateStore.updateMemberState(guildId, channelId, memberId, null);
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) return stateStore.removeVoiceRecord(guildId, channelId);
        const occupants = [...channel.members.values()].filter(member => !member.user?.bot);
        if (occupants.length === 0) {
            return stateStore.scheduleDeletion(guildId, channelId, clock() + (await stateStore.getGuildState(guildId)).settings.cleanupDelaySeconds * 1000);
        }

        if (record.ownerId === memberId) {
            const settings = (await stateStore.getGuildState(guildId)).settings;
            if (settings.autoOwnershipTransfer) {
                const nextOwner = occupants.sort((left, right) =>
                    (record.members?.[left.id]?.joinedAt ?? Number.MAX_SAFE_INTEGER) -
                    (record.members?.[right.id]?.joinedAt ?? Number.MAX_SAFE_INTEGER)
                )[0];
                if (nextOwner) {
                    await stateStore.updateMemberState(guildId, channelId, nextOwner.id, clock());
                    return stateStore.transferOwnership(guildId, channelId, nextOwner.id);
                }
            }
        }
        return updated;
    }

    async function onMemberJoin(guild, guildId, channelId, memberId) {
        assertGuild(guild, guildId); assertId(channelId, "Channel ID"); assertId(memberId, "Member ID");
        const record = await stateStore.getVoiceState(guildId, channelId);
        if (!record) return null;
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) return stateStore.removeVoiceRecord(guildId, channelId);
        const saved = await stateStore.updateMemberState(guildId, channelId, memberId, clock());
        if (saved.status === "deletion_pending") return stateStore.cancelDeletion(guildId, channelId);
        return saved;
    }

    async function cleanupDue(guild, guildId, channelId) {
        assertGuild(guild, guildId); assertId(channelId, "Channel ID"); assertBotPermissions(guild);
        const record = await stateStore.getVoiceState(guildId, channelId);
        if (!record || record.status !== "deletion_pending" || record.pendingDeletionAt > clock()) return false;
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) return stateStore.removeVoiceRecord(guildId, channelId);
        if (String(channel.guildId ?? channel.guild?.id) !== String(guildId)) throw new Error("Channel bukan milik guild ini.");
        if (channel.members.size > 0) {
            await stateStore.cancelDeletion(guildId, channelId);
            return false;
        }
        await stateStore.updateVoiceRecord(guildId, channelId, { status: "deleting" });
        try {
            await channel.delete("Empty temporary voice cleanup");
            await stateStore.removeVoiceRecord(guildId, channelId);
            return true;
        } catch (error) {
            await stateStore.updateVoiceRecord(guildId, channelId, { status: "recovery_required" });
            throw error;
        }
    }

    return { createTemporaryVoice, rename, setLimit, setLocked, transfer, deleteOwned, onMemberLeave, onMemberJoin, cleanupDue };
}

module.exports = { createVoiceManager };
