import type { Bookmark } from '~data/study';
import { loadVideoStudy, subscribeVideoStudy } from '~data/studyStore';
import { getMainVideo, getProgressBar, isAdShowing } from '../page';
import { MARKERS_CLASS } from '../styles';

/**
 * Bookmark ticks on YouTube's progress bar. They sit on the track itself and
 * ignore the pointer, so YouTube's scrubbing and preview keep working, and
 * they leave the space below the bar to other extensions (PluriSpeed draws
 * its speaker strip there). Hidden while an ad plays and for live streams,
 * whose bar does not describe the video's timeline.
 */
export class BookmarkMarkers {
    private readonly container: HTMLElement;
    private videoId: string | null = null;
    private bookmarks: readonly Bookmark[] = [];
    private enabled = true;
    private renderedKey = '';
    private loadToken = 0;
    private unsubscribe: (() => void) | undefined;

    public constructor() {
        this.container = document.createElement('div');
        this.container.className = MARKERS_CLASS;
        this.container.setAttribute('aria-hidden', 'true');
    }

    public setVideo(videoId: string | null): void {
        if (videoId === this.videoId) {
            return;
        }

        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.videoId = videoId;
        this.bookmarks = [];
        this.render();

        if (!videoId) {
            return;
        }

        const token = ++this.loadToken;
        this.unsubscribe = subscribeVideoStudy(videoId, (study) => {
            this.loadToken += 1;
            this.bookmarks = study.bookmarks;
            this.render();
        });
        void loadVideoStudy(videoId).then((study) => {
            // a change notification or another video took over meanwhile
            if (token === this.loadToken && videoId === this.videoId) {
                this.bookmarks = study.bookmarks;
                this.render();
            }
        });
    }

    public setEnabled(enabled: boolean): void {
        if (enabled !== this.enabled) {
            this.enabled = enabled;
            this.render();
        }
    }

    /** Cheap when nothing changed; called on every layout pass to follow the player. */
    public render(): void {
        const bar = getProgressBar();
        const durationMs = (getMainVideo()?.duration ?? Number.NaN) * 1000;

        if (
            !this.enabled ||
            !this.videoId ||
            !bar ||
            this.bookmarks.length === 0 ||
            !Number.isFinite(durationMs) ||
            durationMs <= 0 ||
            isAdShowing()
        ) {
            this.container.remove();
            this.renderedKey = '';
            return;
        }

        const key = `${durationMs}|${this.bookmarks.map((bookmark) => bookmark.timeMs).join(',')}`;
        if (key !== this.renderedKey) {
            this.renderedKey = key;
            this.container.replaceChildren(
                ...this.bookmarks
                    .filter((bookmark) => bookmark.timeMs <= durationMs)
                    .map((bookmark) => {
                        const tick = document.createElement('div');
                        tick.className = `${MARKERS_CLASS}-tick`;
                        tick.style.left = `${((bookmark.timeMs / durationMs) * 100).toFixed(3)}%`;
                        return tick;
                    }),
            );
        }

        if (this.container.parentElement !== bar) {
            bar.append(this.container);
        }
    }

    public destroy(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.loadToken += 1;
        this.videoId = null;
        this.container.remove();
    }
}
