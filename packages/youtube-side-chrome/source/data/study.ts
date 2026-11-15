export interface Bookmark {
    timeMs: number;
    label: string;
    note: string;
    createdAt: number;
}

export interface VideoStudy {
    bookmarks: Bookmark[];
    note: string;
    /** the video's title and channel when the study was last saved, for the library */
    title: string;
    channel: string;
    updatedAt: number;
}

export interface VideoMeta {
    title?: string;
    channel?: string;
}

export interface StudyEntry {
    videoId: string;
    study: VideoStudy;
}

/** One storage key per video: a save touches only its own video, so the count is unbounded. */
export const STUDY_KEY_PREFIX = 'youtubeSideStudy:';
export const STUDY_RECORD_VERSION = 2;

export const BACKUP_FORMAT = 'youtube-side-notes';
export const BACKUP_VERSION = 2;

export const MAX_BOOKMARKS_PER_VIDEO = 1_000;
export const MAX_LABEL_LENGTH = 200;
export const MAX_BOOKMARK_NOTE_LENGTH = 5_000;
export const MAX_VIDEO_NOTE_LENGTH = 100_000;
export const MAX_TITLE_LENGTH = 300;
export const MAX_CHANNEL_LENGTH = 200;

const VIDEO_ID_PATTERN = /^[\w-]{6,20}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedText = (value: unknown, maxLength: number): string =>
    typeof value === 'string' ? value.trim().slice(0, maxLength).trim() : '';

export const isVideoId = (value: unknown): value is string =>
    typeof value === 'string' && VIDEO_ID_PATTERN.test(value);

export const studyKey = (videoId: string): string => `${STUDY_KEY_PREFIX}${videoId}`;

export const videoIdFromKey = (key: string): string | null => {
    if (!key.startsWith(STUDY_KEY_PREFIX)) {
        return null;
    }

    const videoId = key.slice(STUDY_KEY_PREFIX.length);
    return isVideoId(videoId) ? videoId : null;
};

export const emptyVideoStudy = (): VideoStudy => ({
    bookmarks: [],
    note: '',
    title: '',
    channel: '',
    updatedAt: Date.now(),
});

/** A cleared video holds nothing worth keeping and is removed from storage. */
export const isEmptyStudy = (study: VideoStudy): boolean =>
    study.bookmarks.length === 0 && study.note.trim().length === 0;

export const normalizeBookmark = (value: unknown): Bookmark | null => {
    if (!isRecord(value)) {
        return null;
    }

    const timeMs =
        typeof value.timeMs === 'number' && Number.isFinite(value.timeMs)
            ? Math.max(0, Math.round(value.timeMs))
            : null;
    if (timeMs === null) {
        return null;
    }

    const createdAt =
        typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
            ? value.createdAt
            : Date.now();

    return {
        timeMs,
        label: boundedText(value.label, MAX_LABEL_LENGTH),
        note: boundedText(value.note, MAX_BOOKMARK_NOTE_LENGTH),
        createdAt,
    };
};

export const normalizeVideoStudy = (value: unknown): VideoStudy => {
    if (!isRecord(value)) {
        return emptyVideoStudy();
    }

    const rawBookmarks = Array.isArray(value.bookmarks) ? value.bookmarks : [];
    const bookmarks: Bookmark[] = [];
    // createdAt identifies a bookmark for edits and deletes, so it must be unique per video
    const usedIds = new Set<number>();
    for (const item of rawBookmarks) {
        const normalized = normalizeBookmark(item);
        if (normalized) {
            while (usedIds.has(normalized.createdAt)) {
                normalized.createdAt += 1;
            }
            usedIds.add(normalized.createdAt);
            bookmarks.push(normalized);
            if (bookmarks.length >= MAX_BOOKMARKS_PER_VIDEO) {
                break;
            }
        }
    }
    bookmarks.sort((a, b) => a.timeMs - b.timeMs);

    return {
        bookmarks,
        note: typeof value.note === 'string' ? value.note.slice(0, MAX_VIDEO_NOTE_LENGTH) : '',
        title: boundedText(value.title, MAX_TITLE_LENGTH),
        channel: boundedText(value.channel, MAX_CHANNEL_LENGTH),
        updatedAt:
            typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
                ? value.updatedAt
                : Date.now(),
    };
};

