import { exportStudyMarkdown, formatTimestamp } from '~data/study';
import { type Chapter, extractChaptersFromDOM } from './chapters';
import {
    addBookmark,
    loadVideoStudy,
    removeBookmark,
    setVideoNote,
    updateBookmark,
} from './studyStore';
import {
    fetchTranscript,
    filterTranscriptSegments,
    findCurrentSegmentIndex,
    normalizeSearchText,
    type Transcript,
} from './transcript';

export type StudyView = 'side' | 'transcript' | 'chapters' | 'notes';

const STUDY_CONTAINER_ID = 'youtube-side-study';
const VIEW_ORDER: readonly StudyView[] = ['side', 'transcript', 'chapters', 'notes'];

export class StudyPanel {
    private container: HTMLElement | null = null;
    private header: HTMLElement | null = null;
    private content: HTMLElement | null = null;
    private announceNode: HTMLElement | null = null;

    private currentView: StudyView = 'side';
    private currentVideoId: string | null = null;
    private transcript: Transcript | null = null;
    private chapters: Chapter[] | null = null;
    private transcriptLoading = false;

    private followEnabled = true;
    private followPausedByUser = false;
    private searchQuery = '';
    private currentSegmentIndex = -1;
    private currentChapterIndex = -1;
    private noteDebounceTimer: number | undefined;

    public mount(belowElement: HTMLElement, videoId: string | null): void {
        this.currentVideoId = videoId;

        let studyNode = document.getElementById(STUDY_CONTAINER_ID);
        if (!studyNode) {
            studyNode = document.createElement('div');
            studyNode.id = STUDY_CONTAINER_ID;
            belowElement.prepend(studyNode);
        }

        this.container = studyNode;
        if (this.currentView !== 'side') {
            belowElement.setAttribute('data-youtube-side-view', this.currentView);
        } else {
            belowElement.removeAttribute('data-youtube-side-view');
        }
        this.buildShell();
        this.render();

        if (this.currentView !== 'side') {
            void (async () => {
                await this.loadCurrentViewData();
                this.render();
            })();
        }
    }

    public unmount(): void {
        this.container?.remove();
        this.container = null;
        this.header = null;
        this.content = null;
        this.announceNode = null;
    }

    public setView(view: StudyView): void {
        if (this.currentView === view) {
            return;
        }
        this.currentView = view;

        const below = this.container?.parentElement;
        if (below) {
            if (view === 'side') {
                below.removeAttribute('data-youtube-side-view');
            } else {
                below.setAttribute('data-youtube-side-view', view);
            }
        }

        this.announce(`Switched to ${view} view`);
        this.render();

        if (view !== 'side') {
            void (async () => {
                await this.loadCurrentViewData();
                this.render();
            })();
        }
    }

    public cycleView(): void {
        const nextIndex = (VIEW_ORDER.indexOf(this.currentView) + 1) % VIEW_ORDER.length;
        const nextView = VIEW_ORDER[nextIndex] ?? 'side';
        this.setView(nextView);
    }

    public getView(): StudyView {
        return this.currentView;
    }

    public async handleVideoChange(videoId: string | null): Promise<void> {
        this.currentVideoId = videoId;
        this.transcript = null;
        this.chapters = null;
        this.followPausedByUser = false;
        this.searchQuery = '';
        this.currentSegmentIndex = -1;
        this.currentChapterIndex = -1;

        if (this.currentView !== 'side') {
            await this.loadCurrentViewData();
        }
        this.render();
    }

    public updateTime(currentTimeMs: number): void {
        if (this.currentView === 'transcript' && this.transcript) {
            const nextIndex = findCurrentSegmentIndex(this.transcript.segments, currentTimeMs);
            if (nextIndex !== this.currentSegmentIndex) {
                this.currentSegmentIndex = nextIndex;
                this.highlightCurrentSegment();
            }
        } else if (this.currentView === 'chapters' && this.chapters) {
            let nextChapter = -1;
            for (let i = 0; i < this.chapters.length; i++) {
                const ch = this.chapters[i];
                if (ch && ch.startMs <= currentTimeMs) {
                    nextChapter = i;
                }
            }
            if (nextChapter !== this.currentChapterIndex) {
                this.currentChapterIndex = nextChapter;
                this.highlightCurrentChapter();
            }
        }
    }

    private announce(message: string): void {
        if (this.announceNode) {
            this.announceNode.textContent = message;
        }
    }

