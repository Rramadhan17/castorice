const { performance } = require("node:perf_hooks");
const { SPATIAL_PRESETS } = require("./presets");

class AutoPan {
    constructor(client, options = {}) {
        if (!client || typeof client.sendCommand !== "function") {
            throw new Error("AutoPan membutuhkan ZeroMQ client yang valid.");
        }

        this.client = client;
        this.speed = options.speed || "normal";
        this.intervalMs = options.intervalMs || 50;
        this.maxBalance = options.maxBalance ?? 0.85;
        this.rampDurationMs = options.rampDurationMs || 1200;
        this.onError = options.onError || (() => {});

        this.frequency = this._getFrequency(this.speed);
        this.phase = 0;
        this.startedAt = 0;
        this.rampStartedAt = 0;
        this.rampElapsedMs = 0;

        this.timer = null;
        this.running = false;
        this.inFlight = false;
        this.pendingBalance = null;
    }

    _getFrequency(speed) {
        const preset = SPATIAL_PRESETS[speed];

        if (!preset) {
            throw new Error(`Kecepatan 8D tidak valid: ${speed}`);
        }

        return preset.frequency;
    }

    _getPhase(now) {
        const elapsed = (now - this.startedAt) / 1000;
        const phase = this.phase + (2 * Math.PI * this.frequency * elapsed);

        return phase % (2 * Math.PI);
    }

    _getAmplitude(now) {
        const elapsed = this.rampElapsedMs + (now - this.rampStartedAt);

        return Math.min(1, elapsed / this.rampDurationMs);
    }

    _calculateBalance(now) {
        const phase = this._getPhase(now);
        const amplitude = this._getAmplitude(now);

        return this.maxBalance * amplitude * Math.sin(phase);
    }

    _dispatchBalance(balance) {
        if (!this.running || this.inFlight) {
            this.pendingBalance = balance;
            return;
        }

        this.inFlight = true;

        this.client
            .sendCommand(`stereotools@spatial balance_out ${balance.toFixed(4)}`)
            .catch(error => {
                this.running = false;
                this._clearTimer();
                this.pendingBalance = null;

                try {
                    this.onError(error);
                } catch {}
            })
            .finally(() => {
                this.inFlight = false;

                if (this.running && this.pendingBalance !== null) {
                    const latestBalance = this.pendingBalance;
                    this.pendingBalance = null;
                    this._dispatchBalance(latestBalance);
                }
            });
    }

    _tick() {
        if (!this.running) return;

        const balance = this._calculateBalance(performance.now());

        if (this.inFlight) {
            this.pendingBalance = balance;
            return;
        }

        this._dispatchBalance(balance);
    }

    _clearTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    start() {
        if (this.running) return;

        this.running = true;
        this.startedAt = performance.now();
        this.rampStartedAt = this.startedAt;

        this._tick();

        this.timer = setInterval(() => {
            this._tick();
        }, this.intervalMs);

        this.timer.unref?.();
    }

    pause() {
        if (!this.running) return;

        const now = performance.now();

        this.phase = this._getPhase(now);
        this.rampElapsedMs += now - this.rampStartedAt;

        this.running = false;
        this.pendingBalance = null;
        this._clearTimer();
    }

    resume() {
        this.start();
    }

    setSpeed(speed) {
        const nextFrequency = this._getFrequency(speed);

        if (this.running) {
            const now = performance.now();
            this.phase = this._getPhase(now);
            this.startedAt = now;
        }

        this.speed = speed;
        this.frequency = nextFrequency;
    }

    async stop(options = {}) {
        const { reset = true } = options;

        this.running = false;
        this.pendingBalance = null;
        this._clearTimer();

        if (!reset) return;

        await this.client.sendCommand(
            "stereotools@spatial balance_out 0"
        );
    }
}

module.exports = AutoPan;
