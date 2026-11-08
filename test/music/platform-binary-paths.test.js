const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { resolveYtDlpPath } = require("../../src/music/manager");

test("yt-dlp resolution selects a platform-native binary and never falls back to Windows on Linux", () => {
    const cwd = path.resolve("render-test-root");
    const existing = new Set([
        path.join(cwd, "bin", "yt-dlp.exe")
    ]);

    assert.equal(resolveYtDlpPath({
        platform: "linux",
        cwd,
        existsSync: candidate => existing.has(candidate)
    }), path.join(cwd, "bin", "yt-dlp"));
    assert.equal(resolveYtDlpPath({
        platform: "win32",
        cwd,
        existsSync: candidate => existing.has(candidate)
    }), path.join(cwd, "bin", "yt-dlp.exe"));
});

test("yt-dlp resolution prefers the native binary when both platform files exist", () => {
    const cwd = path.resolve("render-test-root");
    const existing = new Set([
        path.join(cwd, "bin", "yt-dlp.exe"),
        path.join(cwd, "bin", "yt-dlp")
    ]);

    assert.equal(resolveYtDlpPath({
        platform: "linux",
        cwd,
        existsSync: candidate => existing.has(candidate)
    }), path.join(cwd, "bin", "yt-dlp"));
});
