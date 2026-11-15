import { describe, expect, it } from '@jest/globals';

import {
    BACKUP_FORMAT,
    type Bookmark,
    createBackup,
    exportLibraryMarkdown,
    exportStudyMarkdown,
    findNoteTimestamps,
    formatTimestamp,
    isEmptyStudy,
    MAX_BOOKMARK_NOTE_LENGTH,
    MAX_BOOKMARKS_PER_VIDEO,
    MAX_LABEL_LENGTH,
    MAX_VIDEO_NOTE_LENGTH,
    mergeStudies,
    normalizeBookmark,
    normalizeVideoStudy,
    noteTimestamp,
    parseBackup,
    STUDY_KEY_PREFIX,
    studyKey,
    type VideoStudy,
    videoIdFromKey,
} from '~data/study';

const bookmark = (seconds: number): Bookmark => ({
    timeMs: seconds * 1000,
    label: '',
    note: '',
    createdAt: seconds,
});

const study = (values: Partial<VideoStudy> = {}): VideoStudy => ({
    bookmarks: [],
    note: '',
    title: '',
    channel: '',
    updatedAt: 1,
    ...values,
});

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
            const rawBookmarks = Array.from({ length: MAX_BOOKMARKS_PER_VIDEO + 50 }, (_, i) => ({
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

    describe('keys, emptiness, and merging', () => {
        it('maps video ids to their own storage keys and back', () => {
            expect(studyKey('aircAruvnKk')).toBe(`${STUDY_KEY_PREFIX}aircAruvnKk`);
            expect(videoIdFromKey(studyKey('aircAruvnKk'))).toBe('aircAruvnKk');
            expect(videoIdFromKey('youtubeSideOptions')).toBeNull();
            expect(videoIdFromKey(`${STUDY_KEY_PREFIX}bad id!`)).toBeNull();
        });

        it('treats a study without bookmarks or text as empty', () => {
            expect(isEmptyStudy(study({ note: ' \n ' }))).toBe(true);
            expect(isEmptyStudy(study({ note: 'x' }))).toBe(false);
            expect(isEmptyStudy(study({ bookmarks: [bookmark(1)] }))).toBe(false);
        });

        it('keeps the title and channel, bounded', () => {
            const result = normalizeVideoStudy({ title: ` ${'t'.repeat(400)} `, channel: 'Chan' });
            expect(result.title).toHaveLength(300);
            expect(result.channel).toBe('Chan');
        });

        it('merges without losing either side, and idempotently', () => {
            const current = study({ note: 'Mine', bookmarks: [bookmark(1)], title: 'Kept' });
            const incoming = study({
                note: 'Theirs',
                bookmarks: [bookmark(1), bookmark(2)],
                title: 'Other',
                channel: 'Chan',
                updatedAt: 99,
            });

            const merged = mergeStudies(current, incoming);
            expect(merged.bookmarks.map((item) => item.timeMs)).toEqual([1000, 2000]);
            expect(merged.note).toBe('Mine\n\nTheirs');
            expect(merged.title).toBe('Kept');
            expect(merged.channel).toBe('Chan');
            expect(merged.updatedAt).toBe(99);

            expect(mergeStudies(merged, incoming).note).toBe('Mine\n\nTheirs');
            expect(mergeStudies(study({ note: '' }), incoming).note).toBe('Theirs');
            expect(mergeStudies(study({ note: 'Mine' }), study({ note: 'Mine, more' })).note).toBe(
                'Mine, more',
            );
        });
    });

    describe('backups', () => {
        it('round-trips a backup and rejects other files', () => {
            const entries = [
                { videoId: 'aircAruvnKk', study: study({ note: 'One', updatedAt: 1 }) },
                { videoId: 'ZK3O402wf1c', study: study({ note: 'Two', updatedAt: 2 }) },
            ];
            const backup = createBackup(entries, new Date('2026-11-15T00:00:00Z'));
            expect(backup.format).toBe(BACKUP_FORMAT);
            expect(backup.exportedAt).toBe('2026-11-15T00:00:00.000Z');
            expect(Object.keys(backup.videos)).toEqual(['ZK3O402wf1c', 'aircAruvnKk']);

            const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
            expect(parsed?.map((entry) => entry.study.note).sort()).toEqual(['One', 'Two']);

            expect(parseBackup({ videos: {} })).toBeNull();
            expect(parseBackup({ format: 'other', videos: {} })).toBeNull();
            expect(parseBackup('nope')).toBeNull();
            expect(
                parseBackup({
                    format: BACKUP_FORMAT,
                    videos: { 'bad id!': { note: 'x' }, emptyVideo1: { note: '' } },
                }),
            ).toEqual([]);
        });
    });

    describe('note timestamps', () => {
        it('finds bracketed and bare timestamps with the rest of their line', () => {
            const found = findNoteTimestamps(
                '[1:23] intro\nat 1:02:03 the proof\nratio 3:4, version 1.2:30, 10:30am, a12:30',
            );
            expect(found.map(({ timeMs, text, context }) => [timeMs, text, context])).toEqual([
                [83_000, '[1:23]', 'intro'],
                [3_723_000, '1:02:03', 'the proof'],
            ]);
            expect(noteTimestamp(83_000)).toBe('[1:23]');
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
                note: 'General video thoughts. [1:05] a callback, and 2:10 bare.',
                title: '',
                channel: '',
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
            expect(md).toContain(
                'General video thoughts. [1:05](https://www.youtube.com/watch?v=123&t=65s) a callback, and 2:10 bare.',
            );
            expect(
                exportStudyMarkdown('T', 'https://www.youtube.com/watch?v=123', {
                    ...study,
                    channel: 'Channel',
                }),
            ).toContain('Channel · https://www.youtube.com/watch?v=123');
        });

        it('exports the whole library newest first', () => {
            const md = exportLibraryMarkdown(
                [
                    {
                        videoId: 'aircAruvnKk',
                        study: study({ note: 'Older', title: 'First', updatedAt: 1 }),
                    },
                    { videoId: 'ZK3O402wf1c', study: study({ note: 'Newer', updatedAt: 2 }) },
                ],
                new Date('2026-11-15T00:00:00Z'),
            );
            expect(md.startsWith('# YouTube Side notes\n\n2 videos, exported 2026-11-15')).toBe(
                true,
            );
            expect(md.indexOf('## ZK3O402wf1c')).toBeLessThan(md.indexOf('## First'));
            expect(md).toContain('### Notes\nNewer');
        });

        it('replaces an existing start time and handles empty studies', () => {
            const study: VideoStudy = {
                bookmarks: [{ timeMs: 61_500, label: '', note: '', createdAt: 1 }],
                note: '',
                title: '',
                channel: '',
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
