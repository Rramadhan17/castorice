const music = require("../music/manager");

async function checkMusicAccess(guild, userId) {
    if (!guild?.id || !userId) {
        return {
            allowed: false,
            reason: "Kontrol musik hanya dapat digunakan di server Discord."
        };
    }

    let member;
    let botMember;

    try {
        [member, botMember] = await Promise.all([
            guild.members.fetch(userId),
            guild.members.fetchMe()
        ]);
    } catch {
        return {
            allowed: false,
            reason: "Data anggota server gagal diperiksa. Coba lagi."
        };
    }

    if (!member || member.guild.id !== guild.id) {
        return {
            allowed: false,
            reason: "Anggota tidak ditemukan di server ini."
        };
    }

    const session = music.getSession(guild.id);

    if (!session) {
        return {
            allowed: false,
            reason: "Castorice belum memiliki sesi musik aktif."
        };
    }

    if (
        session.guildId !== guild.id ||
        !session.connection ||
        session.connection.state?.status !== "ready"
    ) {
        return {
            allowed: false,
            reason: "Koneksi musik Castorice tidak tersedia atau belum siap."
        };
    }

    const channelId = session.channelId;

    if (
        !channelId ||
        session.connection.joinConfig?.channelId !== channelId ||
        botMember.voice.channelId !== channelId
    ) {
        return {
            allowed: false,
            reason: "Posisi voice channel Castorice tidak valid. Coba lagi setelah bot terhubung."
        };
    }

    if (member.voice.channelId !== channelId) {
        return {
            allowed: false,
            reason: "Kamu harus berada di voice channel yang sama dengan Castorice untuk mengontrol musik."
        };
    }

    return {
        allowed: true,
        session,
        member
    };
}

module.exports = {
    checkMusicAccess
};