    private seekTo(timeMs: number): void {
        const video = document.querySelector('video');
        if (video) {
            video.currentTime = Math.max(0, timeMs / 1000);
        }
    }

    private buildShell(): void {
        if (!this.container) {
            return;
        }

        this.container.textContent = '';

        this.header = document.createElement('div');
        this.header.id = 'youtube-side-study-header';

        this.content = document.createElement('div');
        this.content.id = 'youtube-side-study-content';

        this.announceNode = document.createElement('div');
        this.announceNode.className = 'youtube-side-sr-only';
        this.announceNode.setAttribute('aria-live', 'polite');

        this.container.append(this.announceNode, this.header, this.content);
    }

    private async loadCurrentViewData(): Promise<void> {
        if (!this.currentVideoId) {
            return;
        }

        if (this.currentView === 'transcript' && !this.transcript) {
            this.transcriptLoading = true;
            this.render();
            try {
                this.transcript = await fetchTranscript(this.currentVideoId, document);
            } finally {
                this.transcriptLoading = false;
            }
        } else if (this.currentView === 'chapters' && !this.chapters) {
            this.chapters = extractChaptersFromDOM(document);
        }
    }

    public render(): void {
        if (!this.header || !this.content) {
            return;
        }

        // Render header tabs & actions
        this.header.textContent = '';

        const tablist = document.createElement('div');
        tablist.className = 'youtube-side-tablist';
        tablist.setAttribute('role', 'tablist');

        for (const view of VIEW_ORDER) {
            const tab = document.createElement('button');
            tab.className = 'youtube-side-tab';
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(this.currentView === view));
            tab.textContent = view.charAt(0).toUpperCase() + view.slice(1);
            tab.addEventListener('click', () => {
                void (async () => {
                    this.setView(view);
                    await this.loadCurrentViewData();
                    this.render();
                })();
            });
            tablist.append(tab);
        }

        const actions = document.createElement('div');
        actions.className = 'youtube-side-study-actions';

        if (this.currentView === 'transcript') {
            const followBtn = document.createElement('button');
            followBtn.className = 'youtube-side-button';
            followBtn.textContent = this.followEnabled ? 'Follow: On' : 'Follow: Off';
            followBtn.addEventListener('click', () => {
                this.followEnabled = !this.followEnabled;
                this.followPausedByUser = false;
                followBtn.textContent = this.followEnabled ? 'Follow: On' : 'Follow: Off';
            });
            actions.append(followBtn);
        }

        const bookmarkBtn = document.createElement('button');
        bookmarkBtn.className = 'youtube-side-button';
        bookmarkBtn.textContent = '+ Bookmark';
        bookmarkBtn.addEventListener('click', () => {
            void this.handleCaptureBookmark();
        });
        actions.append(bookmarkBtn);

        this.header.append(tablist, actions);

        // Render active content
        this.content.textContent = '';
        if (this.currentView === 'side') {
            this.content.hidden = true;
            return;
        }
        this.content.hidden = false;

