const net = require("node:net");

class EndpointManager {
    constructor({ createServer = net.createServer, maxAttempts = 10 } = {}) {
        if (typeof createServer !== "function") {
            throw new TypeError("createServer harus berupa function.");
        }
        if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
            throw new RangeError("maxAttempts harus integer antara 1 sampai 100.");
        }

        this.createServer = createServer;
        this.maxAttempts = maxAttempts;
        this.activePorts = new Set();
    }

    async allocate() {
        let lastError = null;

        for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
            let server;

            try {
                server = this.createServer();
                await new Promise((resolve, reject) => {
                    server.once("error", reject);
                    server.listen(0, "127.0.0.1", resolve);
                });

                const address = server.address();

                if (!address || typeof address === "string") {
                    throw new Error("Alamat port sementara tidak valid.");
                }

                const port = address.port;

                await new Promise((resolve, reject) => {
                    server.close(error => {
                        if (error) {
                            reject(error);
                            return;
                        }

                        resolve();
                    });
                });

                if (this.activePorts.has(port)) {
                    continue;
                }

                this.activePorts.add(port);

                let released = false;

                return {
                    port,
                    endpoint: `tcp://127.0.0.1:${port}`,
                    release: () => {
                        if (released) return;

                        released = true;
                        this.activePorts.delete(port);
                    }
                };
            } catch (error) {
                let closeError = null;
                if (server?.listening) {
                    await new Promise((resolve, reject) => {
                        server.close(closeError => closeError ? reject(closeError) : resolve());
                    }).catch(closeFailure => {
                        closeError = closeFailure;
                    });
                }
                lastError = closeError || error;
            }
        }

        throw new Error(
            `Gagal mendapatkan port ZeroMQ setelah ${this.maxAttempts} percobaan${lastError ? `: ${lastError.message}` : "."}`
        );
    }

    get activeCount() {
        return this.activePorts.size;
    }
}

module.exports = EndpointManager;
