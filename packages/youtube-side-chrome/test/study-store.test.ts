import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
    addBookmark,
    loadStudyData,
    loadVideoStudy,
    removeBookmark,
    saveVideoStudy,
    setVideoNote,
    updateBookmark,
    whenStudyWritesSettled,
} from '~contentscript/study/studyStore';
import { STUDY_DATA_VERSION, STUDY_STORAGE_KEY } from '~data/study';
import { createChromeMock } from './chrome';

describe('studyStore module', () => {
    beforeEach(() => {
        createChromeMock();
    });

    it('loads empty study data when storage is empty', async () => {
        const data = await loadStudyData();
        expect(data).toEqual({
            version: STUDY_DATA_VERSION,
            videos: {},
        });
    });

    it('loads study data from chrome.storage.local', async () => {
        createChromeMock({
            [STUDY_STORAGE_KEY]: {
                version: 1,
                videos: {
                    vid_abc: {
                        bookmarks: [
                            {
                                timeMs: 5000,
                                label: 'Start',
                                note: 'Hello',
                                createdAt: 1,
                            },
                        ],
                        note: 'My note',
                        updatedAt: 100,
                    },
                },
            },
        });

        const study = await loadVideoStudy('vid_abc');
        expect(study.note).toBe('My note');
        expect(study.bookmarks).toHaveLength(1);
        expect(study.bookmarks[0]?.label).toBe('Start');

        const nonExistent = await loadVideoStudy('vid_xyz');
        expect(nonExistent.bookmarks).toEqual([]);
        expect(nonExistent.note).toBe('');
    });

    it('adds, updates, and removes bookmarks', async () => {
        createChromeMock();

        const videoId = 'test_video';
        await addBookmark(videoId, 10000, 'Ten sec', 'Check this');
        let study = await loadVideoStudy(videoId);
        expect(study.bookmarks).toHaveLength(1);
        expect(study.bookmarks[0]?.timeMs).toBe(10000);
        expect(study.bookmarks[0]?.label).toBe('Ten sec');

        // Add second bookmark earlier in time (should be sorted)
        await addBookmark(videoId, 2000, 'Two sec');
        study = await loadVideoStudy(videoId);
        expect(study.bookmarks).toHaveLength(2);
        expect(study.bookmarks[0]?.timeMs).toBe(2000);
        expect(study.bookmarks[1]?.timeMs).toBe(10000);

        // bookmarks are addressed by id, so sorting cannot redirect an edit
        const [twoSeconds, tenSeconds] = study.bookmarks;
        expect(twoSeconds?.createdAt).not.toBe(tenSeconds?.createdAt);

        await updateBookmark(videoId, tenSeconds?.createdAt ?? -1, { label: 'Updated ten' });
        study = await loadVideoStudy(videoId);
        expect(study.bookmarks[1]?.label).toBe('Updated ten');

        await removeBookmark(videoId, twoSeconds?.createdAt ?? -1);
        study = await loadVideoStudy(videoId);
        expect(study.bookmarks).toHaveLength(1);
        expect(study.bookmarks[0]?.timeMs).toBe(10000);
    });

    it('keeps bookmark ids unique when captured in the same millisecond', async () => {
        const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
        await addBookmark('same_ms', 1000);
        await addBookmark('same_ms', 2000);
        now.mockRestore();

        const study = await loadVideoStudy('same_ms');
        expect(new Set(study.bookmarks.map((bookmark) => bookmark.createdAt)).size).toBe(2);
    });

    it('saves and updates video note', async () => {
        createChromeMock();
        const videoId = 'test_note_vid';

        await setVideoNote(videoId, 'Comprehensive notes.');
        const study = await loadVideoStudy(videoId);
        expect(study.note).toBe('Comprehensive notes.');
    });

    it('reports failed writes and keeps the queue working', async () => {
        const mock = createChromeMock();
        mock.setMock.mockRejectedValueOnce(new Error('Storage quota exceeded'));

        await expect(
            saveVideoStudy('vid_err', (current) => ({
                ...current,
                note: 'Lost value',
            })),
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

    it('returns default study data when storage read rejects', async () => {
        const mock = createChromeMock();
        mock.getMock.mockRejectedValueOnce(new Error('Storage read error'));

        const data = await loadStudyData();
        expect(data).toEqual({
            version: STUDY_DATA_VERSION,
            videos: {},
        });
    });
});