        switch (this.currentView) {
            case 'transcript':
                this.renderTranscriptView();
                break;
            case 'chapters':
                this.renderChaptersView();
                break;
            case 'notes':
                void this.renderNotesView();
                break;
        }
    }

    private renderTranscriptView(): void {
        if (!this.content) {
            return;
        }

        if (this.transcriptLoading) {
            const loading = document.createElement('div');
            loading.style.padding = '24px 0';
            loading.style.color = 'var(--yt-spec-text-secondary, #aaa)';
            loading.textContent = 'Loading transcript...';
            this.content.append(loading);
            return;
        }

        if (!this.transcript || this.transcript.segments.length === 0) {
            const empty = document.createElement('div');
            empty.style.padding = '24px 0';
            empty.style.color = 'var(--yt-spec-text-secondary, #aaa)';
            empty.textContent = 'No transcript available for this video.';
            this.content.append(empty);
            return;
        }

        const searchBar = document.createElement('div');
        searchBar.style.display = 'flex';
        searchBar.style.gap = '8px';
        searchBar.style.marginBottom = '12px';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search transcript...';
        searchInput.value = this.searchQuery;
        searchInput.style.flex = '1';
        searchInput.style.padding = '6px 10px';
        searchInput.style.background = 'var(--yt-spec-10-percent-layer, rgba(255,255,255,0.1))';
        searchInput.style.border = '1px solid rgba(255,255,255,0.2)';
        searchInput.style.borderRadius = '6px';
        searchInput.style.color = '#fff';

        searchInput.addEventListener('input', (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value;
            this.renderTranscriptList();
        });

        searchBar.append(searchInput);
        this.content.append(searchBar);

        const listContainer = document.createElement('div');
        listContainer.id = 'youtube-side-transcript-list';
        listContainer.style.display = 'flex';
        listContainer.style.flexDirection = 'column';
        listContainer.style.gap = '6px';
        listContainer.style.maxHeight = 'calc(100vh - 220px)';
        listContainer.style.overflowY = 'auto';

        listContainer.addEventListener('wheel', () => {
            if (this.followEnabled) {
                this.followPausedByUser = true;
            }
        });

        this.content.append(listContainer);
        this.renderTranscriptList();
    }

    private renderTranscriptList(): void {
        const listContainer = document.getElementById('youtube-side-transcript-list');
        if (!listContainer || !this.transcript) {
            return;
        }

        listContainer.textContent = '';
        const filtered = filterTranscriptSegments(this.transcript.segments, this.searchQuery);

        const fragment = document.createDocumentFragment();
        const cleanQuery = normalizeSearchText(this.searchQuery.trim());

        for (const item of filtered) {
            const row = document.createElement('div');
            row.className = 'youtube-side-transcript-row';
            row.setAttribute('data-index', String(item.index));
            row.style.display = 'flex';
            row.style.gap = '10px';
            row.style.padding = '4px 6px';
            row.style.borderRadius = '4px';
            row.style.cursor = 'pointer';

            const timeBtn = document.createElement('span');
            timeBtn.style.color = 'var(--yt-spec-call-to-action, #3ea6ff)';
            timeBtn.style.fontSize = '12px';
            timeBtn.style.fontFamily = 'monospace';
            timeBtn.style.flexShrink = '0';
            timeBtn.textContent = formatTimestamp(item.segment.startMs);

            const textSpan = document.createElement('span');
            textSpan.style.fontSize = '13px';
            textSpan.style.lineHeight = '1.4';

            // Safe text highlighting without innerHTML
            if (cleanQuery && item.matchRange) {
                const [start, end] = item.matchRange;
                const before = item.segment.text.slice(0, start);
                const matchText = item.segment.text.slice(start, end);
                const after = item.segment.text.slice(end);

                textSpan.append(document.createTextNode(before));
                const mark = document.createElement('mark');
                mark.style.background = '#ffd54f';
                mark.style.color = '#000';
                mark.style.borderRadius = '2px';
                mark.textContent = matchText;
                textSpan.append(mark);
                textSpan.append(document.createTextNode(after));
            } else {
                textSpan.textContent = item.segment.text;
            }

            row.append(timeBtn, textSpan);
            row.addEventListener('click', () => {
                this.seekTo(item.segment.startMs);
            });

            fragment.append(row);
        }

        listContainer.append(fragment);
        this.highlightCurrentSegment();
    }

    private highlightCurrentSegment(): void {
        const list = document.getElementById('youtube-side-transcript-list');
        if (!list) {
            return;
        }

        const prev = list.querySelector('[data-current="true"]');
        if (prev) {
            prev.removeAttribute('data-current');
            (prev as HTMLElement).style.background = '';
        }

        if (this.currentSegmentIndex >= 0) {
            const current = list.querySelector(
                `[data-index="${this.currentSegmentIndex}"]`,
            ) as HTMLElement | null;
            if (current) {
                current.setAttribute('data-current', 'true');
                current.style.background =
                    'var(--yt-spec-10-percent-layer, rgba(255,255,255,0.15))';

                if (
                    this.followEnabled &&
                    !this.followPausedByUser &&
                    typeof current.scrollIntoView === 'function'
                ) {
                    current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            }
        }
    }

    private renderChaptersView(): void {
        if (!this.content) {
            return;
        }

        if (!this.chapters || this.chapters.length === 0) {
            const empty = document.createElement('div');
            empty.style.padding = '24px 0';
            empty.style.color = 'var(--yt-spec-text-secondary, #aaa)';
            empty.textContent = 'No chapters available for this video.';
            this.content.append(empty);
            return;
        }

        const listContainer = document.createElement('div');
        listContainer.id = 'youtube-side-chapters-list';
        listContainer.style.display = 'flex';
        listContainer.style.flexDirection = 'column';
        listContainer.style.gap = '6px';

        for (let i = 0; i < this.chapters.length; i++) {
            const ch = this.chapters[i];
            if (!ch) {
                continue;
            }

            const row = document.createElement('div');
            row.setAttribute('data-chapter-index', String(i));
            row.style.display = 'flex';
            row.style.gap = '12px';
            row.style.padding = '8px 10px';
            row.style.borderRadius = '6px';
            row.style.cursor = 'pointer';

            const timeTag = document.createElement('span');
            timeTag.style.color = 'var(--yt-spec-call-to-action, #3ea6ff)';
            timeTag.style.fontFamily = 'monospace';
            timeTag.style.fontSize = '12px';
            timeTag.textContent = formatTimestamp(ch.startMs);

            const titleSpan = document.createElement('span');
            titleSpan.style.fontSize = '13px';
            titleSpan.textContent = ch.title;

            row.append(timeTag, titleSpan);
            row.addEventListener('click', () => {
                this.seekTo(ch.startMs);
            });

            listContainer.append(row);
        }

        this.content.append(listContainer);
        this.highlightCurrentChapter();
    }

    private highlightCurrentChapter(): void {
        const list = document.getElementById('youtube-side-chapters-list');
        if (!list) {
            return;
        }

        const prev = list.querySelector('[data-current="true"]');
        if (prev) {
            prev.removeAttribute('data-current');
            (prev as HTMLElement).style.background = '';
        }

        if (this.currentChapterIndex >= 0) {
            const current = list.querySelector(
                `[data-chapter-index="${this.currentChapterIndex}"]`,
            ) as HTMLElement | null;
            if (current) {
                current.setAttribute('data-current', 'true');
                current.style.background =
                    'var(--yt-spec-10-percent-layer, rgba(255,255,255,0.15))';
            }
        }
    }

    private async renderNotesView(): Promise<void> {
        if (!this.content || !this.currentVideoId) {
            return;
        }

        const study = await loadVideoStudy(this.currentVideoId);
        this.content.textContent = '';

        // Bookmarks section
        const bookmarksHeader = document.createElement('h3');
        bookmarksHeader.style.fontSize = '14px';
        bookmarksHeader.style.margin = '0 0 8px 0';
        bookmarksHeader.textContent = `Bookmarks (${study.bookmarks.length})`;
        this.content.append(bookmarksHeader);

        const bookmarksList = document.createElement('div');
        bookmarksList.style.display = 'flex';
        bookmarksList.style.flexDirection = 'column';
        bookmarksList.style.gap = '8px';
        bookmarksList.style.marginBottom = '16px';

        if (study.bookmarks.length === 0) {
            const noBm = document.createElement('div');
            noBm.style.color = 'var(--yt-spec-text-secondary, #aaa)';
            noBm.style.fontSize = '12px';
            noBm.textContent = 'No bookmarks yet. Click "+ Bookmark" above to capture one.';
            bookmarksList.append(noBm);
        } else {
            study.bookmarks.forEach((bm, index) => {
                const bmRow = document.createElement('div');
                bmRow.style.padding = '8px';
                bmRow.style.background = 'var(--yt-spec-10-percent-layer, rgba(255,255,255,0.05))';
                bmRow.style.borderRadius = '6px';
                bmRow.style.display = 'flex';
                bmRow.style.flexDirection = 'column';
                bmRow.style.gap = '4px';

                const topBar = document.createElement('div');
                topBar.style.display = 'flex';
                topBar.style.justifyContent = 'space-between';
                topBar.style.alignItems = 'center';

                const timeBtn = document.createElement('button');
                timeBtn.className = 'youtube-side-button';
                timeBtn.textContent = formatTimestamp(bm.timeMs);
                timeBtn.addEventListener('click', () => {
                    this.seekTo(bm.timeMs);
                });

                const delBtn = document.createElement('button');
                delBtn.className = 'youtube-side-button';
                delBtn.textContent = '×';
                delBtn.style.color = '#ff6b6b';
                delBtn.addEventListener('click', () => {
                    void (async () => {
                        if (this.currentVideoId) {
                            await removeBookmark(this.currentVideoId, index);
                            void this.renderNotesView();
                        }
                    })();
                });

                topBar.append(timeBtn, delBtn);

                const labelInput = document.createElement('input');
                labelInput.type = 'text';
                labelInput.value = bm.label;
                labelInput.placeholder = 'Label...';
                labelInput.style.background = 'transparent';
                labelInput.style.border = 'none';
                labelInput.style.borderBottom = '1px solid rgba(255,255,255,0.15)';
                labelInput.style.color = '#fff';
                labelInput.style.fontSize = '13px';
                labelInput.addEventListener('change', (e) => {
                    if (this.currentVideoId) {
                        void updateBookmark(this.currentVideoId, index, {
                            label: (e.target as HTMLInputElement).value,
                        });
                    }
                });

                const noteInput = document.createElement('input');
                noteInput.type = 'text';
                noteInput.value = bm.note;
                noteInput.placeholder = 'Note...';
                noteInput.style.background = 'transparent';
                noteInput.style.border = 'none';
                noteInput.style.color = '#ccc';
                noteInput.style.fontSize = '12px';
                noteInput.addEventListener('change', (e) => {
                    if (this.currentVideoId) {
                        void updateBookmark(this.currentVideoId, index, {
                            note: (e.target as HTMLInputElement).value,
                        });
                    }
                });

                bmRow.append(topBar, labelInput, noteInput);
                bookmarksList.append(bmRow);
            });
        }
        this.content.append(bookmarksList);

        // General video notes
        const notesHeader = document.createElement('h3');
        notesHeader.style.fontSize = '14px';
        notesHeader.style.margin = '0 0 8px 0';
        notesHeader.textContent = 'Notes';
        this.content.append(notesHeader);

        const textarea = document.createElement('textarea');
        textarea.value = study.note;
        textarea.placeholder = 'Write personal notes for this video...';
        textarea.rows = 6;
        textarea.style.width = '100%';
        textarea.style.boxSizing = 'border-box';
        textarea.style.padding = '8px';
        textarea.style.background = 'var(--yt-spec-10-percent-layer, rgba(255,255,255,0.05))';
        textarea.style.border = '1px solid rgba(255,255,255,0.15)';
        textarea.style.borderRadius = '6px';
        textarea.style.color = '#fff';
        textarea.style.fontFamily = 'inherit';
        textarea.style.fontSize = '13px';

        textarea.addEventListener('input', (e) => {
            const val = (e.target as HTMLTextAreaElement).value;
            if (typeof this.noteDebounceTimer === 'number') {
                window.clearTimeout(this.noteDebounceTimer);
            }
            this.noteDebounceTimer = window.setTimeout(() => {
                if (this.currentVideoId) {
                    void setVideoNote(this.currentVideoId, val);
                }
            }, 500);
        });
        this.content.append(textarea);

        // Export controls
        const exportBar = document.createElement('div');
        exportBar.style.display = 'flex';
        exportBar.style.gap = '8px';
        exportBar.style.marginTop = '12px';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'youtube-side-button';
        copyBtn.textContent = 'Copy as Markdown';
        copyBtn.addEventListener('click', () => {
            void (async () => {
                const title = document.title || 'YouTube Video';
                const md = exportStudyMarkdown(title, window.location.href, study);
                await navigator.clipboard.writeText(md);
                this.announce('Copied study notes to clipboard');
                copyBtn.textContent = 'Copied!';
                window.setTimeout(() => {
                    copyBtn.textContent = 'Copy as Markdown';
                }, 2000);
            })();
        });

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'youtube-side-button';
        downloadBtn.textContent = 'Download .md';
        downloadBtn.addEventListener('click', () => {
            const title = document.title || 'YouTube Video';
            const md = exportStudyMarkdown(title, window.location.href, study);
            const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${this.currentVideoId || 'video'}-notes.md`;
            a.click();
            URL.revokeObjectURL(url);
        });

        exportBar.append(copyBtn, downloadBtn);
        this.content.append(exportBar);
    }

    private async handleCaptureBookmark(): Promise<void> {
        if (!this.currentVideoId) {
            return;
        }

        const video = document.querySelector('video');
        const timeMs = video ? Math.round(video.currentTime * 1000) : 0;

        let defaultLabel = formatTimestamp(timeMs);
        if (this.chapters) {
            for (const ch of this.chapters) {
                if (ch.startMs <= timeMs) {
                    defaultLabel = ch.title;
                }
            }
        }

        await addBookmark(this.currentVideoId, timeMs, defaultLabel, '');
        this.announce(`Created bookmark at ${formatTimestamp(timeMs)}`);
        if (this.currentView === 'notes') {
            void this.renderNotesView();
        }
    }
}
