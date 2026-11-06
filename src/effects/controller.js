const ZmqClient = require("./zmq-client");
const AutoPan = require("./auto-pan");

const {
    DEFAULT_EFFECTS,
    BASS_PRESETS,
    SPATIAL_PRESETS,
    STEREO_PRESETS,
    RADIO_PRESETS
} = require("./presets");

function cloneDefaults() {
    return {
        bass: DEFAULT_EFFECTS.bass,
        spatial: { ...DEFAULT_EFFECTS.spatial },
        stereo: DEFAULT_EFFECTS.stereo,
        radio: DEFAULT_EFFECTS.radio
    };
}

class EffectsController {
    constructor({ endpointLease, effects = {}, client = null, onError = () => {} }) {
        if (!endpointLease?.endpoint || typeof endpointLease.release !== "function") {
            throw new Error("Endpoint lease tidak valid.");
        }

        this.endpointLease = endpointLease;
        this.client = client || new ZmqClient(endpointLease.endpoint);
        this.onError = onError;

        this.state = {
            ...cloneDefaults(),
            ...effects,
            spatial: {
                ...DEFAULT_EFFECTS.spatial,
                ...(effects.spatial || {})
            }
        };

        this.started = false;
        this.closed = false;
        this.startPromise = null;
        this.closePromise = null;

        this.autoPan = new AutoPan(this.client, {
            speed: this.state.spatial.speed,
            onError: error => {
                this.state.spatial.enabled = false;
                this._reportError(error);
            }
        });
    }

    _reportError(error) {
        try {
            this.onError(error);
        } catch {}
    }

    _assertStarted() {
        if (this.closed) {
            throw new Error("Effects Controller sudah ditutup.");
        }

        if (!this.started) {
            throw new Error("Effects Controller belum dimulai.");
        }
    }

    async _send(command) {
        this._assertStarted();
        return this.client.sendCommand(command);
    }

    start() {
        if (this.closed) {
            return Promise.reject(new Error("Effects Controller sudah ditutup."));
        }

        if (this.startPromise) return this.startPromise;
        if (this.started) return Promise.resolve();

        this.started = true;

        this.startPromise = (async () => {
          try {
            const bassConfig = BASS_PRESETS[this.state.bass] || BASS_PRESETS.off;
            let lastError = null;

            for (let attempt = 1; attempt <= 8; attempt++) {
                if (this.closed) {
                    throw new Error("Effects Controller ditutup saat startup.");
                }

                try {
                    await this._send(
                        `bass@bassboost gain ${bassConfig.gain}`
                    );

                    lastError = null;
                    break;
                } catch (error) {
                    lastError = error;

                    if (attempt < 8) {
                        await new Promise(resolve => setTimeout(resolve, 250));
                    }
                }
            }

            if (lastError) {
                throw new Error(
                    `FFmpeg ZeroMQ belum siap: ${lastError.message}`
                );
            }

            if (this.closed) {
                throw new Error("Effects Controller ditutup saat startup.");
            }

            if (this.state.spatial.enabled) {
                this.autoPan.start();
            }
          } catch (error) {
            this.started = false;
            throw error;
          } finally {
            this.startPromise = null;
          }
        })();

        return this.startPromise;
    }

    async setBass(preset) {
        const config = BASS_PRESETS[preset];

        if (!config) {
            throw new Error(`Preset Bass tidak valid: ${preset}`);
        }

        await this._send(`bass@bassboost gain ${config.gain}`);
        this.state.bass = preset;

        return this.getState();
    }

    async setStereo(preset) {
        const config = STEREO_PRESETS[preset];

        if (!config) {
            throw new Error(`Preset Stereo tidak valid: ${preset}`);
        }

        await this._send(`extrastereo@stereo_wide m ${config.coefficient}`);
        this.state.stereo = preset;

        return this.getState();
    }

    async _applyRadio(config) {
        const commands = [
            `highpass@radio_hp f ${config.highpass}`,
            `lowpass@radio_lp f ${config.lowpass}`,
            `acrusher@radio_crush bits ${config.crusherBits}`,
            `acrusher@radio_crush mix ${config.crusherMix}`,
            `asoftclip@radio_clip threshold ${config.softClipThreshold}`,
            `alimiter@radio_limit limit ${config.limiter}`
        ];

        for (const command of commands) {
            await this._send(command);
        }
    }

    async setRadio(preset) {
        const config = RADIO_PRESETS[preset];

        if (!config) {
            throw new Error(`Preset Radio tidak valid: ${preset}`);
        }

        const previous = RADIO_PRESETS[this.state.radio];

        try {
            await this._applyRadio(config);
            this.state.radio = preset;
        } catch (error) {
            try {
                await this._applyRadio(previous);
            } catch (rollbackError) {
                this._reportError(rollbackError);
            }

            throw error;
        }

        return this.getState();
    }

    async setSpatialEnabled(enabled) {
        if (typeof enabled !== "boolean") {
            throw new Error("Status 8D harus berupa boolean.");
        }

        this._assertStarted();

        if (enabled === this.state.spatial.enabled) {
            return this.getState();
        }

        if (enabled) {
            this.autoPan.start();
        } else {
            await this.autoPan.stop();
        }

        this.state.spatial.enabled = enabled;

        return this.getState();
    }

    async setSpatialSpeed(speed) {
        if (!SPATIAL_PRESETS[speed]) {
            throw new Error(`Kecepatan 8D tidak valid: ${speed}`);
        }

        this._assertStarted();

        this.autoPan.setSpeed(speed);
        this.state.spatial.speed = speed;

        return this.getState();
    }

    pause() {
        this._assertStarted();
        this.autoPan.pause();
    }

    resume() {
        this._assertStarted();

        if (this.state.spatial.enabled) {
            this.autoPan.resume();
        }
    }

    getState() {
        return {
            bass: this.state.bass,
            spatial: { ...this.state.spatial },
            stereo: this.state.stereo,
            radio: this.state.radio
        };
    }

    close() {
        if (this.closePromise) return this.closePromise;

        this.closed = true;
        this.started = false;

        this.closePromise = (async () => {
            const clientClose = Promise.resolve()
                .then(() => this.client.close())
                .catch(error => this._reportError(error));

            try {
                await this.startPromise?.catch(() => {});
                await this.autoPan.stop({ reset: false });
                await clientClose;
            } catch (error) {
                this._reportError(error);
                await clientClose;
            }

            this.endpointLease.release();
        })();

        return this.closePromise;
    }
}

module.exports = EffectsController;
