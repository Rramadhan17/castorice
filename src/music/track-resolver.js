const { spawn } = require("node:child_process");
const { stopProcessPair } = require("./process-lifecycle");
const { parseExternalHttpUrl } = require("./url-security");
const { createYtDlpEgressProxy, spawnSecuredYtDlp } = require("./yt-dlp-egress-proxy");

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function stopResolverProcess(child, logger) {
    stopProcessPair(child, null).catch(error => {
        logger?.error?.("[Music Resolver Cleanup Error]", error.message);
    });
}

async function getTrackMetadata(source, {
    binary,
    spawnImpl = spawn,
    proxyFactory = createYtDlpEgressProxy,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutputBytes = MAX_OUTPUT_BYTES,
    logger = console
} = {}) {
    if (typeof binary !== "string" || !binary) {
        throw new TypeError("yt-dlp binary path is required.");
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
        throw new RangeError("Music metadata timeout must be between 1 and 60000 ms.");
    }
    if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 10 * 1024 * 1024) {
        throw new RangeError("Music metadata output limit is invalid.");
    }

    let secured;
    try {
        secured = await spawnSecuredYtDlp(
            binary,
            [
                "--dump-single-json",
                "--skip-download",
                "--no-playlist",
                "--no-warnings",
                "--quiet",
                "--",
                source
            ],
            {
                spawnImpl,
                proxyFactory,
                spawnOptions: { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
            }
        );
    } catch (error) {
        logger?.error?.("[Music Metadata Error]", error.message);
        throw error;
    }

    return new Promise(resolve => {
        const child = secured.child;
        let output = "";
        let outputBytes = 0;
        let settled = false;
        let timeout;

        const finish = value => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            Promise.resolve(secured.proxy.close()).then(
                () => resolve(value),
                error => {
                    logger?.error?.("[Music Egress Proxy Cleanup Error]", error.message);
                    resolve(null);
                }
            );
        };

        timeout = setTimeout(() => {
            stopResolverProcess(child, logger);
            finish(null);
        }, timeoutMs);

        child.stdout.on("data", data => {
            outputBytes += data.length;
            if (outputBytes > maxOutputBytes) {
                stopResolverProcess(child, logger);
                finish(null);
                return;
            }
            output += data.toString();
        });

        child.on("error", error => {
            logger?.error?.("[Music Metadata Error]", error.message);
            finish(null);
        });

        child.on("close", code => {
            if (code !== 0) {
                finish(null);
                return;
            }

            try {
                const data = JSON.parse(output);
                const webpageUrl = data.webpage_url || source;
                if (/^[a-z][a-z0-9+.-]*:\/\//i.test(webpageUrl)) {
                    parseExternalHttpUrl(webpageUrl);
                }
                finish({
                    title: data.title || data.fulltitle || "Unknown Title",
                    artist: data.artist || data.creator || data.uploader || data.channel || "Unknown Artist",
                    duration: Number.isFinite(data.duration) ? data.duration : null,
                    thumbnail: data.thumbnail || null,
                    webpageUrl
                });
            } catch {
                finish(null);
            }
        });
    });
}

module.exports = {
    getTrackMetadata,
    DEFAULT_TIMEOUT_MS,
    MAX_OUTPUT_BYTES
};
