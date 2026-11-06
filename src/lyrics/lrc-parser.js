function parseLrc(input) {
    if (typeof input !== "string" || !input.trim()) {
        return [];
    }

    const lines = input.split(/\r?\n/);
    const offsetMatch = input.match(/^\[offset:([+-]?\d+)\]/im);
    const offset = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
    const timestampPattern = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    const result = [];

    for (const line of lines) {
        const timestamps = [...line.matchAll(timestampPattern)];

        if (!timestamps.length) continue;

        const text = line.replace(timestampPattern, "").trim();

        if (!text) continue;

        for (const match of timestamps) {
            const minutes = Number(match[1]);
            const seconds = Number(match[2]);
            const fraction = match[3] || "";

            if (seconds > 59) continue;

            const milliseconds = Number(
                fraction.padEnd(3, "0").slice(0, 3) || 0
            );

            const time = Math.max(
                0,
                minutes * 60 + seconds + milliseconds / 1000 + offset
            );

            result.push({ time, text });
        }
    }

    return result
        .map((line, index) => ({ ...line, index }))
        .sort((a, b) => a.time - b.time || a.index - b.index)
        .map(({ time, text }) => ({ time, text }));
}

module.exports = { parseLrc };
