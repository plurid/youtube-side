export interface Chapter {
    startMs: number;
    title: string;
}

// YouTube renders each chapter up to three times (description cards, the
// chapters panel, the structured description); the panel copy is preferred
const MARKER_SELECTOR = 'ytd-macro-markers-list-item-renderer';
const CHAPTERS_PANEL_SELECTOR = '[target-id="engagement-panel-macro-markers-description-chapters"]';
const MARKER_TIME_SELECTOR = '#time';
const MARKER_TITLE_SELECTOR = 'h3.macro-markers, #details h3:not([hidden]), #details h4, #title';
const DESCRIPTION_SELECTORS = [
    '#description-inline-expander',
    '#description',
    'ytd-text-inline-expander',
] as const;

const TIMESTAMP_LINE_REGEX = /^\s*(?:(\d+):)?([0-5]?\d):([0-5]\d)\s*[-•–—]?\s*(.+)$/;
const CLOCK_REGEX = /(?:(\d+):)?([0-5]?\d):([0-5]\d)/;

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

/** At least two chapters with strictly increasing start times, or null. */
const toChapterList = (chapters: Chapter[]): Chapter[] | null => {
    if (chapters.length < 2) {
        return null;
    }

    for (let index = 1; index < chapters.length; index += 1) {
        const previous = chapters[index - 1];
        const current = chapters[index];
        if (previous && current && current.startMs <= previous.startMs) {
            return null;
        }
    }

    return chapters;
};

export const parseDescriptionChapters = (text: string): Chapter[] | null => {
    if (!text || typeof text !== 'string') {
        return null;
    }

    const chapters: Chapter[] = [];
    for (const rawLine of text.split('\n')) {
        const match = TIMESTAMP_LINE_REGEX.exec(rawLine.trim());
        const [, h, m, s, title] = match ?? [];
        const cleanTitle = title?.trim();
        if (m && s && cleanTitle) {
            chapters.push({ startMs: parseTimestampToMs(h, m, s), title: cleanTitle });
        }
    }

    return toChapterList(chapters);
};

const readMarker = (marker: Element): Chapter | null => {
    const timeText = marker.querySelector(MARKER_TIME_SELECTOR)?.textContent?.trim() ?? '';
    const titleNode = marker.querySelector(MARKER_TITLE_SELECTOR);
    const title = (titleNode?.getAttribute('title') || titleNode?.textContent || '').trim();

    const [, h, m, s] = CLOCK_REGEX.exec(timeText) ?? [];
    if (!m || !s || !title) {
        return null;
    }

    return { startMs: parseTimestampToMs(h, m, s), title };
};

const markersToChapters = (markers: Element[]): Chapter[] | null => {
    const byStart = new Map<number, Chapter>();
    for (const marker of markers) {
        const chapter = readMarker(marker);
        if (chapter && !byStart.has(chapter.startMs)) {
            byStart.set(chapter.startMs, chapter);
        }
    }

    return toChapterList([...byStart.values()].sort((a, b) => a.startMs - b.startMs));
};

/**
 * Callers must only use this once the page shows the current video (see
 * `isPageDataCurrent`); right after navigation the markers are stale.
 */
export const extractChaptersFromDOM = (root: Document = document): Chapter[] | null => {
    const markers = [...root.querySelectorAll(MARKER_SELECTOR)];
    const panelMarkers = markers.filter((marker) => marker.closest(CHAPTERS_PANEL_SELECTOR));

    const fromMarkers =
        (panelMarkers.length > 0 ? markersToChapters(panelMarkers) : null) ??
        markersToChapters(markers);
    if (fromMarkers) {
        return fromMarkers;
    }

    for (const selector of DESCRIPTION_SELECTORS) {
        const text = root.querySelector(selector)?.textContent;
        const parsed = text ? parseDescriptionChapters(text) : null;
        if (parsed) {
            return parsed;
        }
    }

    return null;
};
