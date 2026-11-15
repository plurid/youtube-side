import type { WatchLayout } from '~data/context';
import {
    exportStudyMarkdown,
    findNoteTimestamps,
    formatTimestamp,
    MAX_BOOKMARK_NOTE_LENGTH,
    MAX_LABEL_LENGTH,
    MAX_VIDEO_NOTE_LENGTH,
    noteTimestamp,
    type VideoMeta,
} from '~data/study';
import {
    addBookmark,
    appendToNote,
    BookmarkLimitError,
    type BookmarkUpdate,
    loadVideoStudy,
    NoteLimitError,
    removeBookmark,
    setVideoNote,
    subscribeVideoStudy,
    updateBookmark,
    whenStudyWritesSettled,
} from '~data/studyStore';
import {
    canonicalVideoUrl,
    getMainVideo,
    isAdShowing,
    isPageDataCurrent,
    readChannelName,
    readVideoTitle,
} from '../page';
import { STUDY_CONTENT_ID, STUDY_ID, VIEW_ATTRIBUTE } from '../styles';
import { type Chapter, extractChaptersFromDOM } from './chapters';
import {
    fetchTranscript,
    filterTranscriptSegments,
    findCurrentSegmentIndex,
    findTranscriptButton,
    loadTranscriptFromPanel,
    MAX_TRANSCRIPT_SEGMENTS,
    type SearchResult,
    type Transcript,
} from './transcript';

export type StudyView = 'side' | 'transcript' | 'chapters' | 'notes';
type LoadStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'failed';

export interface StudyPanelOptions {
    follow?: boolean;
}

const VIEW_ORDER: readonly StudyView[] = ['side', 'transcript', 'chapters', 'notes'];
const VIEW_LABELS: Readonly<Record<StudyView, string>> = {
    side: 'Side',
    transcript: 'Transcript',
    chapters: 'Chapters',
    notes: 'Notes',
};

const SEARCH_DELAY = 150;
const NOTE_SAVE_DELAY = 500;
const FEEDBACK_DELAY = 2_000;
const DOWNLOAD_REVOKE_DELAY = 10_000;
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
// keys a focused panel button needs for itself; YouTube's page-level shortcuts
// would otherwise toggle playback (Space), seek (Home/End), or change volume
const BUTTON_KEYS = new Set([' ', 'Enter', ...SCROLL_KEYS]);
const SAVE_FAILED_MESSAGE =
    "Couldn't save your study notes. Browser storage may be full or unavailable.";
const MAX_JUMPS = 50;

/** Alt/Option + M: a bookmark anywhere on the page, the current time inside the note. */
export const isMarkShortcut = (event: KeyboardEvent): boolean =>
    event.code === 'KeyM' &&
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.repeat &&
    !event.isComposing;

const isStudyView = (value: unknown): value is StudyView => VIEW_ORDER.includes(value as StudyView);

const element = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = '',
    text = '',
): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text) {
        node.textContent = text;
    }
    return node;
};

const actionButton = (className: string, text: string, action = ''): HTMLButtonElement => {
    const node = element('button', className, text);
    node.type = 'button';
    if (action) {
        node.dataset.action = action;
    }
    return node;
};

const message = (text: string): HTMLElement => element('div', 'youtube-side-message', text);

const prefersReducedMotion = (): boolean =>
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const scrollIntoList = (list: HTMLElement, row: HTMLElement): void => {
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom) {
        return;
    }

    // scroll only the list; scrollIntoView would also move the panel and the page
    const top = Math.max(0, list.scrollTop + rowRect.top - listRect.top - list.clientHeight / 3);
    if (typeof list.scrollTo === 'function') {
        list.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } else {
        list.scrollTop = top;
    }
};

const markCurrent = (previous: HTMLElement | null, next: HTMLElement | null): void => {
    previous?.classList.remove('is-current');
    previous?.removeAttribute('aria-current');
    next?.classList.add('is-current');
    next?.setAttribute('aria-current', 'true');
};

const copyText = async (text: string): Promise<boolean> => {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // the async clipboard can be unavailable or denied; fall back to a selection copy
    }

    const textarea = element('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();

    try {
        return typeof document.execCommand === 'function' && document.execCommand('copy');
    } catch {
        return false;
    } finally {
        textarea.remove();
    }
};

export class StudyPanel {
    private below: HTMLElement | null = null;
    private container: HTMLElement | null = null;
    private content: HTMLElement | null = null;
    private liveRegion: HTMLElement | null = null;
    private notice: HTMLElement | null = null;
    private followButton: HTMLButtonElement | null = null;
    private readonly tabs = new Map<StudyView, HTMLButtonElement>();

    private transcriptList: HTMLElement | null = null;
    private matchCount: HTMLElement | null = null;
    private resumeButton: HTMLButtonElement | null = null;
    private readonly segmentRows = new Map<number, HTMLElement>();
    private chapterRows: HTMLElement[] = [];
    private currentRow: HTMLElement | null = null;

    private view: StudyView = 'side';
    private layout: WatchLayout = 'unknown';
    private videoId: string | null = null;
    private currentTimeMs = 0;

