function isClosed(child) {
    return !child || child.exitCode != null || child.signalCode != null;
}

function killProcess(child, signal) {
    if (isClosed(child)) {
        return;
    }

    try {
        if (signal || !child.killed) child.kill(signal);
    } catch (error) {
        console.error("[Music Process Cleanup Error]", error.message);
    }
}

function waitForProcessClose(child, timeoutMs = Infinity) {
    if (isClosed(child)) {
        return Promise.resolve(true);
    }

    return new Promise(resolve => {
        let timer = null;
        const finish = closed => {
            if (timer) clearTimeout(timer);
            child.removeListener("close", onClose);
            resolve(closed);
        };
        const onClose = () => {
            finish(true);
        };

        child.once("close", onClose);

        if (Number.isFinite(timeoutMs)) {
            timer = setTimeout(() => finish(false), timeoutMs);
        }

        if (isClosed(child)) {
            finish(true);
        }
    });
}

async function stopProcessPair(ytProcess, ffmpegProcess, {
    graceMs = 2000,
    forceWaitMs = 1000
} = {}) {
    if (!Number.isFinite(graceMs) || graceMs < 0 || !Number.isFinite(forceWaitMs) || forceWaitMs < 0) {
        throw new RangeError("Timeout cleanup process tidak valid.");
    }

    if (ytProcess?.stdout && ffmpegProcess?.stdin) {
        try {
            ytProcess.stdout.unpipe(ffmpegProcess.stdin);
        } catch (error) {
            console.error("[Music Unpipe Error]", error.message);
        }
    }

    if (ffmpegProcess?.stdin && !ffmpegProcess.stdin.destroyed) {
        try {
            ffmpegProcess.stdin.destroy();
        } catch (error) {
            console.error("[Music Stdin Cleanup Error]", error.message);
        }
    }

    const children = [ytProcess, ffmpegProcess].filter(Boolean);
    const closePromises = children.map(child => waitForProcessClose(child, graceMs));
    children.forEach(child => killProcess(child));
    const closeResults = await Promise.all(closePromises);

    const forceChildren = children.filter((child, index) => !closeResults[index]);
    if (forceChildren.length) {
        forceChildren.forEach(child => killProcess(child, "SIGKILL"));
        const forcedResults = await Promise.all(
            forceChildren.map(child => waitForProcessClose(child, forceWaitMs))
        );
        if (forcedResults.some(closed => !closed)) {
            throw new Error("Proses musik tidak berhenti setelah SIGKILL.");
        }
    }
}

module.exports = { stopProcessPair, waitForProcessClose };
