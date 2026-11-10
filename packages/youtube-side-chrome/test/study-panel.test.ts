import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { StudyPanel } from '~contentscript/study/studyPanel';
import { clearTranscriptCache } from '~contentscript/study/transcript';
import { STUDY_STORAGE_KEY, type StudyData } from '~data/study';
import { type ChromeMock, createChromeMock } from './chrome';

const wait = (ms = 20) =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });

const timedtextScript = (videoId: string) =>
    `var ytInitialPlayerResponse = ${JSON.stringify({
        captions: {
            playerCaptionsTracklistRenderer: {
                captionTracks: [
                    {
                        baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}`,
                        languageCode: 'en',
                    },
                ],
            },
        },
        videoDetails: { videoId },
    })};`;

const json3 = (lines: [number, string][]) =>
    ({
        ok: true,
        text: async () =>
            JSON.stringify({
                events: lines.map(([tStartMs, utf8]) => ({ tStartMs, segs: [{ utf8 }] })),
            }),
    }) as Response;

const query = <T extends Element = HTMLElement>(selector: string) =>
    document.querySelector(selector) as T;
const content = () => query('#youtube-side-study-content');
const followButton = () =>
    query<HTMLButtonElement>('.youtube-side-study-actions button:first-child');
const bookmarkButton = () =>
    query<HTMLButtonElement>('.youtube-side-study-actions button:last-child');
const buttonNamed = (text: string) =>
    Array.from(document.querySelectorAll('button')).find((button) =>
        button.textContent?.includes(text),
    ) as HTMLButtonElement;
const storedStudy = (mock: ChromeMock) => mock.data[STUDY_STORAGE_KEY] as StudyData | undefined;

describe('StudyPanel', () => {
    let below: HTMLElement;
    let video: HTMLVideoElement;
    let mock: ChromeMock;
    let fetchMock: jest.Mock<typeof fetch>;

    beforeEach(() => {
        clearTranscriptCache();
        document.body.innerHTML = '';
        below = document.createElement('div');
        below.id = 'below';
        below.append(document.createElement('ytd-watch-metadata'));
        document.body.append(below);

        video = document.createElement('video');
        Object.defineProperty(video, 'currentTime', { writable: true, value: 15 });
        document.body.append(video);

        mock = createChromeMock();
        fetchMock = jest.fn<typeof fetch>();
        global.fetch = fetchMock;
    });

    afterEach(() => {
        jest.useRealTimers();
        document.body.innerHTML = '';
    });

    it('mounts as the first child and removes everything it added on unmount', () => {
        const panel = new StudyPanel();
        panel.mount(below, 'vid123');
        expect(below.firstElementChild?.id).toBe('youtube-side-study');

        panel.setView('notes');
        expect(below.getAttribute('data-youtube-side-view')).toBe('notes');

        // a stale view attribute would keep hiding YouTube's own panel content
        panel.unmount();
        expect(document.getElementById('youtube-side-study')).toBeNull();
        expect(below.hasAttribute('data-youtube-side-view')).toBe(false);

        // the chosen view comes back on the next mount
        panel.mount(below, 'vid123');
        expect(below.getAttribute('data-youtube-side-view')).toBe('notes');
        panel.destroy();
    });

    it('keeps its DOM, focus, and typed text across repeated layout passes', async () => {
        fetchMock.mockResolvedValue(
            json3([
                [0, 'Alpha'],
                [5000, 'Beta'],
            ]),
        );
        const script = document.createElement('script');
        script.textContent = timedtextScript('vidStable1');
        document.body.append(script);

        const panel = new StudyPanel();
        panel.mount(below, 'vidStable1');
        panel.setView('transcript');
        await wait();

        const search = query<HTMLInputElement>('input[type="search"]');
        search.focus();
        search.value = 'alp';

        for (let pass = 0; pass < 3; pass += 1) {
            panel.mount(below, 'vidStable1');
        }

        expect(query('input[type="search"]')).toBe(search);
        expect(document.activeElement).toBe(search);
        expect(search.value).toBe('alp');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rebuilds when YouTube replaces the panel element', () => {
        const panel = new StudyPanel();
        panel.mount(below, 'vid123');
        panel.setView('chapters');

        const replacement = document.createElement('div');
        document.body.append(replacement);
        panel.mount(replacement, 'vid123');

        expect(below.hasAttribute('data-youtube-side-view')).toBe(false);
        expect(replacement.firstElementChild?.id).toBe('youtube-side-study');
        expect(replacement.getAttribute('data-youtube-side-view')).toBe('chapters');
    });

    it('cycles views and supports tab clicks and arrow keys', () => {
        const panel = new StudyPanel();
        panel.mount(below, 'vid123');

        const order: string[] = [];
        for (let step = 0; step < 4; step += 1) {
            panel.cycleView();
            order.push(below.getAttribute('data-youtube-side-view') ?? 'side');
        }
        expect(order).toEqual(['transcript', 'chapters', 'notes', 'side']);

        const tabs = document.querySelectorAll<HTMLButtonElement>('.youtube-side-tab');
        expect(tabs).toHaveLength(4);
        tabs[2]?.click();
        expect(panel.getView()).toBe('chapters');
        expect(tabs[2]?.getAttribute('aria-selected')).toBe('true');
        expect(tabs[2]?.tabIndex).toBe(0);
        expect(tabs[0]?.tabIndex).toBe(-1);

        const tablist = query('[role="tablist"]');
        const press = (key: string, altKey = false) => {
            const event = new KeyboardEvent('keydown', {
                key,
                altKey,
                bubbles: true,
                cancelable: true,
            });
            tablist.dispatchEvent(event);
            return event;
        };

        expect(press('ArrowRight').defaultPrevented).toBe(true);
        expect(panel.getView()).toBe('notes');
        expect(document.activeElement).toBe(tabs[3]);
        press('ArrowRight');
        expect(panel.getView()).toBe('side');
        press('ArrowLeft');
        expect(panel.getView()).toBe('notes');
        press('Home');
        expect(panel.getView()).toBe('side');
        press('End');
        expect(panel.getView()).toBe('notes');
        expect(press('a').defaultPrevented).toBe(false);
        expect(press('ArrowRight', true).defaultPrevented).toBe(false);
    });

    it('keeps keys a focused button needs away from YouTube’s page shortcuts', () => {
        const panel = new StudyPanel();
        panel.mount(below, 'vidKeys001');

        const reachedPage: string[] = [];
        const record = (event: KeyboardEvent) => {
            reachedPage.push(`${event.type}:${event.altKey ? 'Alt+' : ''}${event.key}`);
        };
        document.addEventListener('keydown', record);
        document.addEventListener('keyup', record);

        const press = (target: Element, key: string, altKey = false) => {
            for (const type of ['keydown', 'keyup']) {
                target.dispatchEvent(new KeyboardEvent(type, { key, altKey, bubbles: true }));
            }
        };

        const bookmark = bookmarkButton();
        press(bookmark, ' ');
        press(bookmark, 'Enter');
        press(bookmark, 'End');
        press(bookmark, 'k');
        press(bookmark, 't', true);
        press(query('#youtube-side-study-header'), ' ');

        expect(reachedPage).toEqual([
            'keydown:k',
            'keyup:k',
            'keydown:Alt+t',
            'keyup:Alt+t',
            'keydown: ',
            'keyup: ',
        ]);

        document.removeEventListener('keydown', record);
        document.removeEventListener('keyup', record);
    });

    it('renders the empty transcript state when nothing provides one', async () => {
        const panel = new StudyPanel();
        panel.mount(below, 'vid_empty');
        panel.setView('transcript');
        await wait();

        expect(content().textContent).toContain('No transcript available for this video.');
    });

    it('loads the transcript through YouTube’s panel and offers a retry when it fails', async () => {
        jest.useFakeTimers();
        document.body.insertAdjacentHTML(
            'afterbegin',
            `<ytd-watch-flexy video-id="panelVid01"></ytd-watch-flexy>
             <ytd-video-description-transcript-section-renderer><button>Show transcript</button></ytd-video-description-transcript-section-renderer>
             <div id="panels"></div>`,
        );
        let opens = 0;
        query('ytd-video-description-transcript-section-renderer button').addEventListener(
            'click',
            () => {
                opens += 1;
                // the first attempt renders nothing; the retry renders the panel
                if (opens === 2) {
                    query('#panels').innerHTML = `
                        <ytd-engagement-panel-section-list-renderer target-id="PAmodern_transcript_view" visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED">
                            <transcript-segment-view-model>
                                <div class="ytwTranscriptSegmentViewModelTimestamp">0:00</div>
                                <span class="ytAttributedStringHost">Hi.</span>
                            </transcript-segment-view-model>
                        </ytd-engagement-panel-section-list-renderer>`;
                }
            },
        );

        const panel = new StudyPanel();
        panel.mount(below, 'panelVid01');
        panel.setView('transcript');
        expect(content().textContent).toContain('Loading transcript');

        await jest.advanceTimersByTimeAsync(11_000);
        expect(content().textContent).toContain("Couldn't load the transcript from YouTube.");

        buttonNamed('Try again').click();
        await jest.advanceTimersByTimeAsync(1_000);
        expect(document.querySelectorAll('.youtube-side-transcript-row')).toHaveLength(1);
        expect(opens).toBe(2);
    });

    it('discards a transcript that arrives after the video changed', async () => {
        let resolveFetch: (response: Response) => void = () => undefined;
        fetchMock.mockImplementation(
            () =>
                new Promise<Response>((resolve) => {
                    resolveFetch = resolve;
                }),
        );
        const script = document.createElement('script');
        script.textContent = timedtextScript('firstVid01');
        document.body.append(script);

        const panel = new StudyPanel();
        panel.mount(below, 'firstVid01');
        panel.setView('transcript');
        await wait();

        const change = panel.handleVideoChange('secondVid1');
        resolveFetch(json3([[0, 'Belongs to the first video']]));
        await change;
        await wait();

        expect(content().textContent).not.toContain('Belongs to the first video');
        expect(content().textContent).toContain('No transcript available');
    });

    it('searches, seeks, and pauses following only for manual scrolling', async () => {
        jest.useFakeTimers();
        fetchMock.mockResolvedValue(
            json3([
                [0, 'First segment'],
                [6000, 'Second segment match'],
                [9000, 'Third MATCH here'],
            ]),
        );
        const script = document.createElement('script');
        script.textContent = timedtextScript('vidSearch1');
        document.body.append(script);

        const panel = new StudyPanel({ follow: false });
        panel.mount(below, 'vidSearch1');
        panel.setView('transcript');
        await jest.advanceTimersByTimeAsync(10);

        const rows = () => document.querySelectorAll<HTMLElement>('.youtube-side-transcript-row');
        expect(rows()).toHaveLength(3);
        expect(followButton().textContent).toBe('Follow: Off');

        rows()[1]?.click();
        expect(video.currentTime).toBe(6);
        expect(rows()[1]?.getAttribute('aria-current')).toBe('true');

        const search = query<HTMLInputElement>('input[type="search"]');
        search.value = 'match';
        search.dispatchEvent(new Event('input'));
        expect(rows()).toHaveLength(3);
        await jest.advanceTimersByTimeAsync(200);
        expect(rows()).toHaveLength(2);
        expect(rows()[1]?.querySelector('mark')?.textContent).toBe('MATCH');
        expect(content().textContent).toContain('2 matches');

        search.value = 'third';
        search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(video.currentTime).toBe(9);

        search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(search.value).toBe('');
        expect(rows()).toHaveLength(3);

        panel.setFollowDefault(true);
        expect(followButton().textContent).toBe('Follow: On');
        const resume = buttonNamed('Resume follow');
        expect(resume.hidden).toBe(true);

        const list = query('#youtube-side-transcript-list');
        list.dispatchEvent(new Event('wheel'));
        expect(resume.hidden).toBe(false);

        resume.click();
        expect(resume.hidden).toBe(true);
        list.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }));
        expect(resume.hidden).toBe(false);

        // a row click is an explicit request, so following resumes
        rows()[0]?.click();
        expect(resume.hidden).toBe(true);

        followButton().click();
        expect(followButton().textContent).toBe('Follow: Off');
        list.dispatchEvent(new Event('wheel'));
        expect(resume.hidden).toBe(true);
    });

    it('waits for the page before reading chapters, then seeks and highlights them', async () => {
        document.body.insertAdjacentHTML(
            'afterbegin',
            '<ytd-watch-flexy video-id="previous01"></ytd-watch-flexy><div id="description">0:00 Intro\n1:00 Deep Dive\n2:30 Conclusion</div>',
        );

        const panel = new StudyPanel();
        panel.mount(below, 'vidChapter');
        panel.setView('chapters');
        expect(content().textContent).toContain('Loading chapters');

        query('ytd-watch-flexy').setAttribute('video-id', 'vidChapter');
        panel.handlePageDataReady();

        const rows = document.querySelectorAll<HTMLElement>('.youtube-side-chapter-row');
        expect(rows).toHaveLength(3);
        rows[1]?.click();
        expect(video.currentTime).toBe(60);
        expect(rows[1]?.getAttribute('aria-current')).toBe('true');

        panel.updateTime(155_000);
        expect(rows[2]?.getAttribute('aria-current')).toBe('true');
        expect(rows[1]?.hasAttribute('aria-current')).toBe(false);
    });

    it('points to the transcript when a video has no chapters', () => {
        const panel = new StudyPanel();
        panel.mount(below, 'vidNoChap1');
        panel.setView('chapters');

        expect(content().textContent).toContain('No chapters available for this video.');
        buttonNamed('Open transcript').click();
        expect(panel.getView()).toBe('transcript');
    });

    it('captures, edits, and deletes bookmarks by id', async () => {
        document.body.insertAdjacentHTML(
            'afterbegin',
            '<div id="description">0:00 Chapter 1\n1:00 Chapter 2</div>',
        );
        const panel = new StudyPanel();
        panel.mount(below, 'vidNotes01');

        video.currentTime = 65;
        bookmarkButton().click();
        await wait();
        video.currentTime = 5;
        bookmarkButton().click();
        await wait();

        panel.setView('notes');
        await wait();
        expect(content().textContent).toContain('Bookmarks (2)');

        const labels = () =>
            document.querySelectorAll<HTMLInputElement>('input[aria-label="Bookmark label"]');
        expect([...labels()].map((input) => input.value)).toEqual(['Chapter 1', 'Chapter 2']);

        const second = labels()[1] as HTMLInputElement;
        second.value = 'Renamed';
        second.dispatchEvent(new Event('change'));
        const note = document.querySelectorAll<HTMLInputElement>(
            'input[aria-label="Bookmark note"]',
        )[1];
        if (note) {
            note.value = 'Worth rewatching';
            note.dispatchEvent(new Event('change'));
        }
        await wait();

        const bookmarks = storedStudy(mock)?.videos.vidNotes01?.bookmarks ?? [];
        expect(
            bookmarks.map((bookmark) => [bookmark.timeMs, bookmark.label, bookmark.note]),
        ).toEqual([
            [5000, 'Chapter 1', ''],
            [65000, 'Renamed', 'Worth rewatching'],
        ]);

        query<HTMLButtonElement>('button[aria-label="Delete bookmark at 0:05"]').click();
        await wait();
        expect(content().textContent).toContain('Bookmarks (1)');
        expect(storedStudy(mock)?.videos.vidNotes01?.bookmarks[0]?.label).toBe('Renamed');

        buttonNamed('1:05').click();
        expect(video.currentTime).toBe(65);
    });

    it('saves a note to the video it was typed on, even after navigating away', async () => {
        const panel = new StudyPanel();
        panel.mount(below, 'vidTyped01');
        panel.setView('notes');
        await wait();

        const textarea = query<HTMLTextAreaElement>('textarea');
        textarea.value = 'Typed on the first video';
        textarea.dispatchEvent(new Event('input'));

        await panel.handleVideoChange('vidOther01');
        await wait(600);

        expect(storedStudy(mock)?.videos.vidTyped01?.note).toBe('Typed on the first video');
        expect(storedStudy(mock)?.videos.vidOther01).toBeUndefined();
        expect(query<HTMLTextAreaElement>('textarea').value).toBe('');
    });

    it('exports the latest notes, with a clipboard fallback and a delayed revoke', async () => {
        const writeText = jest
            .fn<(text: string) => Promise<void>>()
            .mockRejectedValue(new Error('denied'));
        Object.assign(navigator, { clipboard: { writeText } });
        const execCommand = jest.fn((_command: string) => true);
        Object.assign(document, { execCommand });
        const anchorClick = jest
            .spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation(() => {});
        const createObjectURL = jest.fn(() => 'blob:mock');
        const revokeObjectURL = jest.fn();
        Object.assign(URL, { createObjectURL, revokeObjectURL });

        document.body.insertAdjacentHTML(
            'afterbegin',
            '<ytd-watch-metadata><h1> Linear Algebra </h1></ytd-watch-metadata>',
        );
        const panel = new StudyPanel();
        panel.mount(below, 'vidExport1');
        panel.setView('notes');
        await wait();

        const textarea = query<HTMLTextAreaElement>('textarea');
        textarea.value = 'Not yet saved';
        textarea.dispatchEvent(new Event('input'));

        // export right away: the debounced note must still be included
        const copy = buttonNamed('Copy as Markdown');
        copy.click();
        await wait();

        expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Not yet saved'));
        expect(writeText.mock.calls[0]?.[0]).toContain(
            '# Linear Algebra\n\nhttps://www.youtube.com/watch?v=vidExport1',
        );
        expect(execCommand).toHaveBeenCalledWith('copy');
        expect(copy.textContent).toBe('Copied!');

        execCommand.mockReturnValue(false);
        copy.click();
        await wait();
        expect(copy.textContent).toBe('Copy failed');

        jest.useFakeTimers();
        buttonNamed('Download .md').click();
        await jest.advanceTimersByTimeAsync(10);
        expect(createObjectURL).toHaveBeenCalled();
        expect(anchorClick).toHaveBeenCalled();
        expect(revokeObjectURL).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(10_000);
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
        anchorClick.mockRestore();
    });

    it('shows a notice when storage rejects a write and clears it after a success', async () => {
        const panel = new StudyPanel();
        panel.mount(below, 'vidFull001');

        mock.setMock.mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));
        bookmarkButton().click();
        await wait();

        const notice = query('.youtube-side-notice');
        expect(notice.hidden).toBe(false);
        expect(notice.textContent).toContain("Couldn't save");

        bookmarkButton().click();
        await wait();
        expect(notice.hidden).toBe(true);
    });

    it('does not seek or bookmark while an ad plays', async () => {
        document.body.insertAdjacentHTML(
            'afterbegin',
            '<div id="movie_player" class="ad-showing"></div><div id="description">0:00 A\n1:00 B</div>',
        );
        query('#movie_player').append(video);

        const panel = new StudyPanel();
        panel.mount(below, 'vidAdShow1');
        panel.setView('chapters');
        document.querySelectorAll<HTMLElement>('.youtube-side-chapter-row')[1]?.click();
        expect(video.currentTime).toBe(15);

        bookmarkButton().click();
        await wait();
        expect(storedStudy(mock)).toBeUndefined();
        expect(query('[role="status"]').textContent).toContain('ad');
    });

    it('handles a missing video id or video element gracefully', async () => {
        const panel = new StudyPanel();
        panel.mount(below, null);
        for (const view of ['transcript', 'chapters', 'notes'] as const) {
            panel.setView(view);
            await wait();
            expect(content().textContent).toContain('Open a video');
        }

        await panel.handleVideoChange('vidNoVideo');
        video.remove();
        bookmarkButton().click();
        await wait();
        expect(storedStudy(mock)).toBeUndefined();
        panel.render();
        panel.updateTime(1000);
    });

    it('routes a transcript the user opened in YouTube into the Transcript view', async () => {
        jest.useFakeTimers();
        document.body.insertAdjacentHTML(
            'afterbegin',
            `<ytd-engagement-panel-section-list-renderer target-id="PAmodern_transcript_view" visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED">
                <div id="visibility-button"><button aria-label="Close"></button></div>
                <transcript-segment-view-model>
                    <div class="ytwTranscriptSegmentViewModelTimestamp">0:03</div>
                    <span class="ytAttributedStringHost">Opened by the user</span>
                </transcript-segment-view-model>
            </ytd-engagement-panel-section-list-renderer>`,
        );
        const close = jest.fn();
        query('#visibility-button button').addEventListener('click', close);

        const panel = new StudyPanel();
        panel.mount(below, 'vidUserOp1');
        panel.showYouTubeTranscript();
        expect(panel.getView()).toBe('transcript');

        await jest.advanceTimersByTimeAsync(1_000);
        expect(content().textContent).toContain('Opened by the user');
        // the user opened YouTube's panel, so it stays open
        expect(close).not.toHaveBeenCalled();

        panel.showYouTubeTranscript();
        expect(content().textContent).toContain('Opened by the user');
    });
});
