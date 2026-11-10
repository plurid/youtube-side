import {
    type Bookmark,
    normalizeStudyData,
    STUDY_DATA_VERSION,
    STUDY_STORAGE_KEY,
    type StudyData,
    type VideoStudy,
} from '~data/study';

let writeQueue: Promise<void> = Promise.resolve();

const enqueueStudyWrite = (
    resolveData: () => Promise<StudyData> | StudyData,
): Promise<StudyData> => {
    const result = writeQueue.then(async () => {
        const nextData = await resolveData();
        const normalized = normalizeStudyData(nextData);
        try {
            await chrome.storage.local.set({
                [STUDY_STORAGE_KEY]: normalized,
            });
        } catch {
            // Keep going with normalized in-memory even if write fails
        }
        return normalized;
    });

    writeQueue = result.then(
        () => undefined,
        () => undefined,
    );

    return result;
};

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
    return data.videos[videoId] ?? { bookmarks: [], note: '', updatedAt: Date.now() };
};

export const saveVideoStudy = async (
    videoId: string,
    update: (current: VideoStudy) => VideoStudy,
): Promise<VideoStudy> => {
    const nextData = await enqueueStudyWrite(async () => {
        const currentData = await loadStudyData();
        const currentStudy = currentData.videos[videoId] ?? {
            bookmarks: [],
            note: '',
            updatedAt: Date.now(),
        };
        const updatedStudy = update(currentStudy);
        updatedStudy.updatedAt = Date.now();

        return {
            ...currentData,
            videos: {
                ...currentData.videos,
                [videoId]: updatedStudy,
            },
        };
    });

    return nextData.videos[videoId] ?? { bookmarks: [], note: '', updatedAt: Date.now() };
};

export const addBookmark = async (
    videoId: string,
    timeMs: number,
    label = '',
    note = '',
): Promise<VideoStudy> => {
    return saveVideoStudy(videoId, (study) => {
        const newBookmark: Bookmark = {
            timeMs,
            label,
            note,
            createdAt: Date.now(),
        };
        const nextBookmarks = [...study.bookmarks, newBookmark].sort((a, b) => a.timeMs - b.timeMs);
        return {
            ...study,
            bookmarks: nextBookmarks,
        };
    });
};

export const removeBookmark = async (videoId: string, index: number): Promise<VideoStudy> => {
    return saveVideoStudy(videoId, (study) => {
        const nextBookmarks = study.bookmarks.filter((_, i) => i !== index);
        return {
            ...study,
            bookmarks: nextBookmarks,
        };
    });
};

export const updateBookmark = async (
    videoId: string,
    index: number,
    update: Partial<Bookmark>,
): Promise<VideoStudy> => {
    return saveVideoStudy(videoId, (study) => {
        const nextBookmarks = study.bookmarks.map((bm, i) => {
            if (i !== index) {
                return bm;
            }
            return {
                ...bm,
                ...update,
            };
        });
        return {
            ...study,
            bookmarks: nextBookmarks,
        };
    });
};

export const setVideoNote = async (videoId: string, note: string): Promise<VideoStudy> => {
    return saveVideoStudy(videoId, (study) => ({
        ...study,
        note,
    }));
};
