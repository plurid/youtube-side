import {
    type Bookmark,
    normalizeStudyData,
    STUDY_DATA_VERSION,
    STUDY_STORAGE_KEY,
    type StudyData,
    type VideoStudy,
} from '~data/study';

export type BookmarkUpdate = Partial<Pick<Bookmark, 'label' | 'note'>>;

const emptyVideoStudy = (): VideoStudy => ({ bookmarks: [], note: '', updatedAt: Date.now() });

let writeQueue: Promise<void> = Promise.resolve();

/**
 * Serializes read-modify-write cycles. A failed storage write rejects the
 * caller's promise so the UI can report it; the queue itself keeps going.
 */
const enqueueStudyWrite = (
    resolveData: () => Promise<StudyData> | StudyData,
): Promise<StudyData> => {
    const result = writeQueue.then(async () => {
        const normalized = normalizeStudyData(await resolveData());
        await chrome.storage.local.set({
            [STUDY_STORAGE_KEY]: normalized,
        });
        return normalized;
    });

    writeQueue = result.then(
        () => undefined,
        () => undefined,
    );

    return result;
};

/** Resolves once every write queued so far has finished, successfully or not. */
export const whenStudyWritesSettled = (): Promise<void> => writeQueue;

export const loadStudyData = async (): Promise<StudyData> => {
    try {
        const stored = await chrome.storage.local.get(STUDY_STORAGE_KEY);
        return normalizeStudyData(stored[STUDY_STORAGE_KEY]);
    } catch {
        return { version: STUDY_DATA_VERSION, videos: {} };
    }
};

export const loadVideoStudy = async (videoId: string): Promise<VideoStudy> => {
    const data = await loadStudyData();
    return data.videos[videoId] ?? emptyVideoStudy();
};

export const saveVideoStudy = async (
    videoId: string,
    update: (current: VideoStudy) => VideoStudy,
): Promise<VideoStudy> => {
    const nextData = await enqueueStudyWrite(async () => {
        const currentData = await loadStudyData();
        const updatedStudy = {
            ...update(currentData.videos[videoId] ?? emptyVideoStudy()),
            updatedAt: Date.now(),
        };

        return {
            ...currentData,
            videos: {
                ...currentData.videos,
                [videoId]: updatedStudy,
            },
        };
    });

    return nextData.videos[videoId] ?? emptyVideoStudy();
};

export const addBookmark = (
    videoId: string,
    timeMs: number,
    label = '',
    note = '',
): Promise<VideoStudy> =>
    saveVideoStudy(videoId, (study) => {
        const usedIds = new Set(study.bookmarks.map((bookmark) => bookmark.createdAt));
        let createdAt = Date.now();
        while (usedIds.has(createdAt)) {
            createdAt += 1;
        }

        return {
            ...study,
            bookmarks: [...study.bookmarks, { timeMs, label, note, createdAt }].sort(
                (a, b) => a.timeMs - b.timeMs,
            ),
        };
    });

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

export const setVideoNote = (videoId: string, note: string): Promise<VideoStudy> =>
    saveVideoStudy(videoId, (study) => ({
        ...study,
        note,
    }));
