const { parseMusicIntent } = require("../ai/music-intent");
const { checkFeature } = require("../core/feature-guard");
const music = require("../music/manager");
const { createPlaylistService } = require("./service");
const { enqueuePlaylist } = require("./queue");

function escapeMentions(value) {
    return String(value).replace(/@/g, "@\u200b");
}

function createPlaylistTagRouter({
    service = createPlaylistService(),
    musicManager = music,
    featureGuard = checkFeature
} = {}) {
    return async function routePlaylistTag({ message, commandText }) {
        const intent = parseMusicIntent(commandText);
        if (!new Set(["playlist_list", "playlist_play"]).has(intent.type)) return false;

        const feature = await featureGuard(message.guild?.id, "playlists");
        if (!feature.allowed) {
            await message.reply(feature.reason);
            return true;
        }

        if (intent.type === "playlist_list") {
            const data = await service.list(message.guild.id);
            const items = Object.values(data.items || {}).sort((a, b) => a.name.localeCompare(b.name));
            const content = items.length
                ? `Playlist server: ${items.map(item => `**${escapeMentions(item.name)}** (${item.tracks.length})`).join(", ")}`
                : "Belum ada playlist di server ini. Buat melalui Dashboard → Playlists.";
            await message.reply({ content, allowedMentions: { parse: [] } });
            return true;
        }

        const musicFeature = await featureGuard(message.guild.id, "music");
        if (!musicFeature.allowed) {
            await message.reply(musicFeature.reason);
            return true;
        }

        const playlist = await service.findByName(message.guild.id, intent.name);
        if (!playlist) {
            await message.reply(`Playlist **${escapeMentions(intent.name)}** tidak ditemukan.`);
            return true;
        }

        const member = message.member || await message.guild.members.fetch(message.author.id);
        const result = await enqueuePlaylist({
            guild: message.guild,
            member,
            playlist,
            addToQueue: musicManager.addToQueue
        });
        const summary = result.partial
            ? `${result.added}/${result.total} track playlist **${escapeMentions(playlist.name)}** masuk antrean. Antrean menolak track berikutnya: ${result.error.message}`
            : `${result.added} track playlist **${escapeMentions(playlist.name)}** masuk antrean.`;
        await message.reply({ content: summary, allowedMentions: { parse: [] } });
        return true;
    };
}

module.exports = { createPlaylistTagRouter };
