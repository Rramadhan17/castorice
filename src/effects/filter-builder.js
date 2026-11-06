const {
    BASS_PRESETS,
    STEREO_PRESETS,
    RADIO_PRESETS
} = require("./presets");

function validateEndpoint(endpoint) {
    if (typeof endpoint !== "string") {
        throw new Error("ZeroMQ endpoint harus berupa string.");
    }

    const match = endpoint.match(/^tcp:\/\/127\.0\.0\.1:(\d{1,5})$/);

    if (!match) {
        throw new Error("ZeroMQ hanya boleh menggunakan alamat loopback lokal.");
    }

    const port = Number(match[1]);

    if (port < 1 || port > 65535) {
        throw new Error("Port ZeroMQ tidak valid.");
    }

    return endpoint.replace(/:/g, "\\\\:");
}

function buildFilterGraph(effects = {}, offsetSeconds = 0, endpoint = "tcp://127.0.0.1:5559") {
    const bass = BASS_PRESETS[effects.bass] || BASS_PRESETS.off;
    const stereo = STEREO_PRESETS[effects.stereo] || STEREO_PRESETS.normal;
    const radio = RADIO_PRESETS[effects.radio] || RADIO_PRESETS.off;

    const filters = [];

    if (Number.isFinite(offsetSeconds) && offsetSeconds > 0) {
        filters.push(`atrim=start=${offsetSeconds}`);
        filters.push("asetpts=PTS-STARTPTS");
    }

    filters.push(`highpass@radio_hp=f=${radio.highpass}`);
    filters.push(`lowpass@radio_lp=f=${radio.lowpass}`);
    filters.push(`acrusher@radio_crush=bits=${radio.crusherBits}:mix=${radio.crusherMix}`);
    filters.push(`asoftclip@radio_clip=threshold=${radio.softClipThreshold}`);
    filters.push(`bass@bassboost=g=${bass.gain}`);
    filters.push(`extrastereo@stereo_wide=m=${stereo.coefficient}`);
    filters.push("stereotools@spatial=balance_out=0");
    filters.push(`alimiter@radio_limit=limit=${radio.limiter}:level=false`);

    filters.unshift(`azmq=bind_address=${validateEndpoint(endpoint)}`);

    return filters.join(",");
}

module.exports = {
    buildFilterGraph
};
