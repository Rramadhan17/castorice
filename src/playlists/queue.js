async function enqueuePlaylist({ guild, member, playlist, addToQueue }) {
    if (!guild?.id || !member?.voice?.channel || member.guild?.id !== guild.id) {
        throw new Error("Masuk ke voice channel di server ini terlebih dahulu.");
    }
    if (!playlist || !Array.isArray(playlist.tracks) || playlist.tracks.length === 0) {
        throw new Error("Playlist kosong atau tidak ditemukan.");
    }

    let added = 0;
    let firstError = null;
    for (const track of playlist.tracks) {
        try {
            await addToQueue(guild, member, track.input);
            added += 1;
        } catch (error) {
            firstError = error;
            break;
        }
    }

    if (!added) throw firstError || new Error("Tidak ada track yang berhasil ditambahkan.");
    return {
        added,
        total: playlist.tracks.length,
        partial: added < playlist.tracks.length,
        error: firstError
    };
}

module.exports = { enqueuePlaylist };
