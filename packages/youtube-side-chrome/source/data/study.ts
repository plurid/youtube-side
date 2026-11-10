export interface Bookmark {
    timeMs: number;
    label: string;
    note: string;
    createdAt: number;
}

export interface VideoStudy {
    bookmarks: Bookmark[];
    note: string;
    updatedAt: number;
}

export interface StudyData {
    version: 1;
    videos: Record<string, VideoStudy>;
}

export const STUDY_STORAGE_KEY = 'youtubeSideStudy';
export const STUDY_DATA_VERSION = 1;

export const MAX_BOOKMARKS_PER_VIDEO = 200;
export const MAX_LABEL_LENGTH = 200;
export const MAX_BOOKMARK_NOTE_LENGTH = 2_000;
export const MAX_VIDEO_NOTE_LENGTH = 10_000;
export const MAX_STORED_VIDEOS = 50;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

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

    const label =
        typeof value.label === 'string' ? value.label.slice(0, MAX_LABEL_LENGTH).trim() : '';
    const note =
        typeof value.note === 'string' ? value.note.slice(0, MAX_BOOKMARK_NOTE_LENGTH).trim() : '';
    const createdAt =
        typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
            ? value.createdAt
            : Date.now();

    return {
        timeMs,
        label,
        note,
        createdAt,
    };
};

export const normalizeVideoStudy = (value: unknown): VideoStudy => {
    if (!isRecord(value)) {
        return {
            bookmarks: [],
            note: '',
            updatedAt: Date.now(),
        };
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

    const note = typeof value.note === 'string' ? value.note.slice(0, MAX_VIDEO_NOTE_LENGTH) : '';

    const updatedAt =
        typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
            ? value.updatedAt
            : Date.now();

    return {
        bookmarks,
        note,
        updatedAt,
    };
};

export const normalizeStudyData = (value: unknown): StudyData => {
    if (!isRecord(value)) {
        return {
            version: STUDY_DATA_VERSION,
            videos: {},
        };
    }

    const videosInput = isRecord(value.videos) ? value.videos : {};
    const videoEntries: [string, VideoStudy][] = [];

    for (const [id, rawVideo] of Object.entries(videosInput)) {
        if (typeof id === 'string' && id.trim().length > 0) {
            videoEntries.push([id.trim(), normalizeVideoStudy(rawVideo)]);
        }
    }

    // Sort by updatedAt descending to retain the most recently updated videos up to MAX_STORED_VIDEOS
    videoEntries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    const retainedEntries = videoEntries.slice(0, MAX_STORED_VIDEOS);

    const videos: Record<string, VideoStudy> = {};
    for (const [id, study] of retainedEntries) {
        videos[id] = study;
    }

    return {
        version: STUDY_DATA_VERSION,
        videos,
    };
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

const timestampUrl = (url: string, seconds: number): string => {
    try {
        const parsed = new URL(url);
        parsed.searchParams.set('t', `${seconds}s`);
        return parsed.toString();
    } catch {
        return url.includes('?') ? `${url}&t=${seconds}s` : `${url}?t=${seconds}s`;
    }
};

export const exportStudyMarkdown = (videoTitle: string, url: string, study: VideoStudy): string => {
    const lines: string[] = [`# ${videoTitle || 'YouTube Video'}`, '', url, ''];

    lines.push('## Bookmarks');
    if (study.bookmarks.length === 0) {
        lines.push('_(No bookmarks)_');
    } else {
        for (const bm of study.bookmarks) {
            const timeTag = formatTimestamp(bm.timeMs);
            const seconds = Math.floor(bm.timeMs / 1000);
            const cleanUrl = timestampUrl(url, seconds);
            const text = [bm.label, bm.note].filter(Boolean).join(': ');
            lines.push(`- [${timeTag}](${cleanUrl})${text ? ` ${text}` : ''}`);
        }
    }

    lines.push('');
    lines.push('## Notes');
    lines.push(study.note || '_(No notes)_');
    lines.push('');

    return lines.join('\n');
};
