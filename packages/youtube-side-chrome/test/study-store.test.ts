import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
    MAX_BOOKMARKS_PER_VIDEO,
    MAX_VIDEO_NOTE_LENGTH,
    STUDY_RECORD_VERSION,
    studyKey,
} from '~data/study';
import {
    addBookmark,
    appendToNote,
    BookmarkLimitError,
    deleteVideoStudy,
    importStudies,
    loadLibrary,
    loadVideoStudy,
    NoteLimitError,
    removeBookmark,
    saveVideoStudy,
    setVideoNote,
    subscribeLibrary,
    subscribeVideoStudy,
    updateBookmark,
    whenStudyWritesSettled,
} from '~data/studyStore';
import { type ChromeMock, createChromeMock } from './chrome';

describe('studyStore module', () => {
    let mock: ChromeMock;

    beforeEach(() => {
        mock = createChromeMock();
    });

    it('loads an empty study for a video with nothing stored', async () => {
        expect(await loadVideoStudy('vid_abc01')).toMatchObject({ bookmarks: [], note: '' });
        expect(await loadLibrary()).toEqual([]);
    });

    it('keeps each video under its own key, with its title and channel', async () => {
        await setVideoNote('vid_abc01', 'My note', { title: ' Lecture ', channel: 'Channel' });
        await addBookmark('vid_xyz01', 5000, 'Start');

        expect(mock.data[studyKey('vid_abc01')]).toMatchObject({
            version: STUDY_RECORD_VERSION,
            note: 'My note',
            title: 'Lecture',
            channel: 'Channel',
        });
        expect(Object.keys(mock.data).sort()).toEqual([
            studyKey('vid_abc01'),
            studyKey('vid_xyz01'),
        ]);

        // a later save without metadata keeps what was stored
        await setVideoNote('vid_abc01', 'Edited');
        expect(await loadVideoStudy('vid_abc01')).toMatchObject({
            note: 'Edited',
            title: 'Lecture',
        });
    });

    it('stores any number of videos, listed newest first', async () => {
        const now = jest.spyOn(Date, 'now');
        for (let index = 0; index < 120; index += 1) {
            now.mockReturnValue(1_000 + index);
            await setVideoNote(`video_${String(index).padStart(3, '0')}`, `Note ${index}`);
        }
        now.mockRestore();

        const library = await loadLibrary();
        expect(library).toHaveLength(120);
        expect(library[0]?.videoId).toBe('video_119');
        expect(library.at(-1)?.videoId).toBe('video_000');
    });

    it('adds, updates, and removes bookmarks by id, sorted by time', async () => {
        const videoId = 'test_video';
        await addBookmark(videoId, 10000, 'Ten sec', 'Check this');
        await addBookmark(videoId, 2000, 'Two sec');
        let study = await loadVideoStudy(videoId);
        expect(study.bookmarks.map((bookmark) => bookmark.timeMs)).toEqual([2000, 10000]);

        const [twoSeconds, tenSeconds] = study.bookmarks;
        await updateBookmark(videoId, tenSeconds?.createdAt ?? -1, { label: 'Updated ten' });
        await removeBookmark(videoId, twoSeconds?.createdAt ?? -1);
        study = await loadVideoStudy(videoId);
        expect(study.bookmarks).toHaveLength(1);
        expect(study.bookmarks[0]?.label).toBe('Updated ten');
    });

    it('keeps bookmark ids unique when captured in the same millisecond', async () => {
        const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
        await addBookmark('same_ms', 1000);
        await addBookmark('same_ms', 2000);
        now.mockRestore();

        const study = await loadVideoStudy('same_ms');
        expect(new Set(study.bookmarks.map((bookmark) => bookmark.createdAt)).size).toBe(2);
    });

    it('removes a video once its note and bookmarks are cleared', async () => {
        await setVideoNote('kept01', 'Keep me');
        await setVideoNote('cleared', 'Temporary');
        await setVideoNote('cleared', '');

        await addBookmark('unmarked', 1000);
        const [bookmark] = (await loadVideoStudy('unmarked')).bookmarks;
        await removeBookmark('unmarked', bookmark?.createdAt ?? -1);

        expect(Object.keys(mock.data)).toEqual([studyKey('kept01')]);
        expect((await loadLibrary()).map((entry) => entry.videoId)).toEqual(['kept01']);
    });

    it('refuses a bookmark past the per-video limit instead of dropping one', async () => {
        mock.data[studyKey('full_vid')] = {
            bookmarks: Array.from({ length: MAX_BOOKMARKS_PER_VIDEO }, (_, index) => ({
                timeMs: index,
                createdAt: index,
            })),
        };

        await expect(addBookmark('full_vid', 5)).rejects.toBeInstanceOf(BookmarkLimitError);
        expect((await loadVideoStudy('full_vid')).bookmarks).toHaveLength(MAX_BOOKMARKS_PER_VIDEO);
    });

    it('appends quotes as paragraphs and refuses to outgrow the note limit', async () => {
        await appendToNote('quoted', '> [0:05] first');
        await appendToNote('quoted', '> [0:09] second', { title: 'Talk' });
        expect(await loadVideoStudy('quoted')).toMatchObject({
            note: '> [0:05] first\n\n> [0:09] second',
            title: 'Talk',
        });

        await setVideoNote('quoted', 'x'.repeat(MAX_VIDEO_NOTE_LENGTH - 2));
        await expect(appendToNote('quoted', 'too long')).rejects.toBeInstanceOf(NoteLimitError);
    });

    it('deletes a video and restores a backup by merging', async () => {
        await setVideoNote('restore1', 'Local');
        await deleteVideoStudy('restore1');
        expect(await loadLibrary()).toEqual([]);

        await setVideoNote('restore2', 'Local');
        const count = await importStudies([
            {
                videoId: 'restore2',
                study: { bookmarks: [], note: 'Backup', title: 'T', channel: '', updatedAt: 1 },
            },
            {
                videoId: 'restore3',
                study: { bookmarks: [], note: 'New', title: '', channel: '', updatedAt: 1 },
            },
        ]);
        expect(count).toBe(2);
        expect((await loadVideoStudy('restore2')).note).toBe('Local\n\nBackup');
        expect((await loadVideoStudy('restore3')).note).toBe('New');
    });

    it('notifies subscribers of one video and of the library', async () => {
        const videoListener = jest.fn();
        const libraryListener = jest.fn();
        const stopVideo = subscribeVideoStudy('watched1', videoListener);
        const stopLibrary = subscribeLibrary(libraryListener);

        await setVideoNote('watched1', 'Hello');
        await setVideoNote('other001', 'Elsewhere');
        await deleteVideoStudy('watched1');

        expect(videoListener.mock.calls.map(([study]) => (study as { note: string }).note)).toEqual(
            ['Hello', ''],
        );
        expect(libraryListener).toHaveBeenCalledTimes(3);

        stopVideo();
        stopLibrary();
        await setVideoNote('watched1', 'After');
        expect(videoListener).toHaveBeenCalledTimes(2);
        expect(libraryListener).toHaveBeenCalledTimes(3);
    });

    it('reports failed writes and keeps the queue working', async () => {
        mock.setMock.mockRejectedValueOnce(new Error('Storage quota exceeded'));
        await expect(
            saveVideoStudy('vid_err', (current) => ({ ...current, note: 'Lost value' })),
        ).rejects.toThrow('Storage quota exceeded');

        await expect(
            saveVideoStudy('vid_throw', () => {
                throw new Error('Resolver error');
            }),
        ).rejects.toThrow('Resolver error');

        await setVideoNote('vid_err', 'Saved later');
        await whenStudyWritesSettled();
        expect((await loadVideoStudy('vid_err')).note).toBe('Saved later');
    });

    it('returns an empty study when the storage read rejects', async () => {
        mock.getMock.mockRejectedValueOnce(new Error('Read failed'));
        expect(await loadVideoStudy('vid_any1')).toMatchObject({ bookmarks: [], note: '' });
    });
});
