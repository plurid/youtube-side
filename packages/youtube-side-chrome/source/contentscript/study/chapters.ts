export interface Chapter {
    startMs: number;
    title: string;
}

const TIMESTAMP_LINE_REGEX = /^\s*(?:(\d+):)?([0-5]?\d):([0-5]\d)\s*[-•–—]?\s*(.+)$/i;

export const parseTimestampToMs = (
    hours: string | undefined,
    minutes: string,
    seconds: string,
): number => {
    const h = hours ? Number.parseInt(hours, 10) : 0;
    const m = Number.parseInt(minutes, 10);
    const s = Number.parseInt(seconds, 10);
    return (h * 3600 + m * 60 + s) * 1000;
};

export const parseDescriptionChapters = (text: string): Chapter[] | null => {
    if (!text || typeof text !== 'string') {
        return null;
    }

    const lines = text.split('\n');
    const chapters: Chapter[] = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        const match = TIMESTAMP_LINE_REGEX.exec(line);
        if (!match) {
            continue;
        }

        const [, h, m, s, title] = match;
        if (!m || !s || !title) {
            continue;
        }

        const startMs = parseTimestampToMs(h, m, s);
        const cleanTitle = title.trim();
        if (cleanTitle.length > 0) {
            chapters.push({ startMs, title: cleanTitle });
        }
    }

    // Must have at least 2 chapters and strictly increasing startMs
    if (chapters.length < 2) {
        return null;
    }

    for (let i = 1; i < chapters.length; i++) {
        const prev = chapters[i - 1];
        const curr = chapters[i];
        if (prev && curr && curr.startMs <= prev.startMs) {
            return null;
        }
    }

    return chapters;
};

export const extractChaptersFromDOM = (root: Document = document): Chapter[] | null => {
    // Source 1: YouTube's macro markers DOM
    const markerElements = root.querySelectorAll(
        'ytd-macro-markers-list-item-renderer, ytd-chapter-renderer',
    );
    if (markerElements.length >= 2) {
        const chapters: Chapter[] = [];
        for (const el of markerElements) {
            const timeEl = el.querySelector('#time, .ytp-time-current, [id*="time"]');
            const titleEl = el.querySelector('#details h4, #title, [id*="title"]');

            const timeText = timeEl?.textContent?.trim() || '';
            const title = titleEl?.textContent?.trim() || '';

            const match = /(?:(\d+):)?([0-5]?\d):([0-5]\d)/.exec(timeText);
            if (match && title) {
                const [, h, m, s] = match;
                if (m && s) {
                    chapters.push({
                        startMs: parseTimestampToMs(h, m, s),
                        title,
                    });
                }
            }
        }

        if (chapters.length >= 2) {
            return chapters;
        }
    }

    // Source 2: YouTube description container text or timestamp anchors
    const descriptionContainer =
        root.querySelector('#description-inline-expander') ||
        root.querySelector('#description') ||
        root.querySelector('ytd-text-inline-expander');

    if (descriptionContainer?.textContent) {
        const parsed = parseDescriptionChapters(descriptionContainer.textContent);
        if (parsed) {
            return parsed;
        }
    }

    return null;
};
