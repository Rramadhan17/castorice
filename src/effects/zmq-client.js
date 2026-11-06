const zmq = require("zeromq");

class ZmqClient {
    constructor(endpoint, timeoutMs = 1500) {
        if (
            typeof endpoint !== "string" ||
            !/^tcp:\/\/(127\.0\.0\.1|localhost):\d+$/.test(endpoint)
        ) {
            throw new Error("ZeroMQ endpoint harus menggunakan loopback lokal.");
        }

        if (!Number.isInteger(timeoutMs) || timeoutMs < 100) {
            throw new Error("Timeout harus berupa integer minimal 100 ms.");
        }

        this.endpoint = endpoint;
        this.timeoutMs = timeoutMs;
        this.socket = null;
        this.closed = false;
        this.closePromise = null;
        this.queue = Promise.resolve();

        this._createSocket();
    }

    _createSocket() {
        if (this.closed) {
            throw new Error("ZeroMQ client sudah ditutup.");
        }

        const socket = new zmq.Request();

        socket.receiveTimeout = this.timeoutMs;
        socket.sendTimeout = this.timeoutMs;
        socket.linger = 0;

        socket.connect(this.endpoint);
        this.socket = socket;
    }

    async _resetSocket() {
        const socket = this.socket;
        this.socket = null;

        if (socket) {
            try {
                socket.close();
            } catch {}
        }

        if (!this.closed) {
            this._createSocket();
        }
    }

    async _sendCommand(command) {
        if (this.closed) {
            throw new Error("ZeroMQ client sudah ditutup.");
        }

        if (
            typeof command !== "string" ||
            !command.trim() ||
            /[\r\n]/.test(command)
        ) {
            throw new Error("Perintah ZeroMQ tidak valid.");
        }

        const socket = this.socket;

        if (!socket) {
            throw new Error("ZeroMQ socket tidak tersedia.");
        }

        try {
            await socket.send(command);

            const [response] = await socket.receive();

            return response.toString("utf8").trim();
        } catch (error) {
            await this._resetSocket();
            throw new Error(`ZeroMQ request gagal: ${error.message}`);
        }
    }

    sendCommand(command) {
        if (this.closed) {
            return Promise.reject(
                new Error("ZeroMQ client sudah ditutup.")
            );
        }

        const task = this.queue.then(() => this._sendCommand(command));

        this.queue = task.catch(() => {});

        return task;
    }

    close() {
        if (this.closePromise) {
            return this.closePromise;
        }

        this.closed = true;

        this.closePromise = (async () => {
            const socket = this.socket;
            this.socket = null;

            if (socket) {
                try {
                    socket.close();
                } catch {}
            }

            await this.queue.catch(() => {});
        })();

        return this.closePromise;
    }
}

module.exports = ZmqClient;
