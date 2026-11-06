function getActiveLyric(lyrics, position) {
    if (!Array.isArray(lyrics) || lyrics.length === 0) {
        return {
            index: -1,
            current: null,
            previous: null,
            next: null,
            progress: 0
        };
    }

    const time = Math.max(0, Number(position) || 0);

    let low = 0;
    let high = lyrics.length - 1;
    let activeIndex = -1;

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);

        if (lyrics[middle].time <= time) {
            activeIndex = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    if (activeIndex === -1) {
        return {
            index: -1,
            current: null,
            previous: null,
            next: lyrics[0],
            progress: 0
        };
    }

    const current = lyrics[activeIndex];
    const previous = lyrics[activeIndex - 1] || null;
    const next = lyrics[activeIndex + 1] || null;

    const duration = next
        ? Math.max(0, next.time - current.time)
        : 0;

    const progress = duration > 0
        ? Math.min(1, Math.max(0, (time - current.time) / duration))
        : 1;

    return {
        index: activeIndex,
        current,
        previous,
        next,
        progress
    };
}

module.exports = {
    getActiveLyric
};
