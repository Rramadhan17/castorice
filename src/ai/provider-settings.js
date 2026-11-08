function parseAIProviderSettingsIntent(input) {
    const text = String(input || "").trim().replace(/\s+/g, " ");
    if (/^(?:(?:cek|lihat|show)\s+)?(?:status\s+(?:provider\s+)?ai|(?:provider\s+)?ai\s+status)$/i.test(text) ||
        /^(?:cek|lihat)\s+status\s+provider(?:\s+ai)?$/i.test(text)) {
        return { action: "status" };
    }
    return null;
}

function formatAIProviderStatus(status) {
    if (!status || typeof status.configured !== "boolean") {
        throw new TypeError("Gemini status is invalid.");
    }
    if (status.configurationError) {
        return "Konfigurasi Gemini tidak valid. Pemilik bot perlu memeriksa GEMINI_API_KEY dan GEMINI_MODEL.";
    }
    return status.configured
        ? "Gemini: dikonfigurasi; koneksi belum diverifikasi live."
        : "Gemini belum dikonfigurasi. Tetapkan GEMINI_API_KEY; GEMINI_MODEL bersifat opsional.";
}

module.exports = { parseAIProviderSettingsIntent, formatAIProviderStatus };