/** The stored shape of one video's record. */
export const toStoredStudy = (study: VideoStudy) => ({
    version: STUDY_RECORD_VERSION,
    ...normalizeVideoStudy(study),
});

/** Reads a backup's `{ [videoId]: study }` map, skipping invalid ids and empty studies. */
const readVideoMap = (value: unknown): StudyEntry[] => {
    if (!isRecord(value)) {
        return [];
    }

    const entries: StudyEntry[] = [];
    for (const [rawId, rawStudy] of Object.entries(value)) {
        const videoId = rawId.trim();
        if (!isVideoId(videoId)) {
            continue;
        }

        const study = normalizeVideoStudy(rawStudy);
        if (!isEmptyStudy(study)) {
            entries.push({ videoId, study });
        }
    }

    return entries;
};

/** The newest first; the order the library lists videos in. */
export const sortEntries = (entries: StudyEntry[]): StudyEntry[] =>
    [...entries].sort((a, b) => b.study.updatedAt - a.study.updatedAt);

/**
 * Combines a stored study with one from a restored backup without losing
 * either: bookmarks are joined, a note is kept when
 * one already contains the other and appended otherwise, so restoring the
 * same backup twice changes nothing.
 */
export const mergeStudies = (current: VideoStudy, incoming: VideoStudy): VideoStudy => {
    const seen = new Set(
        current.bookmarks.map((bookmark) => `${bookmark.createdAt}:${bookmark.timeMs}`),
    );
    const bookmarks = [
        ...current.bookmarks,
        ...incoming.bookmarks.filter(
            (bookmark) => !seen.has(`${bookmark.createdAt}:${bookmark.timeMs}`),
        ),
    ];

    const currentNote = current.note.trim();
    const incomingNote = incoming.note.trim();
    let note = current.note;
    if (!currentNote || incomingNote.includes(currentNote)) {
        note = incoming.note;
    } else if (incomingNote && !currentNote.includes(incomingNote)) {
        note = `${current.note.trimEnd()}\n\n${incoming.note.trimStart()}`;
    }

    return normalizeVideoStudy({
        bookmarks,
        note,
        title: current.title || incoming.title,
        channel: current.channel || incoming.channel,
        updatedAt: Math.max(current.updatedAt, incoming.updatedAt),
    });
};

export interface StudyBackup {
    format: typeof BACKUP_FORMAT;
    version: typeof BACKUP_VERSION;
    exportedAt: string;
    videos: Record<string, VideoStudy>;
}

export const createBackup = (entries: StudyEntry[], now = new Date()): StudyBackup => {
    const videos: Record<string, VideoStudy> = {};
    for (const { videoId, study } of sortEntries(entries)) {
        videos[videoId] = study;
    }

    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: now.toISOString(),
        videos,
    };
};

/** The videos of a backup file; null when the value is not one. */
export const parseBackup = (value: unknown): StudyEntry[] | null => {
    if (!isRecord(value) || value.format !== BACKUP_FORMAT || !isRecord(value.videos)) {
        return null;
    }

    return readVideoMap(value.videos);
};