    private transcript: Transcript | null = null;
    private transcriptStatus: LoadStatus = 'idle';
    private transcriptLoad: AbortController | null = null;
    private chapters: Chapter[] | null = null;
    private chapterStatus: LoadStatus = 'idle';

    private followDefault: boolean;
    private followEnabled: boolean;
    private followPaused = false;
    private searchQuery = '';
    private searchTimer: number | undefined;
    private currentSegment = -1;
    private currentChapter = -1;

    private notesRender = 0;
    private pendingNote: { videoId: string; note: string } | null = null;
    private noteTimer: number | undefined;
    private jumpList: HTMLElement | null = null;
    private unsubscribeStudy: (() => void) | undefined;

    public constructor(options: StudyPanelOptions = {}) {
        this.followDefault = options.follow ?? true;
        this.followEnabled = this.followDefault;
    }

    /** Idempotent: re-mounting into the same panel keeps focus, scroll, and input state. */
    public mount(below: HTMLElement, videoId: string | null): void {
        const attached =
            this.below === below &&
            this.container?.isConnected &&
            this.container.parentElement === below;

        if (!attached) {
            this.detach();
            this.below = below;
            this.buildShell(below);
            if (videoId !== this.videoId) {
                this.resetVideo(videoId);
            }
            this.syncViewAttribute();
            this.syncHeader();
            this.renderContent();
            void this.loadViewData();
            return;
        }

        if (videoId !== this.videoId) {
            void this.handleVideoChange(videoId);
        }
    }

    /** Removes the study UI and its view attribute; view and video state are kept for the next mount. */
    public unmount(): void {
        void this.flushNote();
        this.detach();
    }

    public destroy(): void {
        this.unmount();
        window.clearTimeout(this.searchTimer);
        this.searchTimer = undefined;
        this.unsubscribeStudy?.();
        this.unsubscribeStudy = undefined;
    }

    public getView(): StudyView {
        return this.view;
    }

    public setView(view: StudyView): void {
        if (this.view === view) {
            return;
        }

        this.view = view;
        this.syncViewAttribute();
        this.syncHeader();
        this.announce(`${VIEW_LABELS[view]} view`);
        this.renderContent();
        void this.loadViewData();
    }

    /** YouTube's experimental layout leaves the Side view with only the title, so it says why. */
    public setLayout(layout: WatchLayout): void {
        if (layout !== this.layout) {
            this.layout = layout;
            this.renderIfVisible('side');
        }
    }

    public cycleView(): void {
        const next = VIEW_ORDER[(VIEW_ORDER.indexOf(this.view) + 1) % VIEW_ORDER.length];
        this.setView(next ?? 'side');
    }

    public setFollowDefault(follow: boolean): void {
        if (follow === this.followDefault) {
            return;
        }

        this.followDefault = follow;
        this.followEnabled = follow;
        this.followPaused = false;
        this.syncFollowControls();
    }

    public async handleVideoChange(videoId: string | null): Promise<void> {
        if (videoId === this.videoId) {
            return;
        }

        void this.flushNote();
        this.resetVideo(videoId);
        this.syncHeader();
        this.renderContent();
        await this.loadViewData();
    }

    /** Called once YouTube's watch metadata belongs to the current video. */
    public handlePageDataReady(): void {
        if (this.view === 'chapters' && this.chapterStatus !== 'ready') {
            this.loadChapters();
        }
    }

    /** Routes a transcript the user opened in YouTube's own panel into the Transcript view. */
    public showYouTubeTranscript(): void {
        const videoId = this.videoId;
        if (videoId && this.transcriptStatus !== 'ready') {
            void this.runTranscriptLoad(videoId, (signal) =>
                loadTranscriptFromPanel({ videoId, openPanel: false, signal }),
            );
        }

        if (this.view === 'transcript') {
            this.renderContent();
        } else {
            this.setView('transcript');
        }
    }

    public updateTime(currentTimeMs: number): void {
        this.currentTimeMs = currentTimeMs;

        if (this.view === 'transcript' && this.transcript) {
            const index = findCurrentSegmentIndex(this.transcript.segments, currentTimeMs);
            if (index !== this.currentSegment) {
                this.currentSegment = index;
                this.highlightSegment(true);
            }
        } else if (this.view === 'chapters' && this.chapters) {
            const index = findCurrentSegmentIndex(this.chapters, currentTimeMs);
            if (index !== this.currentChapter) {
                this.currentChapter = index;
                this.highlightChapter();
            }
        }
    }

    public render(): void {
        this.syncHeader();
        this.renderContent();
    }

    private detach(): void {
        this.cancelTranscriptLoad();
        this.container?.remove();
        this.below?.removeAttribute(VIEW_ATTRIBUTE);

        this.below = null;
        this.container = null;
        this.content = null;
        this.liveRegion = null;
        this.notice = null;
        this.followButton = null;
        this.tabs.clear();
        this.clearViewReferences();
    }

    private resetVideo(videoId: string | null): void {
        this.cancelTranscriptLoad();
        this.videoId = videoId;
        this.watchStudy(videoId);
        this.currentTimeMs = 0;
        this.transcript = null;
        this.transcriptStatus = 'idle';
        this.chapters = null;
        this.chapterStatus = 'idle';
        this.followEnabled = this.followDefault;
        this.followPaused = false;
        this.searchQuery = '';
        window.clearTimeout(this.searchTimer);
        this.searchTimer = undefined;
        this.currentSegment = -1;
        this.currentChapter = -1;
        this.notesRender += 1;
    }

