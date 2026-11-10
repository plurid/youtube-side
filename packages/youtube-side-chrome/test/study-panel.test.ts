import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { StudyPanel } from '~contentscript/study/studyPanel';
import { createChromeMock } from './chrome';

describe('StudyPanel component', () => {
    let below: HTMLElement;
    let video: HTMLVideoElement;

    beforeEach(() => {
        document.body.innerHTML = '';
        below = document.createElement('div');
        below.id = 'below';
        document.body.append(below);

        video = document.createElement('video');
        Object.defineProperty(video, 'currentTime', {
            writable: true,
            value: 15,
        });
        document.body.append(video);

        createChromeMock();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('mounts shell inside below element and unmounts cleanly', () => {
        const panel = new StudyPanel();
        panel.mount(below, 'vid123');

        const studyNode = document.getElementById('youtube-side-study');
        expect(studyNode).not.toBeNull();
        expect(below.firstElementChild).toBe(studyNode);

        panel.unmount();
        expect(document.getElementById('youtube-side-study')).toBeNull();
    });

    it('cycles views and updates data-youtube-side-view attribute', () => {
        const panel = new StudyPanel();
        panel.mount(below, 'vid123');

        expect(panel.getView()).toBe('side');
        expect(below.hasAttribute('data-youtube-side-view')).toBe(false);

        panel.cycleView();
        expect(panel.getView()).toBe('transcript');
        expect(below.getAttribute('data-youtube-side-view')).toBe('transcript');

        panel.cycleView();
        expect(panel.getView()).toBe('chapters');
        expect(below.getAttribute('data-youtube-side-view')).toBe('chapters');

        panel.cycleView();
        expect(panel.getView()).toBe('notes');
        expect(below.getAttribute('data-youtube-side-view')).toBe('notes');

        panel.cycleView();
        expect(panel.getView()).toBe('side');
        expect(below.hasAttribute('data-youtube-side-view')).toBe(false);
    });

    it('handles tab switching via button clicks', async () => {
        const panel = new StudyPanel();
        panel.mount(below, 'vid123');

        const tabs = document.querySelectorAll('.youtube-side-tab');
        expect(tabs).toHaveLength(4);

        // Click Transcript tab
        (tabs[1] as HTMLButtonElement).click();
        await new Promise((r) => setTimeout(r, 10));

        expect(panel.getView()).toBe('transcript');
        expect(
            document.querySelectorAll('.youtube-side-tab')[1]?.getAttribute('aria-selected'),
        ).toBe('true');
    });

    it('renders empty transcript state when no transcript is found', async () => {
        const panel = new StudyPanel();
        panel.mount(below, 'vid_empty');
        panel.setView('transcript');
        await new Promise((r) => setTimeout(r, 20));

        const content = document.getElementById('youtube-side-study-content');
        expect(content?.textContent).toContain('No transcript available for this video.');
    });

    it('renders chapters and seeks video on click', async () => {
        const desc = document.createElement('div');
        desc.id = 'description';
        desc.textContent = '0:00 Intro\n1:00 Deep Dive\n2:30 Conclusion';
        document.body.append(desc);

        const panel = new StudyPanel();
        panel.mount(below, 'vid_chapters');

        panel.setView('chapters');
        await panel.handleVideoChange('vid_chapters');

        const chapterRows = document.querySelectorAll('#youtube-side-chapters-list > div');
        expect(chapterRows).toHaveLength(3);

        (chapterRows[1] as HTMLElement).click();
        expect(video.currentTime).toBe(60); // 1:00 = 60s

        // Test updateTime highlighting
        panel.updateTime(65_000); // 65s
        expect(chapterRows[1]?.getAttribute('data-current')).toBe('true');
    });

    it('renders notes, captures bookmarks, edits inline, and exports', async () => {
        const anchorClickSpy = jest
            .spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation(() => {});

        Object.assign(navigator, {
            clipboard: {
                writeText: jest.fn().mockResolvedValue(undefined as never),
            },
        });

        window.URL.createObjectURL = jest.fn(
            () => 'blob:mock-url',
        ) as unknown as typeof window.URL.createObjectURL;
        window.URL.revokeObjectURL = jest.fn() as unknown as typeof window.URL.revokeObjectURL;

        const panel = new StudyPanel();
        panel.mount(below, 'vid_notes');

        // Capture bookmark
        video.currentTime = 30; // 30s
        const bookmarkBtn = document.querySelector(
            '.youtube-side-study-actions button:last-child',
        ) as HTMLButtonElement;
        bookmarkBtn.click();
        await new Promise((r) => setTimeout(r, 20));

        panel.setView('notes');
        await new Promise((r) => setTimeout(r, 20));

        const content = document.getElementById('youtube-side-study-content');
        expect(content?.textContent).toContain('Bookmarks (1)');

        // Edit label
        const labelInput = content?.querySelector('input[type="text"]') as HTMLInputElement;
        expect(labelInput).not.toBeNull();
        labelInput.value = 'Important Part';
        labelInput.dispatchEvent(new Event('change'));

        // Edit note textarea
        const textarea = content?.querySelector('textarea') as HTMLTextAreaElement;
        expect(textarea).not.toBeNull();
        textarea.value = 'My long video notes';
        textarea.dispatchEvent(new Event('input'));
        await new Promise((r) => setTimeout(r, 550));

        // Copy markdown
        const copyBtn = Array.from(content?.querySelectorAll('button') || []).find((b) =>
            b.textContent?.includes('Copy as Markdown'),
        );
        copyBtn?.click();
        await new Promise((r) => setTimeout(r, 10));
        expect(navigator.clipboard.writeText).toHaveBeenCalled();

        // Download markdown
        const downloadBtn = Array.from(content?.querySelectorAll('button') || []).find((b) =>
            b.textContent?.includes('Download .md'),
        );
        downloadBtn?.click();
        expect(window.URL.createObjectURL).toHaveBeenCalled();
        expect(anchorClickSpy).toHaveBeenCalled();
        anchorClickSpy.mockRestore();
    });

    it('handles transcript search, seeking, follow toggle, and scroll pausing', async () => {
        // Setup transcript in cache/DOM
        const script = document.createElement('script');
        script.textContent = `
            var ytInitialPlayerResponse = {
                "captions": {
                    "playerCaptionsTracklistRenderer": {
                        "captionTracks": [{"baseUrl": "https://example.com/sub", "languageCode": "en"}]
                    }
                }
            };
        `;
        document.body.append(script);

        global.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                events: [
                    { tStartMs: 0, dDurationMs: 5000, segs: [{ utf8: 'First segment' }] },
                    { tStartMs: 6000, dDurationMs: 4000, segs: [{ utf8: 'Second segment match' }] },
                ],
            }),
        })) as unknown as typeof fetch;

        const panel = new StudyPanel();
        panel.mount(below, 'vid_search');
        panel.setView('transcript');
        await new Promise((r) => setTimeout(r, 20));
        await panel.handleVideoChange('vid_search');
        await new Promise((r) => setTimeout(r, 20));

        const rows = document.querySelectorAll('.youtube-side-transcript-row');
        expect(rows).toHaveLength(2);

        // Click row to seek
        (rows[1] as HTMLElement).click();
        expect(video.currentTime).toBe(6);

        // Filter via search input
        const searchInput = document.querySelector(
            'input[placeholder*="Search"]',
        ) as HTMLInputElement;
        searchInput.value = 'match';
        searchInput.dispatchEvent(new Event('input'));

        const filteredRows = document.querySelectorAll('.youtube-side-transcript-row');
        expect(filteredRows).toHaveLength(1);
        expect(filteredRows[0]?.querySelector('mark')?.textContent).toBe('match');

        // Test updateTime
        panel.updateTime(6500);

        // Test scroll pause on wheel
        const listContainer = document.getElementById('youtube-side-transcript-list');
        listContainer?.dispatchEvent(new Event('wheel'));

        // Toggle follow button
        const followBtn = document.querySelector(
            '.youtube-side-study-actions button:first-child',
        ) as HTMLButtonElement;
        expect(followBtn.textContent).toBe('Follow: On');
        followBtn.click();
        expect(followBtn.textContent).toBe('Follow: Off');
    });

    it('renders empty notes and handles bookmark deletion', async () => {
        const panel = new StudyPanel();
        panel.mount(below, 'vid_empty_notes');
        panel.setView('notes');
        await new Promise((r) => setTimeout(r, 20));

        const content = document.getElementById('youtube-side-study-content');
        expect(content?.textContent).toContain('No bookmarks yet');

        // Capture a bookmark and delete it
        video.currentTime = 10;
        const bookmarkBtn = document.querySelector(
            '.youtube-side-study-actions button:last-child',
        ) as HTMLButtonElement;
        bookmarkBtn.click();
        await new Promise((r) => setTimeout(r, 30));

        const delBtn = Array.from(content?.querySelectorAll('button') || []).find(
            (b) => b.textContent === '×',
        );
        delBtn?.click();
        await new Promise((r) => setTimeout(r, 30));

        expect(content?.textContent).toContain('Bookmarks (0)');
    });

    it('handles null videoId gracefully', async () => {
        const panel = new StudyPanel();
        panel.mount(below, null);
        await panel.handleVideoChange(null);
        panel.setView('notes');
        expect(panel.getView()).toBe('notes');
    });

    it('captures bookmarks with chapter titles and handles missing video element', async () => {
        const desc = document.createElement('div');
        desc.id = 'description';
        desc.textContent = '0:00 Chapter 1\n1:00 Chapter 2';
        document.body.append(desc);

        const panel = new StudyPanel();
        panel.mount(below, 'vid_ch_bm');
        panel.setView('chapters');
        await panel.handleVideoChange('vid_ch_bm');

        video.currentTime = 65; // 65s -> should match Chapter 2
        const bookmarkBtn = document.querySelector(
            '.youtube-side-study-actions button:last-child',
        ) as HTMLButtonElement;
        bookmarkBtn.click();
        await new Promise((r) => setTimeout(r, 20));

        // Test capturing when video element is missing
        video.remove();
        bookmarkBtn.click();
        await new Promise((r) => setTimeout(r, 20));

        // Test updateTime when view is side
        panel.setView('side');
        panel.updateTime(1000);
    });
});
