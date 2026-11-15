import {
    type Bookmark,
    emptyVideoStudy,
    isEmptyStudy,
    MAX_BOOKMARKS_PER_VIDEO,
    MAX_VIDEO_NOTE_LENGTH,
    mergeStudies,
    normalizeVideoStudy,
    type StudyEntry,
    sortEntries,
    studyKey,
    toStoredStudy,
    type VideoMeta,
    type VideoStudy,
    videoIdFromKey,
} from './study';

export type BookmarkUpdate = Partial<Pick<Bookmark, 'label' | 'note'>>;
/** `ownWrite` is true when the change came from this page's own save. */
export type StudyListener = (study: VideoStudy, change: { ownWrite: boolean }) => void;
export type LibraryListener = () => void;

let writeQueue: Promise<void> = Promise.resolve();

// tags this page's writes, so it can tell its own change notifications from another tab's
const WRITER = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Serializes this page's read-modify-write cycles. A failed storage write
 * rejects the caller's promise so the UI can report it; the queue keeps going.
 */
const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = writeQueue.then(task);
    writeQueue = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
};

/** Resolves once every write queued so far has finished, successfully or not. */
export const whenStudyWritesSettled = (): Promise<void> => writeQueue;

const readStudy = async (videoId: string): Promise<VideoStudy | null> => {
    const key = studyKey(videoId);
    const stored = await chrome.storage.local.get(key);
    return stored[key] === undefined ? null : normalizeVideoStudy(stored[key]);
};

/** Stores a study, or removes the video's key when nothing is left in it. */
const writeStudy = async (videoId: string, study: VideoStudy): Promise<VideoStudy> => {
    const key = studyKey(videoId);
    if (isEmptyStudy(study)) {
        await chrome.storage.local.remove(key);
        return study;
    }

    await chrome.storage.local.set({ [key]: { ...toStoredStudy(study), writer: WRITER } });
    return study;
};

export const loadVideoStudy = async (videoId: string): Promise<VideoStudy> => {
    try {
        return (await readStudy(videoId)) ?? emptyVideoStudy();
    } catch {
        return emptyVideoStudy();
    }
};

/** Every video with notes or bookmarks, newest first. */
export const loadLibrary = async (): Promise<StudyEntry[]> => {
    const stored = await chrome.storage.local.get(null);
    const entries: StudyEntry[] = [];
    for (const [key, value] of Object.entries(stored)) {
        const videoId = videoIdFromKey(key);
        if (videoId) {
            const study = normalizeVideoStudy(value);
            if (!isEmptyStudy(study)) {
                entries.push({ videoId, study });
            }
        }
    }

    return sortEntries(entries);
};

const applyMeta = (study: VideoStudy, meta: VideoMeta | undefined): VideoStudy => ({
    ...study,
    title: meta?.title?.trim() || study.title,
    channel: meta?.channel?.trim() || study.channel,
});

export const saveVideoStudy = async (
    videoId: string,
    update: (current: VideoStudy) => VideoStudy,
    meta?: VideoMeta,
): Promise<VideoStudy> => {
    return enqueue(async () => {
        const current = (await readStudy(videoId)) ?? emptyVideoStudy();
        const next = normalizeVideoStudy({
            ...applyMeta(update(current), meta),
            updatedAt: Date.now(),
        });
        return writeStudy(videoId, next);
    });
};

/** Fails when the video already holds the most bookmarks one video may keep. */
export class BookmarkLimitError extends Error {
    public constructor() {
        super(`A video keeps at most ${MAX_BOOKMARKS_PER_VIDEO} bookmarks.`);
        this.name = 'BookmarkLimitError';
    }
}