    /**
     * Another tab or the notes library changed this video's notes. The open
     * Notes view shows the change, unless the user is typing in it.
     */
    private watchStudy(videoId: string | null): void {
        this.unsubscribeStudy?.();
        this.unsubscribeStudy = videoId
            ? subscribeVideoStudy(videoId, (_study, { ownWrite }) => {
                  if (
                      !ownWrite &&
                      this.view === 'notes' &&
                      videoId === this.videoId &&
                      this.content &&
                      !this.content.contains(document.activeElement)
                  ) {
                      this.renderContent();
                  }
              })
            : undefined;
    }

    /** The title and channel saved with the video's notes, once the page shows this video. */
    private meta(videoId: string): VideoMeta {
        return videoId === this.videoId && isPageDataCurrent(videoId)
            ? { title: readVideoTitle(), channel: readChannelName() }
            : {};
    }

    private clearViewReferences(): void {
        this.jumpList = null;
        this.transcriptList = null;
        this.matchCount = null;
        this.resumeButton = null;
        this.segmentRows.clear();
        this.chapterRows = [];
        this.currentRow = null;
    }

    private buildShell(below: HTMLElement): void {
        // a container left behind by an earlier content-script instance
        for (const stale of below.querySelectorAll(`#${STUDY_ID}`)) {
            stale.remove();
        }

        const container = element('div');
        container.id = STUDY_ID;

        const liveRegion = element('div', 'youtube-side-sr-only');
        liveRegion.setAttribute('role', 'status');
        liveRegion.setAttribute('aria-live', 'polite');

        const header = element('div', 'youtube-side-study-header');
        header.id = 'youtube-side-study-header';

        const tablist = element('div', 'youtube-side-tablist');
        tablist.setAttribute('role', 'tablist');
        tablist.setAttribute('aria-label', 'YouTube Side views');
        tablist.addEventListener('keydown', this.handleTabKey);

        for (const view of VIEW_ORDER) {
            const tab = actionButton('youtube-side-tab', VIEW_LABELS[view]);
            tab.id = `youtube-side-tab-${view}`;
            tab.dataset.view = view;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-controls', STUDY_CONTENT_ID);
            this.tabs.set(view, tab);
            tablist.append(tab);
        }

        const actions = element('div', 'youtube-side-study-actions');
        this.followButton = actionButton('youtube-side-button', '', 'toggle-follow');
        actions.append(
            this.followButton,
            actionButton('youtube-side-button', '+ Bookmark', 'bookmark'),
        );
        header.append(tablist, actions);

        const notice = element('div', 'youtube-side-notice');
        notice.setAttribute('role', 'alert');
        notice.hidden = true;

        const content = element('div');
        content.id = STUDY_CONTENT_ID;
        content.setAttribute('role', 'tabpanel');

        container.append(liveRegion, header, notice, content);
        container.addEventListener('click', this.handleClick);
        container.addEventListener('keydown', this.keepButtonKeys);
        container.addEventListener('keyup', this.keepButtonKeys);
        below.prepend(container);

        this.container = container;
        this.content = content;
        this.liveRegion = liveRegion;
        this.notice = notice;
    }

    private syncViewAttribute(): void {
        if (!this.below) {
            return;
        }

        if (this.view === 'side') {
            this.below.removeAttribute(VIEW_ATTRIBUTE);
        } else {
            this.below.setAttribute(VIEW_ATTRIBUTE, this.view);
        }
    }

    private syncHeader(): void {
        for (const [view, tab] of this.tabs) {
            const selected = view === this.view;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
        }

        this.syncFollowControls();
    }

    private syncFollowControls(): void {
        if (this.followButton) {
            this.followButton.hidden = this.view !== 'transcript';
            this.followButton.textContent = `Follow: ${this.followEnabled ? 'On' : 'Off'}`;
            this.followButton.setAttribute('aria-pressed', String(this.followEnabled));
        }

        if (this.resumeButton) {
            this.resumeButton.hidden = !(this.followEnabled && this.followPaused);
        }
    }

    private announce(text: string): void {
        if (this.liveRegion) {
            this.liveRegion.textContent = text;
        }
    }

    private setNotice(text: string | null): void {
        if (this.notice) {
            this.notice.textContent = text ?? '';
            this.notice.hidden = text === null;
        }
    }

    private persist(write: Promise<unknown>): Promise<boolean> {
        return write.then(
            () => {
                this.setNotice(null);
                return true;
            },
            (error: unknown) => {
                this.setNotice(
                    error instanceof BookmarkLimitError || error instanceof NoteLimitError
                        ? error.message
                        : SAVE_FAILED_MESSAGE,
                );
                return false;
            },
        );
    }

    private async loadViewData(): Promise<void> {
        // nothing loads while the panel is not on the page
        if (!this.below || !this.videoId) {
            return;
        }

        if (this.view === 'transcript') {
            await this.loadTranscript();
        } else if (this.view === 'chapters' && this.chapterStatus !== 'ready') {
            this.loadChapters();
        }
    }

