const DEFAULT_EFFECTS = Object.freeze({
    bass: "off",
    spatial: Object.freeze({
        enabled: false,
        speed: "normal"
    }),
    stereo: "normal",
    radio: "off"
});

const BASS_PRESETS = Object.freeze({
    off: Object.freeze({ gain: 0 }),
    low: Object.freeze({ gain: 4 }),
    medium: Object.freeze({ gain: 8 }),
    high: Object.freeze({ gain: 12 })
});

const SPATIAL_PRESETS = Object.freeze({
    slow: Object.freeze({ frequency: 0.08 }),
    normal: Object.freeze({ frequency: 0.15 }),
    fast: Object.freeze({ frequency: 0.25 })
});

const STEREO_PRESETS = Object.freeze({
    normal: Object.freeze({ coefficient: 1.0 }),
    wide: Object.freeze({ coefficient: 2.0 }),
    extraWide: Object.freeze({ coefficient: 3.5 })
});

const RADIO_PRESETS = Object.freeze({
    off: Object.freeze({
        highpass: 20,
        lowpass: 20000,
        crusherBits: 16,
        crusherMix: 0,
        softClipThreshold: 1,
        limiter: 0.95
    }),
    classic: Object.freeze({
        highpass: 250,
        lowpass: 4500,
        crusherBits: 16,
        crusherMix: 0,
        softClipThreshold: 1,
        limiter: 0.95
    }),
    old: Object.freeze({
        highpass: 500,
        lowpass: 3000,
        crusherBits: 8,
        crusherMix: 0.2,
        softClipThreshold: 0.85,
        limiter: 0.9
    })
});

module.exports = {
    DEFAULT_EFFECTS,
    BASS_PRESETS,
    SPATIAL_PRESETS,
    STEREO_PRESETS,
    RADIO_PRESETS
};
