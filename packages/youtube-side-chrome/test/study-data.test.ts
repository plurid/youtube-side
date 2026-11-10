import { describe, expect, it } from '@jest/globals';

import {
    exportStudyMarkdown,
    formatTimestamp,
    MAX_BOOKMARK_NOTE_LENGTH,
    MAX_BOOKMARKS_PER_VIDEO,
    MAX_LABEL_LENGTH,
    MAX_STORED_VIDEOS,
    MAX_VIDEO_NOTE_LENGTH,
    normalizeBookmark,
    normalizeStudyData,
    normalizeVideoStudy,
    type VideoStudy,
} from '~data/study';

describe('study data normalization and export', () => {
    describe('normalizeBookmark', () => {
        it('normalizes valid bookmark', () => {
            const result = normalizeBookmark({
                timeMs: 12500,
                label: 'Intro',
                note: 'Important concept',
                createdAt: 1000,
            });
            expect(result).toEqual({
                timeMs: 12500,
                label: 'Intro',
                note: 'Important concept',
                createdAt: 1000,
            });
        });

        it('returns null for non-records or invalid timeMs', () => {
            expect(normalizeBookmark(null)).toBeNull();
            expect(normalizeBookmark(undefined)).toBeNull();
            expect(normalizeBookmark({ timeMs: 'invalid' })).toBeNull();
            expect(normalizeBookmark({ timeMs: Number.NaN })).toBeNull();
        });

        it('truncates oversized label and note', () => {
            const longLabel = 'a'.repeat(MAX_LABEL_LENGTH + 50);
            const longNote = 'b'.repeat(MAX_BOOKMARK_NOTE_LENGTH + 100);
            const result = normalizeBookmark({
                timeMs: 0,
                label: longLabel,
                note: longNote,
            });
            expect(result?.label.length).toBe(MAX_LABEL_LENGTH);
            expect(result?.note.length).toBe(MAX_BOOKMARK_NOTE_LENGTH);
        });
    });

    describe('normalizeVideoStudy', () => {
        it('caps bookmarks at MAX_BOOKMARKS_PER_VIDEO', () => {
            const rawBookmarks = Array.from({ length: 250 }, (_, i) => ({
                timeMs: i * 1000,
                label: `bm ${i}`,
            }));
            const result = normalizeVideoStudy({ bookmarks: rawBookmarks });
            expect(result.bookmarks.length).toBe(MAX_BOOKMARKS_PER_VIDEO);
        });

        it('makes duplicate bookmark ids unique', () => {
            const result = normalizeVideoStudy({
                bookmarks: [
                    { timeMs: 1, createdAt: 5 },
                    { timeMs: 2, createdAt: 5 },
                    { timeMs: 3, createdAt: 6 },
                ],
            });
            expect(result.bookmarks.map((bookmark) => bookmark.createdAt)).toEqual([5, 6, 7]);
        });

        it('truncates video note to MAX_VIDEO_NOTE_LENGTH', () => {
            const longNote = 'x'.repeat(MAX_VIDEO_NOTE_LENGTH + 500);
            const result = normalizeVideoStudy({ note: longNote });
            expect(result.note.length).toBe(MAX_VIDEO_NOTE_LENGTH);
        });
    });

    describe('normalizeStudyData', () => {
        it('evicts oldest videos beyond MAX_STORED_VIDEOS', () => {
            const videos: Record<string, VideoStudy> = {};
            for (let i = 0; i < 60; i++) {
                videos[`vid_${i}`] = {
                    bookmarks: [],
                    note: `Note ${i}`,
                    updatedAt: 1000 + i, // larger = newer
                };
            }

            const normalized = normalizeStudyData({ videos });
            const keys = Object.keys(normalized.videos);
            expect(keys.length).toBe(MAX_STORED_VIDEOS);
            // Oldest (0 to 9) should be evicted; 10 to 59 retained
            expect(normalized.videos.vid_0).toBeUndefined();
            expect(normalized.videos.vid_9).toBeUndefined();
            expect(normalized.videos.vid_10).toBeDefined();
            expect(normalized.videos.vid_59).toBeDefined();
        });

        it('returns empty study data on invalid input', () => {
            expect(normalizeStudyData(null)).toEqual({ version: 1, videos: {} });
            expect(normalizeStudyData('invalid')).toEqual({ version: 1, videos: {} });
        });
    });

    describe('formatTimestamp', () => {
        it('formats sub-minute times', () => {
            expect(formatTimestamp(45000)).toBe('0:45');
        });

        it('formats multi-minute times', () => {
            expect(formatTimestamp(125000)).toBe('2:05');
        });

        it('formats hours', () => {
            expect(formatTimestamp(3665000)).toBe('1:01:05');
        });
    });

    describe('exportStudyMarkdown', () => {
        it('generates expected markdown with timestamps, labels, notes', () => {
            const study: VideoStudy = {
                bookmarks: [
                    { timeMs: 754000, label: 'Key takeaway', note: 'Remember this', createdAt: 1 },
                ],
                note: 'General video thoughts.',
                updatedAt: 1,
            };

            const md = exportStudyMarkdown(
                'My Lecture',
                'https://www.youtube.com/watch?v=123',
                study,
            );
            expect(md.startsWith('# My Lecture\n\nhttps://www.youtube.com/watch?v=123\n')).toBe(
                true,
            );
            expect(md).toContain(
                '- [12:34](https://www.youtube.com/watch?v=123&t=754s) Key takeaway: Remember this',
            );
            expect(md).not.toContain('—');
            expect(md).toContain('General video thoughts.');
        });

        it('replaces an existing start time and handles empty studies', () => {
            const study: VideoStudy = {
                bookmarks: [{ timeMs: 61_500, label: '', note: '', createdAt: 1 }],
                note: '',
                updatedAt: 1,
            };

            const md = exportStudyMarkdown('', 'https://www.youtube.com/watch?v=abc&t=10s', study);
            expect(md).toContain('# YouTube Video');
            expect(md).toContain('[1:01](https://www.youtube.com/watch?v=abc&t=61s)');
            expect(md).toContain('_(No notes)_');
            expect(exportStudyMarkdown('T', 'not a url', study)).toContain('(not a url?t=61s)');
            expect(exportStudyMarkdown('T', 'x', { ...study, bookmarks: [] })).toContain(
                '_(No bookmarks)_',
            );
        });
    });
});