export const addBookmark = (
    videoId: string,
    timeMs: number,
    label = '',
    note = '',
    meta?: VideoMeta,
): Promise<VideoStudy> =>
    saveVideoStudy(
        videoId,
        (study) => {
            if (study.bookmarks.length >= MAX_BOOKMARKS_PER_VIDEO) {
                throw new BookmarkLimitError();
            }

            const usedIds = new Set(study.bookmarks.map((bookmark) => bookmark.createdAt));
            let createdAt = Date.now();
            while (usedIds.has(createdAt)) {
                createdAt += 1;
            }

            return {
                ...study,
                bookmarks: [...study.bookmarks, { timeMs, label, note, createdAt }],
            };
        },
        meta,
    );

export const removeBookmark = (videoId: string, bookmarkId: number): Promise<VideoStudy> =>
    saveVideoStudy(videoId, (study) => ({
        ...study,
        bookmarks: study.bookmarks.filter((bookmark) => bookmark.createdAt !== bookmarkId),
    }));

export const updateBookmark = (
    videoId: string,
    bookmarkId: number,
    update: BookmarkUpdate,
): Promise<VideoStudy> =>
    saveVideoStudy(videoId, (study) => ({
        ...study,
        bookmarks: study.bookmarks.map((bookmark) =>
            bookmark.createdAt === bookmarkId ? { ...bookmark, ...update } : bookmark,
        ),
    }));

export const setVideoNote = (
    videoId: string,
    note: string,
    meta?: VideoMeta,
): Promise<VideoStudy> => saveVideoStudy(videoId, (study) => ({ ...study, note }), meta);

/** Fails when the note would grow past its limit, so nothing is silently cut. */
export class NoteLimitError extends Error {
    public constructor() {
        super(
            `A video's note keeps at most ${MAX_VIDEO_NOTE_LENGTH.toLocaleString('en-US')} characters.`,
        );
        this.name = 'NoteLimitError';
    }
}

/** Appends a block (a quoted transcript line) to the video's note as its own paragraph. */
export const appendToNote = (
    videoId: string,
    block: string,
    meta?: VideoMeta,
): Promise<VideoStudy> =>
    saveVideoStudy(
        videoId,
        (study) => {
            const base = study.note.trimEnd();
            const note = base ? `${base}\n\n${block}` : block;
            if (note.length > MAX_VIDEO_NOTE_LENGTH) {
                throw new NoteLimitError();
            }
            return { ...study, note };
        },
        meta,
    );

export const deleteVideoStudy = (videoId: string): Promise<void> =>
    enqueue(() => chrome.storage.local.remove(studyKey(videoId)));

/** Restores a backup into storage, merging with what is already there. Resolves the count. */
export const importStudies = async (entries: StudyEntry[]): Promise<number> => {
    return enqueue(async () => {
        let count = 0;
        for (const { videoId, study } of entries) {
            const current = await readStudy(videoId);
            await writeStudy(videoId, current ? mergeStudies(current, study) : study);
            count += 1;
        }
        return count;
    });
};

/** Calls the listener with the video's study whenever any page changes it. */
export const subscribeVideoStudy = (videoId: string, listener: StudyListener): (() => void) => {
    const key = studyKey(videoId);
    const handleChange = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
    ) => {
        const change = changes[key];
        if (areaName === 'local' && change) {
            const value: unknown = change.newValue;
            listener(value === undefined ? emptyVideoStudy() : normalizeVideoStudy(value), {
                ownWrite:
                    typeof value === 'object' &&
                    value !== null &&
                    (value as { writer?: unknown }).writer === WRITER,
            });
        }
    };

    chrome.storage.onChanged.addListener(handleChange);
    return () => {
        chrome.storage.onChanged.removeListener(handleChange);
    };
};

/** Calls the listener when any video's study changes. */
export const subscribeLibrary = (listener: LibraryListener): (() => void) => {
    const handleChange = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
    ) => {
        if (areaName === 'local' && Object.keys(changes).some((key) => videoIdFromKey(key))) {
            listener();
        }
    };

    chrome.storage.onChanged.addListener(handleChange);
    return () => {
        chrome.storage.onChanged.removeListener(handleChange);
    };
};
