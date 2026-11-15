import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { BACKUP_FORMAT, BACKUP_VERSION, studyKey } from '~data/study';
import Library, { filterEntries } from '../source/library/Library';
import { type ChromeMock, createChromeMock } from './chrome';

const readBlob = (blob: Blob | undefined) =>
    new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve(String(reader.result));
        };
        reader.readAsText(blob ?? new Blob());
    });

const record = (values: Record<string, unknown>) => ({
    version: 2,
    bookmarks: [],
    note: '',
    ...values,
});

const seed = () => ({
    [studyKey('olderVideo1')]: record({
        title: 'Linear algebra',
        channel: '3Blue1Brown',
        note: 'Eigenvectors at [4:05] are the key',
        bookmarks: [{ timeMs: 65_000, label: 'Span', note: 'basis vectors', createdAt: 1 }],
        updatedAt: Date.UTC(2026, 10, 1),
    }),
    [studyKey('newerVideo1')]: record({
        title: 'Café chemistry',
        note: 'Crème brûlée science',
        updatedAt: Date.UTC(2026, 10, 10),
    }),
    youtubeSideOptions: { version: 3, values: {} },
});

describe('notes library', () => {
    let mock: ChromeMock;
    let downloads: { name: string; blob: Blob }[];

    beforeEach(() => {
        mock = createChromeMock(seed());
        downloads = [];
        Object.assign(URL, {
            createObjectURL: jest.fn((blob: Blob) => {
                downloads.push({ name: '', blob });
                return `blob:${downloads.length}`;
            }),
            revokeObjectURL: jest.fn(),
        });
        jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
            this: HTMLAnchorElement,
        ) {
            const last = downloads.at(-1);
            if (last) {
                last.name = this.download;
            }
        });
    });

    const cards = () => screen.getAllByRole('listitem').filter((item) => item.querySelector('h2'));

    test('lists every video newest first, with its channel and bookmark count', async () => {
        render(<Library />);

        expect(await screen.findByText('Café chemistry')).toBeInTheDocument();
        expect(screen.getByText(/2 videos · 1 bookmark, kept in this browser/)).toBeInTheDocument();
        expect(cards().map((card) => card.querySelector('h2')?.textContent)).toEqual([
            'Café chemistry',
            'Linear algebra',
        ]);
        expect(screen.getByText(/3Blue1Brown · 1 bookmark · updated/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Linear algebra' })).toHaveAttribute(
            'href',
            'https://www.youtube.com/watch?v=olderVideo1',
        );
        // timestamps in a note link to that moment
        expect(screen.getByRole('link', { name: '[4:05]' })).toHaveAttribute(
            'href',
            'https://www.youtube.com/watch?v=olderVideo1&t=245s',
        );
    });

    test('searches titles, notes, and bookmarks, ignoring case and accents', async () => {
        render(<Library />);
        const search = await screen.findByRole('searchbox', { name: 'Search notes' });

        fireEvent.change(search, { target: { value: 'CREME brulee' } });
        expect(cards()).toHaveLength(1);
        expect(screen.getByText('Café chemistry')).toBeInTheDocument();

        fireEvent.change(search, { target: { value: 'basis' } });
        expect(cards().map((card) => card.querySelector('h2')?.textContent)).toEqual([
            'Linear algebra',
        ]);

        fireEvent.change(search, { target: { value: 'nothing like this' } });
        expect(screen.getByText('No notes match “nothing like this”.')).toBeInTheDocument();

        expect(filterEntries([], 'x')).toEqual([]);
    });

    test('shows bookmarks on demand and deletes only after a second click', async () => {
        render(<Library />);
        await screen.findByText('Linear algebra');
        const card = cards()[1] as HTMLElement;

        fireEvent.click(within(card).getByRole('button', { name: 'Show all' }));
        expect(within(card).getByRole('link', { name: '1:05' })).toHaveAttribute(
            'href',
            'https://www.youtube.com/watch?v=olderVideo1&t=65s',
        );
        expect(within(card).getByText('Span: basis vectors')).toBeInTheDocument();

        fireEvent.click(within(card).getByRole('button', { name: 'Delete' }));
        expect(mock.data[studyKey('olderVideo1')]).toBeDefined();
        fireEvent.click(within(card).getByRole('button', { name: 'Delete these notes?' }));

        await waitFor(() => {
            expect(cards()).toHaveLength(1);
        });
        expect(mock.data[studyKey('olderVideo1')]).toBeUndefined();
        expect(mock.data.youtubeSideOptions).toBeDefined();
    });

    test('exports Markdown and backs up, then restores a backup by merging', async () => {
        render(<Library />);
        await screen.findByText('Linear algebra');

        fireEvent.click(screen.getByRole('button', { name: 'Export Markdown' }));
        const markdown = await readBlob(downloads[0]?.blob);
        expect(downloads[0]?.name).toMatch(/^youtube-side-notes-\d{4}-\d{2}-\d{2}\.md$/);
        expect(markdown).toContain('# YouTube Side notes');
        expect(markdown).toContain('[4:05](https://www.youtube.com/watch?v=olderVideo1&t=245s)');

        fireEvent.click(screen.getByRole('button', { name: 'Back up' }));
        const backup = JSON.parse(await readBlob(downloads[1]?.blob));
        expect(downloads[1]?.name).toMatch(/^youtube-side-backup-.*\.json$/);
        expect(Object.keys(backup.videos)).toEqual(['newerVideo1', 'olderVideo1']);

        const restoreFile = (contents: string) => {
            const file = new File([contents], 'backup.json', { type: 'application/json' });
            Object.defineProperty(file, 'text', { value: async () => contents });
            fireEvent.change(screen.getByLabelText('Restore a backup file'), {
                target: { files: [file] },
            });
        };

        restoreFile('{"not":"a backup"}');
        expect(
            await screen.findByText('That file is not a YouTube Side backup.'),
        ).toBeInTheDocument();

        restoreFile(
            JSON.stringify({
                format: BACKUP_FORMAT,
                version: BACKUP_VERSION,
                videos: {
                    olderVideo1: { note: 'Restored thought', bookmarks: [], updatedAt: 1 },
                    brandNewId1: {
                        note: 'From another browser',
                        title: 'Imported',
                        bookmarks: [],
                        updatedAt: 1,
                    },
                },
            }),
        );
        expect(
            await screen.findByText(/Restored 2 videos, merged with the notes already here./),
        ).toBeInTheDocument();
        expect(await screen.findByText('Imported')).toBeInTheDocument();
        expect((mock.data[studyKey('olderVideo1')] as { note: string }).note).toBe(
            'Eigenvectors at [4:05] are the key\n\nRestored thought',
        );
    });

    test('shows notes another tab saves, and an empty state when there are none', async () => {
        createChromeMock();
        const { unmount } = render(<Library />);
        expect(await screen.findByText(/No notes yet/)).toBeInTheDocument();

        await act(async () => {
            await chrome.storage.local.set({
                [studyKey('freshVideo1')]: record({
                    note: 'Just now',
                    title: 'Fresh',
                    updatedAt: 5,
                }),
            });
            await new Promise((resolve) => {
                setTimeout(resolve, 200);
            });
        });
        expect(screen.getByText('Fresh')).toBeInTheDocument();
        unmount();
    });
});