export const formatTimestamp = (timeMs: number): string => {
    const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');

    if (hours > 0) {
        return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${minutes}:${pad(seconds)}`;
};

export interface NoteTimestamp {
    timeMs: number;
    /** the timestamp as written, e.g. `[1:23]` or `1:02:03` */
    text: string;
    index: number;
    /** the rest of the line after the timestamp, for a jump list */
    context: string;
}

// h:mm:ss or m:ss, optionally in brackets; not part of a longer number or ratio
const NOTE_TIMESTAMP_PATTERN = /(?<![\w:.])\[?((?:(\d{1,2}):)?([0-5]?\d):([0-5]\d))\]?(?![\w:])/g;

export const findNoteTimestamps = (note: string): NoteTimestamp[] => {
    const timestamps: NoteTimestamp[] = [];
    for (const match of note.matchAll(NOTE_TIMESTAMP_PATTERN)) {
        const [text, , hours, minutes, seconds] = match;
        if (minutes === undefined || seconds === undefined) {
            continue;
        }

        const timeMs =
            ((hours ? Number(hours) * 3600 : 0) + Number(minutes) * 60 + Number(seconds)) * 1000;
        const index = match.index;
        const lineEnd = note.indexOf('\n', index);
        const context = note
            .slice(index + text.length, lineEnd === -1 ? undefined : lineEnd)
            .trim()
            .slice(0, 80);
        timestamps.push({ timeMs, text, index, context });
    }

    return timestamps;
};

/** The marker the Notes view inserts for the current moment. */
export const noteTimestamp = (timeMs: number): string => `[${formatTimestamp(timeMs)}]`;

export const timestampUrl = (url: string, seconds: number): string => {
    try {
        const parsed = new URL(url);
        parsed.searchParams.set('t', `${seconds}s`);
        return parsed.toString();
    } catch {
        return url.includes('?') ? `${url}&t=${seconds}s` : `${url}?t=${seconds}s`;
    }
};

export const watchUrl = (videoId: string): string =>
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

/** Bracketed timestamps in a note become links to that moment. */
const linkNoteTimestamps = (note: string, url: string): string =>
    note.replace(/\[((?:\d{1,2}:)?[0-5]?\d:[0-5]\d)\](?!\()/g, (text, clock: string) => {
        const [timestamp] = findNoteTimestamps(clock);
        return timestamp
            ? `[${clock}](${timestampUrl(url, Math.floor(timestamp.timeMs / 1000))})`
            : text;
    });

export const exportStudyMarkdown = (
    videoTitle: string,
    url: string,
    study: VideoStudy,
    headingLevel = 1,
): string => {
    const heading = '#'.repeat(headingLevel);
    const lines: string[] = [`${heading} ${videoTitle || 'YouTube Video'}`, ''];
    if (study.channel) {
        lines.push(`${study.channel} · ${url}`, '');
    } else {
        lines.push(url, '');
    }

    lines.push(`${heading}# Bookmarks`);
    if (study.bookmarks.length === 0) {
        lines.push('_(No bookmarks)_');
    } else {
        for (const bm of study.bookmarks) {
            const timeTag = formatTimestamp(bm.timeMs);
            const seconds = Math.floor(bm.timeMs / 1000);
            const text = [bm.label, bm.note].filter(Boolean).join(': ');
            lines.push(`- [${timeTag}](${timestampUrl(url, seconds)})${text ? ` ${text}` : ''}`);
        }
    }

    lines.push('');
    lines.push(`${heading}# Notes`);
    lines.push(study.note ? linkNoteTimestamps(study.note, url) : '_(No notes)_');
    lines.push('');

    return lines.join('\n');
};

/** Every video's notes in one document, newest first. */
export const exportLibraryMarkdown = (entries: StudyEntry[], now = new Date()): string => {
    const sorted = sortEntries(entries);
    const lines = [
        '# YouTube Side notes',
        '',
        `${sorted.length} ${sorted.length === 1 ? 'video' : 'videos'}, exported ${now.toISOString().slice(0, 10)}`,
        '',
    ];

    for (const { videoId, study } of sorted) {
        lines.push(exportStudyMarkdown(study.title || videoId, watchUrl(videoId), study, 2));
    }

    return lines.join('\n');
};