    private cancelTranscriptLoad(): void {
        this.transcriptLoad?.abort();
        this.transcriptLoad = null;
        if (this.transcriptStatus === 'loading') {
            this.transcriptStatus = 'idle';
        }
    }

    private loadTranscript(): Promise<void> {
        const videoId = this.videoId;
        if (!videoId || this.transcriptStatus !== 'idle') {
            return Promise.resolve();
        }

        // opening the Transcript view is the user's request for it; when no
        // cheaper source has it, YouTube's own transcript panel is opened, read, and closed
        return this.runTranscriptLoad(
            videoId,
            async (signal) =>
                (await fetchTranscript(videoId, document, signal)) ??
                (signal.aborted
                    ? null
                    : loadTranscriptFromPanel({ videoId, openPanel: true, signal })),
        );
    }

    private async runTranscriptLoad(
        videoId: string,
        load: (signal: AbortSignal) => Promise<Transcript | null>,
    ): Promise<void> {
        this.cancelTranscriptLoad();
        const controller = new AbortController();
        this.transcriptLoad = controller;
        this.transcriptStatus = 'loading';
        this.renderIfVisible('transcript');

        let transcript: Transcript | null = null;
        try {
            transcript = await load(controller.signal);
        } catch {
            transcript = null;
        }

        // a newer load, a video change, or an unmount took over meanwhile
        if (controller.signal.aborted || videoId !== this.videoId) {
            return;
        }

        this.transcriptLoad = null;
        this.transcript = transcript;
        this.transcriptStatus = transcript
            ? 'ready'
            : findTranscriptButton()
              ? 'failed'
              : 'unavailable';
        this.currentSegment = -1;
        this.renderIfVisible('transcript');
        if (transcript) {
            this.announce('Transcript loaded');
        }
    }

    private loadChapters(): void {
        const videoId = this.videoId;
        if (!videoId) {
            return;
        }

        if (isPageDataCurrent(videoId)) {
            this.chapters = extractChaptersFromDOM(document);
            this.chapterStatus = this.chapters ? 'ready' : 'unavailable';
            this.currentChapter = this.chapters
                ? findCurrentSegmentIndex(this.chapters, this.currentTimeMs)
                : -1;
        } else {
            // YouTube has not swapped in this video's metadata yet; handlePageDataReady retries
            this.chapterStatus = 'loading';
        }

        this.renderIfVisible('chapters');
    }

    private renderIfVisible(view: StudyView): void {
        if (this.view === view) {
            this.renderContent();
        }
    }

    private renderContent(): void {
        const content = this.content;
        if (!content) {
            return;
        }

        this.clearViewReferences();
        content.replaceChildren();
        content.hidden = this.view === 'side' && this.layout !== 'panels';
        content.setAttribute('aria-labelledby', `youtube-side-tab-${this.view}`);

        switch (this.view) {
            case 'side':
                if (this.layout === 'panels') {
                    this.renderPanelsHint(content);
                }
                break;
            case 'transcript':
                this.renderTranscript(content);
                break;
            case 'chapters':
                this.renderChapters(content);
                break;
            case 'notes':
                void this.renderNotes(content);
                break;
            default:
                break;
        }
    }

    private renderPanelsHint(content: HTMLElement): void {
        const transcript = actionButton('youtube-side-button youtube-side-pill', 'Transcript');
        transcript.dataset.view = 'transcript';
        const notes = actionButton('youtube-side-button youtube-side-pill', 'Notes');
        notes.dataset.view = 'notes';
        const actions = element('div', 'youtube-side-toolbar');
        actions.append(transcript, notes);

        content.append(
            message(
                "On this page YouTube shows the description and comments in its own panel, so they don't appear here. The transcript, chapters, and notes work as usual.",
            ),
            actions,
        );
    }

