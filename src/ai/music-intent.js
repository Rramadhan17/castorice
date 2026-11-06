function parseMusicIntent(input) {
    const text = String(input || "")
        .trim()
        .replace(/[.!?]+$/g, "");

    if (!text) return { type: "help" };

    let match;

    match = text.match(/^(?:putar|mainkan|play)\s+playlist\s+(.+)$/i);
    if (match) return { type: "playlist_play", name: cleanQuery(match[1]) };

    if (/^(?:lihat|tampilkan|show)\s+playlist(?:s)?$/i.test(text))
        return { type: "playlist_list" };

    match = text.match(/^(?:terjemahkan|translate)\s+(?:lirik|lyrics)(?:\s+(?:lagu|ini))?\s+(?:ke|to)\s+([a-z]{2,3}(?:-[a-z0-9]{2,8})?)$/i);
    if (match) {
        return {
            type: "translate_lyrics",
            target: match[1].toLowerCase()
        };
    }

    match = text.match(/^(?:terjemahkan|translate)\s+(.+?)\s+dari\s+([a-z]{2,3}(?:-[a-z0-9]{2,8})?)\s+ke\s+([a-z]{2,3}(?:-[a-z0-9]{2,8})?)$/i);
    if (match) {
        return {
            type: "translate",
            text: cleanQuery(match[1]),
            source: match[2].toLowerCase(),
            target: match[3].toLowerCase()
        };
    }

    match = text.match(/^(?:terjemahkan|translate)\s+(.+?)\s+(?:ke|to)\s+([a-z]{2,3}(?:-[a-z0-9]{2,8})?)$/i);
    if (match) {
        return {
            type: "translate",
            text: cleanQuery(match[1]),
            source: "auto",
            target: match[2].toLowerCase()
        };
    }

    match = text.match(/^(?:cari|carikan|search)\s+(.+)$/i);
    const radioMatch = text.match(/^(?:(?:cari|carikan|search)\s+(?:radio(?:\s+station)?|stasiun\s+radio)|radio\s+(?:cari|search))\s+(.+)$/i);
    if (radioMatch) return { type: "radio_search", query: cleanQuery(radioMatch[1]) };
    if (match) return { type: "search", query: cleanQuery(match[1]) };

    match = text.match(/^(?:autoplay|putar\s+otomatis)\s+(on|off|aktif|nonaktif|nyala|mati)$/i);
    if (match) {
        return {
            type: "autoplay",
            enabled: /^(?:on|aktif|nyala)$/i.test(match[1])
        };
    }

    match = text.match(/^(?:putar|mainkan|play)\s+(.+)$/i);
    if (match) return { type: "play", query: cleanQuery(match[1]) };

    if (/^(?:lihat|tampilkan|cek|show)\s+(?:antrean|antrian|queue)$|^(?:queue|show queue)$/i.test(text))
        return { type: "queue_show" };

    match = text.match(/^(?:hapus|remove)\s+(?:lagu|song)\s+(\d+)$/i);
    if (match) return { type: "queue_remove", index: Number(match[1]) };

    if (/^(?:acak|shuffle)\s+(?:antrean|antrian|queue)$/i.test(text))
        return { type: "queue_shuffle" };

    if (/^(?:kosongkan|bersihkan|clear)\s+(?:antrean|antrian|queue)$/i.test(text))
        return { type: "queue_clear" };

    match = text.match(/^(?:pindahkan|geser|move)\s+(?:lagu|song)\s+(\d+)\s+(?:ke|to)\s+(\d+)$/i);
    if (match) {
        return {
            type: "queue_move",
            from: Number(match[1]),
            to: Number(match[2])
        };
    }

    if (/^(?:siapa yang request lagu|siapa yang meminta lagu|siapa requester|who requested this song)$/i.test(text))
        return { type: "queue_requester" };

    if (/^(?:pause|jeda|berhenti\s+sebentar|hentikan\s+sementara)$/i.test(text))
        return { type: "pause" };

    if (/^(?:resume|lanjutkan|teruskan|putar\s+lagi)$/i.test(text))
        return { type: "resume" };

    if (/^(?:next|skip|berikutnya|lagu\s+selanjutnya|putar\s+berikutnya)$/i.test(text))
        return { type: "next" };

    if (/^(?:previous|prev|sebelumnya|lagu\s+sebelumnya|kembali\s+ke\s+lagu\s+sebelumnya)$/i.test(text))
        return { type: "previous" };

    if (/^(?:stop|hentikan\s+musik|matikan\s+musik|berhenti\s+musik)$/i.test(text))
        return { type: "stop" };

    if (/^(?:status|lagu\s+apa|lagu\s+apa\s+yang\s+sedang\s+diputar|sedang\s+memutar\s+apa)$/i.test(text))
        return { type: "status" };

    match = text.match(/^(?:volume|atur\s+volume)\s+(\d{1,3})$/i);
    if (match) return { type: "volume", value: Number(match[1]) };

    if (/^(?:kecilkan|kurangi)\s+(?:volume|suara)(?:\s+sedikit)?$/i.test(text))
        return { type: "volume_change", amount: -10 };

    if (/^(?:besarkan|naikkan|tambahkan)\s+(?:volume|suara)(?:\s+sedikit)?$/i.test(text))
        return { type: "volume_change", amount: 10 };

    return { type: "unknown" };
}

function cleanQuery(value) {
    return String(value || "")
        .trim()
        .replace(/^["']|["']$/g, "")
        .trim();
}

module.exports = { parseMusicIntent };
