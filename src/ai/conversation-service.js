const SYSTEM_PROMPT = [
    "Kamu adalah Castorice, asisten AI untuk komunitas Discord.",
    "Jawab dengan ramah, ringkas, dan sesuaikan bahasa dengan pengguna.",
    "Kamu tidak dapat menjalankan tindakan Discord, mengubah pengaturan, atau mengakses data server kecuali sistem secara eksplisit memberikan hasil tindakan."
].join(" ");

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_HISTORY_MESSAGES = 20;
const DEFAULT_MAX_SESSIONS = 1_000;
const DEFAULT_MIN_INTERVAL_MS = 3_000;
const MAX_INPUT_LENGTH = 4_000;

class AIConversationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "AIConversationError";
        this.code = code;
    }
}

function createAIConversationService({
    provider = null,
    clock = () => Date.now(),
    ttlMs = DEFAULT_TTL_MS,
    maxHistoryMessages = DEFAULT_MAX_HISTORY_MESSAGES,
    maxSessions = DEFAULT_MAX_SESSIONS,
    minIntervalMs = DEFAULT_MIN_INTERVAL_MS
} = {}) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1 ||
        !Number.isInteger(maxHistoryMessages) || maxHistoryMessages < 2 ||
        !Number.isInteger(maxSessions) || maxSessions < 1 ||
        !Number.isInteger(minIntervalMs) || minIntervalMs < 0) {
        throw new TypeError("AI conversation limits are invalid.");
    }

    const sessions = new Map();
    const inFlight = new Map();

    function makeKey(guildId, userId) {
        if (!guildId || !userId) {
            throw new AIConversationError("invalid_context", "Guild dan user wajib tersedia untuk percakapan AI.");
        }
        return `${guildId}:${userId}`;
    }

    function pruneExpired(now) {
        for (const [key, session] of sessions) {
            if (now - session.updatedAt >= ttlMs) sessions.delete(key);
        }
    }

    function enforceSessionLimit() {
        while (sessions.size > maxSessions) {
            let oldestKey;
            let oldestTime = Infinity;
            for (const [key, session] of sessions) {
                if (session.updatedAt < oldestTime) {
                    oldestKey = key;
                    oldestTime = session.updatedAt;
                }
            }
            if (oldestKey === undefined) break;
            sessions.delete(oldestKey);
        }
    }

    async function respond({ guildId, userId, text }) {
        if (!provider || typeof provider.generate !== "function") {
            throw new AIConversationError("not_configured", "AI provider belum dikonfigurasi.");
        }
        if (typeof text !== "string" || !text.trim()) {
            throw new AIConversationError("empty_input", "Pesan untuk AI tidak boleh kosong.");
        }
        if ([...text].length > MAX_INPUT_LENGTH) {
            throw new AIConversationError("input_too_long", `Pesan AI dibatasi ${MAX_INPUT_LENGTH} karakter.`);
        }

        const key = makeKey(guildId, userId);
        const now = clock();
        pruneExpired(now);
        if (inFlight.has(key)) {
            throw new AIConversationError("busy", "Castorice masih memproses pesanmu. Coba lagi sebentar.");
        }

        const session = sessions.get(key) || {
            messages: [],
            updatedAt: now,
            lastRequestAt: 0,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        };
        if (now - session.lastRequestAt < minIntervalMs) {
            throw new AIConversationError("rate_limited", "Tunggu sebentar sebelum mengirim pesan AI berikutnya.");
        }

        session.lastRequestAt = now;
        session.updatedAt = now;
        sessions.set(key, session);
        enforceSessionLimit();
        const request = { controller: new AbortController() };
        inFlight.set(key, request);

        try {
            const userMessage = { role: "user", content: text.trim() };
            const result = await provider.generate([
                { role: "system", content: SYSTEM_PROMPT },
                ...session.messages,
                userMessage
            ], { signal: request.controller.signal });
            if (request.controller.signal.aborted || inFlight.get(key) !== request) {
                throw new AIConversationError("cancelled", "Permintaan AI dibatalkan karena riwayat percakapan dihapus.");
            }
            const answer = typeof result === "string" ? result : result?.text;
            if (typeof answer !== "string" || !answer.trim()) {
                throw new AIConversationError("invalid_response", "AI provider tidak mengembalikan jawaban.");
            }

            session.messages.push(userMessage, { role: "assistant", content: answer.trim() });
            session.messages = session.messages.slice(-maxHistoryMessages);
            if (result?.usage) {
                for (const tokenType of ["promptTokens", "completionTokens", "totalTokens"]) {
                    if (Number.isFinite(result.usage[tokenType])) {
                        session.usage[tokenType] += result.usage[tokenType];
                    }
                }
            }
            session.updatedAt = clock();
            return {
                text: answer.trim(),
                usage: typeof result === "object" ? result.usage ?? null : null
            };
        } finally {
            if (inFlight.get(key) === request) inFlight.delete(key);
        }
    }

    function reset({ guildId, userId }) {
        const key = makeKey(guildId, userId);
        sessions.delete(key);
        const request = inFlight.get(key);
        if (request) {
            inFlight.delete(key);
            request.controller.abort();
        }
        return true;
    }

    function getSessionCount() {
        pruneExpired(clock());
        return sessions.size;
    }

    function getUsage({ guildId, userId }) {
        const key = makeKey(guildId, userId);
        pruneExpired(clock());
        const usage = sessions.get(key)?.usage;
        return usage ? { ...usage } : { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    }

    return { respond, reset, getSessionCount, getUsage };
}

module.exports = {
    AIConversationError,
    createAIConversationService,
    SYSTEM_PROMPT
};