    private renderTranscript(content: HTMLElement): void {
        if (!this.videoId) {
            content.append(message('Open a video to see its transcript.'));
            return;
        }

        const transcript = this.transcript;
        if (this.transcriptStatus === 'unavailable') {
            content.append(message('No transcript available for this video.'));
            return;
        }
        if (this.transcriptStatus === 'failed') {
            content.append(
                message("Couldn't load the transcript from YouTube."),
                actionButton(
                    'youtube-side-button youtube-side-pill',
                    'Try again',
                    'load-transcript',
                ),
            );
            return;
        }
        if (this.transcriptStatus !== 'ready' || !transcript) {
            content.append(message('Loading transcript…'));
            return;
        }

        const toolbar = element('div', 'youtube-side-toolbar');
        const search = element('input', 'youtube-side-input');
        search.type = 'search';
        search.placeholder = 'Search transcript…';
        search.value = this.searchQuery;
        search.setAttribute('aria-label', 'Search transcript');
        search.addEventListener('input', () => {
            this.scheduleSearch(search.value);
        });
        search.addEventListener('keydown', (event) => {
            this.handleSearchKey(event, search);
        });

        this.matchCount = element('span', 'youtube-side-meta');
        this.matchCount.setAttribute('aria-live', 'polite');
        const quote = actionButton('youtube-side-button', 'Quote', 'quote-line');
        quote.title = 'Quote the current line into Notes (Shift+click any line to quote it)';
        quote.setAttribute('aria-label', 'Quote the current line into Notes');
        toolbar.append(search, this.matchCount, quote);
        content.append(toolbar);

        const notes = [
            transcript.kind === 'asr' ? 'Auto-generated captions.' : '',
            transcript.truncated
                ? `Showing the first ${MAX_TRANSCRIPT_SEGMENTS.toLocaleString('en-US')} lines.`
                : '',
        ].filter(Boolean);
        if (notes.length > 0) {
            content.append(element('div', 'youtube-side-meta', notes.join(' ')));
        }

        this.resumeButton = actionButton(
            'youtube-side-button youtube-side-pill',
            'Resume follow',
            'resume-follow',
        );

        const list = element('div', 'youtube-side-list');
        list.id = 'youtube-side-transcript-list';
        list.addEventListener('wheel', this.pauseFollow, { passive: true });
        list.addEventListener('touchmove', this.pauseFollow, { passive: true });
        list.addEventListener('pointerdown', (event) => {
            // a pointer down on the list itself, not a row, is a scrollbar drag
            if (event.target === list) {
                this.pauseFollow();
            }
        });
        list.addEventListener('keydown', (event) => {
            if (SCROLL_KEYS.has(event.key)) {
                this.pauseFollow();
            }
        });

        this.transcriptList = list;
        content.append(this.resumeButton, list);
        this.renderTranscriptRows();
        this.syncFollowControls();
    }

    private renderTranscriptRows(): void {
        const list = this.transcriptList;
        const transcript = this.transcript;
        if (!list || !transcript) {
            return;
        }

        const results = filterTranscriptSegments(transcript.segments, this.searchQuery);
        const fragment = document.createDocumentFragment();
        this.segmentRows.clear();
        this.currentRow = null;
        for (const result of results) {
            const row = this.buildSegmentRow(result);
            this.segmentRows.set(result.index, row);
            fragment.append(row);
        }
        list.replaceChildren(fragment);

        if (this.matchCount) {
            this.matchCount.textContent = this.searchQuery.trim()
                ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}`
                : '';
        }

        this.currentSegment = findCurrentSegmentIndex(transcript.segments, this.currentTimeMs);
        this.highlightSegment(false);
    }

    private buildSegmentRow({ segment, index, matchRange }: SearchResult): HTMLElement {
        const row = actionButton('youtube-side-row youtube-side-transcript-row', '');
        row.dataset.index = String(index);
        row.dataset.seek = String(segment.startMs);

        const text = element('span', 'youtube-side-text');
        if (matchRange) {
            const [start, end] = matchRange;
            text.append(
                segment.text.slice(0, start),
                element('mark', '', segment.text.slice(start, end)),
                segment.text.slice(end),
            );
        } else {
            text.textContent = segment.text;
        }

        row.append(element('span', 'youtube-side-time', formatTimestamp(segment.startMs)), text);
        return row;
    }

    private highlightSegment(scroll: boolean): void {
        const row = this.segmentRows.get(this.currentSegment) ?? null;
        markCurrent(this.currentRow, row);
        this.currentRow = row;

        const list = this.transcriptList;
        if (
            row &&
            list &&
            scroll &&
            this.followEnabled &&
            !this.followPaused &&
            !this.searchQuery.trim()
        ) {
            scrollIntoList(list, row);
        }
    }

    private scheduleSearch(query: string): void {
        this.searchQuery = query;
        window.clearTimeout(this.searchTimer);
        this.searchTimer = window.setTimeout(() => {
            this.searchTimer = undefined;
            this.renderTranscriptRows();
        }, SEARCH_DELAY);
    }

    private handleSearchKey(event: KeyboardEvent, search: HTMLInputElement): void {
        if (event.key === 'Enter') {
            event.preventDefault();
            this.searchQuery = search.value;
            window.clearTimeout(this.searchTimer);
            this.renderTranscriptRows();
            const first = this.transcriptList?.querySelector<HTMLElement>('[data-seek]');
            if (first) {
                this.seekTo(Number(first.dataset.seek));
            }
        } else if (event.key === 'Escape' && search.value) {
            event.preventDefault();
            search.value = '';
            this.searchQuery = '';
            window.clearTimeout(this.searchTimer);
            this.renderTranscriptRows();
        }
    }

    private pauseFollow = (): void => {
        if (this.followEnabled && !this.followPaused) {
            this.followPaused = true;
            this.syncFollowControls();
        }
    };

    private renderChapters(content: HTMLElement): void {
        const chapters = this.chapters;
        if (this.chapterStatus === 'unavailable') {
            const openTranscript = actionButton(
                'youtube-side-button youtube-side-pill',
                'Open transcript',
            );
            openTranscript.dataset.view = 'transcript';
            content.append(message('No chapters available for this video.'), openTranscript);
            return;
        }
        if (this.chapterStatus !== 'ready' || !chapters) {
            content.append(
                message(this.videoId ? 'Loading chapters…' : 'Open a video to see its chapters.'),
            );
            return;
        }

        const list = element('div', 'youtube-side-list');
        list.id = 'youtube-side-chapters-list';
        this.chapterRows = chapters.map((chapter, index) => {
            const row = actionButton('youtube-side-row youtube-side-chapter-row', '');
            row.dataset.chapterIndex = String(index);
            row.dataset.seek = String(chapter.startMs);
            row.append(
                element('span', 'youtube-side-time', formatTimestamp(chapter.startMs)),
                element('span', 'youtube-side-text', chapter.title),
            );
            return row;
        });
        list.append(...this.chapterRows);
        content.append(list);
        this.highlightChapter();
    }

    private highlightChapter(): void {
        const row = this.chapterRows[this.currentChapter] ?? null;
        markCurrent(this.currentRow, row);
        this.currentRow = row;
    }

    private async renderNotes(content: HTMLElement): Promise<void> {
        const videoId = this.videoId;
        if (!videoId) {
            content.append(message('Open a video to take notes.'));
            return;
        }

        const render = ++this.notesRender;
        const study = await loadVideoStudy(videoId);
        if (
            render !== this.notesRender ||
            content !== this.content ||
            this.view !== 'notes' ||
            videoId !== this.videoId
        ) {
            return;
        }

        content.replaceChildren(
            element('h3', 'youtube-side-heading', `Bookmarks (${study.bookmarks.length})`),
        );

        if (study.bookmarks.length === 0) {
            content.append(
                message('No bookmarks yet. Use "+ Bookmark" to capture the current moment.'),
            );
        }

        for (const bookmark of study.bookmarks) {
            const item = element('div', 'youtube-side-bookmark');
            item.dataset.bookmarkId = String(bookmark.createdAt);

            const time = formatTimestamp(bookmark.timeMs);
            const seek = actionButton('youtube-side-button', time);
            seek.dataset.seek = String(bookmark.timeMs);
            seek.setAttribute('aria-label', `Seek to ${time}`);

            const remove = actionButton('youtube-side-button', '×', 'delete-bookmark');
            remove.setAttribute('aria-label', `Delete bookmark at ${time}`);

            const bar = element('div', 'youtube-side-bookmark-bar');
            bar.append(seek, remove);

            const save = (update: BookmarkUpdate) => {
                void this.persist(updateBookmark(videoId, bookmark.createdAt, update));
            };
            item.append(
                bar,
                this.buildField(
                    'Bookmark label',
                    'Label…',
                    bookmark.label,
                    MAX_LABEL_LENGTH,
                    (label) => {
                        save({ label });
                    },
                ),
                this.buildField(
                    'Bookmark note',
                    'Note…',
                    bookmark.note,
                    MAX_BOOKMARK_NOTE_LENGTH,
                    (note) => {
                        save({ note });
                    },
                ),
            );
            content.append(item);
        }

        const textarea = element('textarea', 'youtube-side-input youtube-side-textarea');
        textarea.value = this.pendingNote?.videoId === videoId ? this.pendingNote.note : study.note;
        textarea.placeholder = 'Write notes for this video… Alt/Option+M inserts the current time.';
        textarea.maxLength = MAX_VIDEO_NOTE_LENGTH;
        textarea.setAttribute('aria-label', 'Notes for this video');
        textarea.addEventListener('input', () => {
            this.scheduleNoteSave(videoId, textarea.value);
            this.renderJumps(textarea.value);
        });
        textarea.addEventListener('keydown', (event) => {
            if (isMarkShortcut(event)) {
                event.preventDefault();
                this.insertTimestamp(textarea);
            }
        });

        const heading = element('div', 'youtube-side-bookmark-bar');
        const insertTime = actionButton('youtube-side-button', '+ Time', 'insert-time');
        insertTime.title = 'Insert the current time (Alt/Option+M)';
        insertTime.setAttribute('aria-label', 'Insert the current time into the note');
        heading.append(element('h3', 'youtube-side-heading', 'Notes'), insertTime);

        this.jumpList = element('div', 'youtube-side-jumps');
        this.jumpList.setAttribute('aria-label', 'Timestamps in the note');

        const exportBar = element('div', 'youtube-side-export');
        exportBar.append(
            actionButton('youtube-side-button', 'Copy as Markdown', 'copy-markdown'),
            actionButton('youtube-side-button', 'Download .md', 'download-markdown'),
        );

        content.append(heading, textarea, this.jumpList, exportBar);
        this.renderJumps(textarea.value);
    }

    /** The note's timestamps as buttons that seek, since a textarea cannot hold links. */
    private renderJumps(note: string): void {
        const list = this.jumpList;
        if (!list) {
            return;
        }

        const timestamps = findNoteTimestamps(note).slice(0, MAX_JUMPS);
        list.hidden = timestamps.length === 0;
        list.replaceChildren(
            ...timestamps.map(({ timeMs, context }) => {
                const time = formatTimestamp(timeMs);
                const jump = actionButton('youtube-side-button youtube-side-jump', '');
                jump.dataset.seek = String(timeMs);
                jump.setAttribute('aria-label', `Seek to ${time}${context ? `: ${context}` : ''}`);
                jump.append(element('span', 'youtube-side-time', time));
                if (context) {
                    jump.append(element('span', 'youtube-side-jump-text', context));
                }
                return jump;
            }),
        );
    }

    private currentPlaybackMs(): number | null {
        const video = getMainVideo();
        if (!video || isAdShowing()) {
            return null;
        }
        return Math.round(video.currentTime * 1000);
    }

    private insertTimestamp(textarea: HTMLTextAreaElement): void {
        const videoId = this.videoId;
        const timeMs = this.currentPlaybackMs();
        if (!videoId || timeMs === null) {
            this.announce(
                isAdShowing() ? 'The time is unavailable while an ad plays' : 'There is no video',
            );
            return;
        }

        const start = textarea.selectionStart;
        const before = textarea.value.slice(0, start);
        const text = `${before && !/\s$/.test(before) ? ' ' : ''}${noteTimestamp(timeMs)} `;
        if (
            textarea.value.length - (textarea.selectionEnd - start) + text.length >
            MAX_VIDEO_NOTE_LENGTH
        ) {
            this.setNotice(new NoteLimitError().message);
            return;
        }

        textarea.focus();
        textarea.setRangeText(text, start, textarea.selectionEnd, 'end');
        this.scheduleNoteSave(videoId, textarea.value);
        this.renderJumps(textarea.value);
        this.announce(`Inserted ${formatTimestamp(timeMs)}`);
    }

    private async quoteSegment(index: number, button?: HTMLElement): Promise<void> {
        const videoId = this.videoId;
        const segment = this.transcript?.segments[index];
        if (!videoId || !segment) {
            this.announce('Play to a line, or Shift+click a line, to quote it');
            return;
        }

        // a note still waiting for its debounced save must land before the quote is appended
        await this.flushNote();
        const block = `> ${noteTimestamp(segment.startMs)} ${segment.text}`;
        if (await this.persist(appendToNote(videoId, block, this.meta(videoId)))) {
            this.announce(`Quoted ${formatTimestamp(segment.startMs)} into Notes`);
            if (button) {
                button.textContent = 'Quoted';
                window.setTimeout(() => {
                    button.textContent = 'Quote';
                }, FEEDBACK_DELAY);
            }
        }
    }

    private buildField(
        label: string,
        placeholder: string,
        value: string,
        maxLength: number,
        commit: (value: string) => void,
    ): HTMLInputElement {
        const field = element('input', 'youtube-side-field');
        field.type = 'text';
        field.value = value;
        field.placeholder = placeholder;
        field.maxLength = maxLength;
        field.setAttribute('aria-label', label);

        // saving while typing keeps an edit that never blurs, for example when
        // autoplay moves to the next video and the field is removed mid-edit
        let committed = value;
        let timer: number | undefined;
        const flush = () => {
            window.clearTimeout(timer);
            timer = undefined;
            if (field.value !== committed) {
                committed = field.value;
                commit(field.value);
            }
        };
        field.addEventListener('input', () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(flush, NOTE_SAVE_DELAY);
        });
        field.addEventListener('change', flush);
        return field;
    }

    private refreshNotes(videoId: string): void {
        if (this.view === 'notes' && videoId === this.videoId) {
            this.renderContent();
        }
    }

    private scheduleNoteSave(videoId: string, note: string): void {
        // the video id is captured now so a save that fires after navigation lands on the right video
        this.pendingNote = { videoId, note };
        window.clearTimeout(this.noteTimer);
        this.noteTimer = window.setTimeout(() => {
            void this.flushNote();
        }, NOTE_SAVE_DELAY);
    }

    private async flushNote(): Promise<void> {
        window.clearTimeout(this.noteTimer);
        this.noteTimer = undefined;

        const pending = this.pendingNote;
        this.pendingNote = null;
        if (pending) {
            await this.persist(
                setVideoNote(pending.videoId, pending.note, this.meta(pending.videoId)),
            );
        }
    }

    private seekTo(timeMs: number): void {
        const video = getMainVideo();
        if (!video || !Number.isFinite(timeMs)) {
            return;
        }

        if (isAdShowing()) {
            this.announce('Seeking is unavailable while an ad plays');
            return;
        }

        video.currentTime = Math.max(0, timeMs / 1000);
        this.followPaused = false;
        this.syncFollowControls();
        this.updateTime(timeMs);
    }

    /**
     * Bookmarks the current moment, labelled with its chapter. Works while
     * the panel is closed (Alt/Option+M); resolves a status line for the
     * caller to show.
     */
    public async captureBookmark(): Promise<string> {
        const videoId = this.videoId;
        const video = getMainVideo();
        let status: string;
        if (!videoId || !video) {
            status = 'There is no video to bookmark';
        } else if (isAdShowing()) {
            status = 'Bookmarks are unavailable while an ad plays';
        } else {
            const timeMs = Math.round(video.currentTime * 1000);
            if (this.chapterStatus !== 'ready') {
                this.loadChapters();
            }
            const chapter = this.chapters?.[findCurrentSegmentIndex(this.chapters, timeMs)];
            const label = chapter?.title ?? formatTimestamp(timeMs);

            const saved = await this.persist(
                addBookmark(videoId, timeMs, label, '', this.meta(videoId)),
            );
            status = saved
                ? `Bookmarked ${formatTimestamp(timeMs)}`
                : (this.notice?.textContent ?? SAVE_FAILED_MESSAGE);
            this.refreshNotes(videoId);
        }

        this.announce(status);
        return status;
    }

    private async buildMarkdown(): Promise<string | null> {
        const videoId = this.videoId;
        if (!videoId) {
            return null;
        }

        // edits committed on blur and the debounced note must be in storage before reading it back
        await this.flushNote();
        await whenStudyWritesSettled();
        const study = await loadVideoStudy(videoId);
        return exportStudyMarkdown(readVideoTitle(), canonicalVideoUrl(videoId), study);
    }

    private async copyMarkdown(button: HTMLElement): Promise<void> {
        const markdown = await this.buildMarkdown();
        if (markdown === null) {
            return;
        }

        const copied = await copyText(markdown);
        this.announce(
            copied ? 'Copied study notes to the clipboard' : "Couldn't copy to the clipboard",
        );
        button.textContent = copied ? 'Copied!' : 'Copy failed';
        window.setTimeout(() => {
            button.textContent = 'Copy as Markdown';
        }, FEEDBACK_DELAY);
    }

    private async downloadMarkdown(): Promise<void> {
        const videoId = this.videoId;
        const markdown = await this.buildMarkdown();
        if (!videoId || markdown === null) {
            return;
        }

        const url = URL.createObjectURL(
            new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
        );
        const anchor = element('a');
        anchor.href = url;
        anchor.download = `${videoId}-notes.md`;
        anchor.click();
        // revoking synchronously can cancel the download before it starts
        window.setTimeout(() => {
            URL.revokeObjectURL(url);
        }, DOWNLOAD_REVOKE_DELAY);
    }

    private handleAction(action: string, target: HTMLElement): void {
        const videoId = this.videoId;

        switch (action) {
            case 'toggle-follow':
                this.followEnabled = !this.followEnabled;
                this.followPaused = false;
                this.syncFollowControls();
                this.highlightSegment(true);
                break;
            case 'resume-follow':
                this.followPaused = false;
                this.syncFollowControls();
                this.highlightSegment(true);
                break;
            case 'bookmark':
                void this.captureBookmark();
                break;
            case 'quote-line':
                void this.quoteSegment(this.currentSegment, target);
                break;
            case 'insert-time': {
                const textarea = this.content?.querySelector('textarea');
                if (textarea) {
                    this.insertTimestamp(textarea);
                }
                break;
            }
            case 'load-transcript':
                if (videoId) {
                    void this.runTranscriptLoad(videoId, (signal) =>
                        loadTranscriptFromPanel({ videoId, openPanel: true, signal }),
                    );
                }
                break;
            case 'delete-bookmark': {
                const bookmarkId = Number(
                    target.closest<HTMLElement>('[data-bookmark-id]')?.dataset.bookmarkId,
                );
                if (videoId && Number.isFinite(bookmarkId)) {
                    void this.persist(removeBookmark(videoId, bookmarkId)).then(() => {
                        this.refreshNotes(videoId);
                    });
                }
                break;
            }
            case 'copy-markdown':
                void this.copyMarkdown(target);
                break;
            case 'download-markdown':
                void this.downloadMarkdown();
                break;
            default:
                break;
        }
    }

    private handleClick = (event: MouseEvent): void => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) {
            return;
        }

        const viewTarget = target.closest<HTMLElement>('[data-view]');
        if (viewTarget) {
            const view = viewTarget.dataset.view;
            if (isStudyView(view)) {
                this.setView(view);
            }
            return;
        }

        const seekTarget = target.closest<HTMLElement>('[data-seek]');
        if (seekTarget) {
            // Shift+click on a transcript line quotes it instead of seeking
            if (event.shiftKey && seekTarget.dataset.index !== undefined) {
                void this.quoteSegment(Number(seekTarget.dataset.index));
            } else {
                this.seekTo(Number(seekTarget.dataset.seek));
            }
            return;
        }

        const actionTarget = target.closest<HTMLElement>('[data-action]');
        if (actionTarget?.dataset.action) {
            this.handleAction(actionTarget.dataset.action, actionTarget);
        }
    };

    private keepButtonKeys = (event: KeyboardEvent): void => {
        if (
            BUTTON_KEYS.has(event.key) &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            event.target instanceof Element &&
            event.target.closest('button') !== null
        ) {
            event.stopPropagation();
        }
    };

    private handleTabKey = (event: KeyboardEvent): void => {
        const index = VIEW_ORDER.indexOf(this.view);
        const targets: Record<string, StudyView | undefined> = {
            ArrowRight: VIEW_ORDER[(index + 1) % VIEW_ORDER.length],
            ArrowLeft: VIEW_ORDER[(index - 1 + VIEW_ORDER.length) % VIEW_ORDER.length],
            Home: VIEW_ORDER[0],
            End: VIEW_ORDER[VIEW_ORDER.length - 1],
        };
        const next = targets[event.key];
        if (!next || event.altKey) {
            return;
        }

        // arrow keys would otherwise also reach YouTube's seek and volume shortcuts
        event.preventDefault();
        event.stopPropagation();
        this.setView(next);
        this.tabs.get(next)?.focus();
    };
}
