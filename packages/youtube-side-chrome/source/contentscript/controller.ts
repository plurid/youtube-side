import { log } from '~common/utilities';
import { isSideRequest, type SideResponse } from '~data/messages';
import type { Options, OptionsUpdate } from '~data/options';
import {
    DEFAULT_OPTIONS,
    HEIGHT_MIN,
    loadOptions,
    normalizeOptions,
    subscribeOptions,
    updateOptions,
    WIDTH_MIN,
} from '~data/options';

const BELOW_ID = 'below';
const CHAT_ID = 'chat-container';
const RELATED_ID = 'related';

const STYLE_ID = 'youtube-side-styles';
const ACTIVE_ATTRIBUTE = 'data-youtube-side-active';
const POSITION_ATTRIBUTE = 'data-youtube-side-position';
const BACKGROUND_ATTRIBUTE = 'data-youtube-side-background';
const INVERTED_ATTRIBUTE = 'data-youtube-side-inverted';
const RELATED_HIDDEN_ATTRIBUTE = 'data-youtube-side-hidden';

const WIDTH_PROPERTY = '--youtube-side-width';
const HEIGHT_PROPERTY = '--youtube-side-height';
const BLUR_PROPERTY = '--youtube-side-blur';
const OPACITY_PROPERTY = '--youtube-side-opacity';
const CHAT_TOP_PROPERTY = '--youtube-side-chat-top';

// the height of YouTube's masthead; the panel sits flush against it
const MASTHEAD_HEIGHT = 56;

const OBSERVER_LIFETIME = 10_000;
const RESIZE_COMMIT_DELAY = 200;

// automatic inversion samples the video region behind the panel: a small
// readback at a slow cadence, with hysteresis so cuts do not cause flicker
const SAMPLE_INTERVAL = 700;
const SAMPLE_SIZE = 32;
const SAMPLE_MIN_OVERLAP = 48;
const SAMPLE_AGREEMENT = 2;
const AUTO_INVERT_ABOVE = 0.6;
const AUTO_REVERT_BELOW = 0.45;

// width and height stay overridable (no !important) so the native resize
// handle can drag them live; the min/max bounds keep both sources sane
const STYLES = `
#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"] {
    box-sizing: border-box !important;
    position: fixed !important;
    top: ${MASTHEAD_HEIGHT}px !important;
    z-index: 2019 !important;
    overflow: auto !important;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    padding: 16px !important;
    width: var(${WIDTH_PROPERTY});
    height: var(${HEIGHT_PROPERTY});
    min-width: ${WIDTH_MIN}px !important;
    min-height: ${HEIGHT_MIN}px !important;
    max-width: calc(100vw - 48px) !important;
    max-height: calc(100vh - ${MASTHEAD_HEIGHT}px) !important;
    resize: both;
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${POSITION_ATTRIBUTE}="left"] {
    left: 24px !important;
    right: auto !important;
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${POSITION_ATTRIBUTE}="right"] {
    right: 24px !important;
    left: auto !important;
    direction: rtl;
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${POSITION_ATTRIBUTE}="right"] > * {
    direction: ltr;
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${BACKGROUND_ATTRIBUTE}="transparent"] {
    background: transparent !important;
    backdrop-filter: none !important;
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${BACKGROUND_ATTRIBUTE}="opaque"] {
    background: color-mix(
        in srgb,
        var(--yt-spec-base-background, #0f0f0f) var(${OPACITY_PROPERTY}, 100%),
        transparent
    ) !important;
    backdrop-filter: blur(var(${BLUR_PROPERTY}, 0px)) !important;
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${INVERTED_ATTRIBUTE}="true"] > * {
    filter: invert(1) hue-rotate(180deg);
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${INVERTED_ATTRIBUTE}="true"] :is(img, video, canvas) {
    filter: invert(1) hue-rotate(180deg);
}

#${CHAT_ID}[${ACTIVE_ATTRIBUTE}="true"] {
    box-sizing: border-box !important;
    position: absolute !important;
    top: var(${CHAT_TOP_PROPERTY}) !important;
    width: min(400px, calc(100vw - 48px)) !important;
}

#${RELATED_ID}[${RELATED_HIDDEN_ATTRIBUTE}="true"] {
    display: none !important;
}
`;

const isEditableTarget = (target: EventTarget | null) =>
    target instanceof Element &&
    target.closest('input, textarea, select, button, [contenteditable="true"]') !== null;

const getElement = (id: string) => document.getElementById(id) as HTMLElement | null;

export class YouTubeSideController {
    private active = false;
    private options: Options = { ...DEFAULT_OPTIONS };
    private started = false;
    private frame: number | undefined;
    private observer: MutationObserver | undefined;
    private observerTimer: number | undefined;
    private resizeObserver: ResizeObserver | undefined;
    private resizeTarget: HTMLElement | undefined;
    private resizeTimer: number | undefined;
    private autoInverted = false;
    private sampleVotes = 0;
    private samplerTimer: number | undefined;
    private samplerBroken = false;
    private samplerContext: CanvasRenderingContext2D | null | undefined;
    private unsubscribeOptions: (() => void) | undefined;

    public async start(): Promise<void> {
        if (this.started) {
            return;
        }

        this.started = true;
        this.installStyles();

        document.addEventListener('keydown', this.handleKeyDown);
        document.addEventListener('yt-navigate-finish', this.handleNavigation);
        document.addEventListener('yt-page-data-updated', this.handleNavigation);
        chrome.runtime.onMessage.addListener(this.handleMessage);
        this.unsubscribeOptions = subscribeOptions((options) => {
            this.options = options;
            this.scheduleApply();
            this.watchForTargets();
        });

        try {
            this.options = await loadOptions();
        } catch (error) {
            log('Could not load options.', error);
        }

        this.scheduleApply();
        this.watchForTargets();
    }

    public stop(): void {
        if (!this.started) {
            return;
        }

        this.started = false;
        document.removeEventListener('keydown', this.handleKeyDown);
        document.removeEventListener('yt-navigate-finish', this.handleNavigation);
        document.removeEventListener('yt-page-data-updated', this.handleNavigation);
        chrome.runtime.onMessage.removeListener(this.handleMessage);
        this.unsubscribeOptions?.();
        this.unsubscribeOptions = undefined;
        this.stopObserver();

        if (typeof this.frame === 'number') {
            window.cancelAnimationFrame(this.frame);
            this.frame = undefined;
        }

        this.active = false;
        this.applyLayout();
    }

    public getState() {
        return {
            active: this.active,
            available: getElement(BELOW_ID) !== null,
        };
    }

    public setActive(active: boolean) {
        this.active = active;
        this.scheduleApply();
        this.watchForTargets();

        return this.getState();
    }

    private installStyles(): void {
        if (document.getElementById(STYLE_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLES;
        (document.head || document.documentElement).append(style);
    }

    private scheduleApply = (): void => {
        if (typeof this.frame === 'number') {
            return;
        }

        this.frame = window.requestAnimationFrame(() => {
            this.frame = undefined;
            this.applyLayout();
        });
    };

    private applyLayout(): void {
        const below = getElement(BELOW_ID);
        const chat = getElement(CHAT_ID);
        const related = getElement(RELATED_ID);

        const chatTop =
            this.active && chat
                ? Math.max(0, chat.getBoundingClientRect().top + window.scrollY - MASTHEAD_HEIGHT)
                : 0;

        if (below) {
            if (this.active) {
                below.setAttribute(ACTIVE_ATTRIBUTE, 'true');
                below.setAttribute(POSITION_ATTRIBUTE, this.options.left ? 'left' : 'right');
                below.setAttribute(BACKGROUND_ATTRIBUTE, this.options.background);
                below.setAttribute(INVERTED_ATTRIBUTE, String(this.inverted()));
                below.style.setProperty(WIDTH_PROPERTY, `${this.options.width}px`);
                below.style.setProperty(HEIGHT_PROPERTY, `${this.options.height}px`);
                below.style.setProperty(BLUR_PROPERTY, `${this.options.blur}px`);
                below.style.setProperty(OPACITY_PROPERTY, `${this.options.opacity}%`);
            } else {
                below.removeAttribute(ACTIVE_ATTRIBUTE);
                below.removeAttribute(POSITION_ATTRIBUTE);
                below.removeAttribute(BACKGROUND_ATTRIBUTE);
                below.removeAttribute(INVERTED_ATTRIBUTE);
                below.style.removeProperty(WIDTH_PROPERTY);
                below.style.removeProperty(HEIGHT_PROPERTY);
                below.style.removeProperty(BLUR_PROPERTY);
                below.style.removeProperty(OPACITY_PROPERTY);
                below.style.removeProperty('width');
                below.style.removeProperty('height');
            }
        }

        this.watchResize(this.active ? below : null);
        this.updateSampler();

        if (chat) {
            if (this.active) {
                chat.setAttribute(ACTIVE_ATTRIBUTE, 'true');
                chat.style.setProperty(CHAT_TOP_PROPERTY, `-${chatTop}px`);
            } else {
                chat.removeAttribute(ACTIVE_ATTRIBUTE);
                chat.style.removeProperty(CHAT_TOP_PROPERTY);
            }
        }

        if (related) {
            if (this.options.recommendations) {
                related.removeAttribute(RELATED_HIDDEN_ATTRIBUTE);
            } else {
                related.setAttribute(RELATED_HIDDEN_ATTRIBUTE, 'true');
            }
        }

        if (!this.needsTargets()) {
            this.stopObserver();
        }
    }

    private needsTargets(): boolean {
        const needsBelow = this.active && !getElement(BELOW_ID);
        const needsRelated = !this.options.recommendations && !getElement(RELATED_ID);

        return Boolean(needsBelow || needsRelated);
    }

    private watchForTargets(): void {
        this.stopObserver();

        if (!this.needsTargets()) {
            return;
        }

        const root = document.querySelector('ytd-app') || document.documentElement;
        if (!root) {
            return;
        }

        this.observer = new MutationObserver(() => {
            this.scheduleApply();
        });
        this.observer.observe(root, {
            childList: true,
            subtree: true,
        });

        this.observerTimer = window.setTimeout(() => {
            this.stopObserver();
        }, OBSERVER_LIFETIME);
    }

    private stopObserver(): void {
        this.observer?.disconnect();
        this.observer = undefined;

        if (typeof this.observerTimer === 'number') {
            window.clearTimeout(this.observerTimer);
            this.observerTimer = undefined;
        }
    }

    private inverted(): boolean {
        return (
            this.options.invertText === 'on' ||
            (this.options.invertText === 'auto' && this.autoInverted)
        );
    }

    private sampleContext(): CanvasRenderingContext2D | null {
        if (this.samplerContext === undefined) {
            this.samplerContext = document
                .createElement('canvas')
                .getContext('2d', { willReadFrequently: true });

            if (this.samplerContext) {
                this.samplerContext.canvas.width = SAMPLE_SIZE;
                this.samplerContext.canvas.height = SAMPLE_SIZE;
            }
        }

        return this.samplerContext;
    }

    private updateSampler(): void {
        const shouldSample =
            this.active && this.options.invertText === 'auto' && !this.samplerBroken;

        if (shouldSample) {
            if (typeof this.samplerTimer !== 'number') {
                this.samplerTimer = window.setInterval(() => {
                    this.samplePanelBrightness();
                }, SAMPLE_INTERVAL);
                this.samplePanelBrightness();
            }
            return;
        }

        if (typeof this.samplerTimer === 'number') {
            window.clearInterval(this.samplerTimer);
            this.samplerTimer = undefined;
        }

        this.autoInverted = false;
        this.sampleVotes = 0;
    }

    private samplePanelBrightness(): void {
        if (document.hidden) {
            return;
        }

        const below = getElement(BELOW_ID);
        const video = document.querySelector('video');

        if (
            !below ||
            !(video instanceof HTMLVideoElement) ||
            video.readyState < 2 ||
            !video.videoWidth ||
            !video.videoHeight
        ) {
            this.voteAutoInverted(false);
            return;
        }

        const panel = below.getBoundingClientRect();
        const frame = video.getBoundingClientRect();
        const left = Math.max(panel.left, frame.left);
        const right = Math.min(panel.right, frame.right);
        const top = Math.max(panel.top, frame.top);
        const bottom = Math.min(panel.bottom, frame.bottom);

        if (
            frame.width === 0 ||
            frame.height === 0 ||
            right - left < SAMPLE_MIN_OVERLAP ||
            bottom - top < SAMPLE_MIN_OVERLAP
        ) {
            this.voteAutoInverted(false);
            return;
        }

        const context = this.sampleContext();
        if (!context) {
            this.samplerBroken = true;
            this.updateSampler();
            this.scheduleApply();
            return;
        }

        const scaleX = video.videoWidth / frame.width;
        const scaleY = video.videoHeight / frame.height;

        let luminance = 0;
        try {
            context.drawImage(
                video,
                (left - frame.left) * scaleX,
                (top - frame.top) * scaleY,
                (right - left) * scaleX,
                (bottom - top) * scaleY,
                0,
                0,
                SAMPLE_SIZE,
                SAMPLE_SIZE,
            );

            const pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
            let total = 0;
            for (let index = 0; index < pixels.length; index += 4) {
                total +=
                    0.2126 * (pixels[index] ?? 0) +
                    0.7152 * (pixels[index + 1] ?? 0) +
                    0.0722 * (pixels[index + 2] ?? 0);
            }
            luminance = total / (pixels.length / 4) / 255;
        } catch (error) {
            this.samplerBroken = true;
            log('Could not sample the video for automatic inversion.', error);
            this.updateSampler();
            this.scheduleApply();
            return;
        }

        this.voteAutoInverted(
            this.autoInverted ? luminance >= AUTO_REVERT_BELOW : luminance > AUTO_INVERT_ABOVE,
        );
    }

    private voteAutoInverted(next: boolean): void {
        if (next === this.autoInverted) {
            this.sampleVotes = 0;
            return;
        }

        this.sampleVotes += 1;
        if (this.sampleVotes < SAMPLE_AGREEMENT) {
            return;
        }

        this.sampleVotes = 0;
        this.autoInverted = next;
        this.scheduleApply();
    }

    private watchResize(below: HTMLElement | null): void {
        if (!below) {
            this.stopResizeWatch();
            return;
        }

        if (typeof ResizeObserver === 'undefined' || this.resizeTarget === below) {
            return;
        }

        this.stopResizeWatch();
        this.resizeTarget = below;
        this.resizeObserver = new ResizeObserver(() => {
            this.schedulePanelCommit();
        });
        this.resizeObserver.observe(below);
    }

    private stopResizeWatch(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
        this.resizeTarget = undefined;

        if (typeof this.resizeTimer === 'number') {
            window.clearTimeout(this.resizeTimer);
            this.resizeTimer = undefined;
        }
    }

    private schedulePanelCommit(): void {
        const below = this.resizeTarget;

        // the browser writes inline width/height only while the user drags
        // the resize handle; every other resize is one the extension applied
        if (!below || (!below.style.width && !below.style.height)) {
            return;
        }

        if (typeof this.resizeTimer === 'number') {
            window.clearTimeout(this.resizeTimer);
        }

        this.resizeTimer = window.setTimeout(() => {
            this.resizeTimer = undefined;
            this.commitPanelSize();
        }, RESIZE_COMMIT_DELAY);
    }

    private commitPanelSize(): void {
        const below = this.resizeTarget;
        if (!below) {
            return;
        }

        const width = Math.round(below.offsetWidth);
        const height = Math.round(below.offsetHeight);

        below.style.setProperty(WIDTH_PROPERTY, `${width}px`);
        below.style.setProperty(HEIGHT_PROPERTY, `${height}px`);
        below.style.removeProperty('width');
        below.style.removeProperty('height');

        if (width !== this.options.width || height !== this.options.height) {
            this.patchOptions({ width, height });
        }
    }

    private patchOptions(update: OptionsUpdate): void {
        this.options = normalizeOptions({
            ...this.options,
            ...update,
        });
        this.scheduleApply();
        this.watchForTargets();

        void updateOptions(update)
            .then((options) => {
                this.options = options;
                this.scheduleApply();
            })
            .catch((error) => {
                log('Could not update options.', error);
            });
    }

    private handleMessage = (
        message: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response: SideResponse) => void,
    ): boolean => {
        if (!isSideRequest(message)) {
            return false;
        }

        const status =
            message.type === 'SET_ACTIVE' ? this.setActive(message.active) : this.getState();
        sendResponse({ ok: true, status });
        return false;
    };

    private handleNavigation = (): void => {
        this.scheduleApply();
        this.watchForTargets();
    };

    private handleKeyDown = (event: KeyboardEvent): void => {
        if (
            event.defaultPrevented ||
            event.repeat ||
            event.isComposing ||
            !event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            isEditableTarget(event.target)
        ) {
            return;
        }

        switch (event.code) {
            case 'KeyS':
                event.preventDefault();
                this.setActive(!this.active);
                break;
            case 'KeyB':
                if (!this.active) {
                    return;
                }
                event.preventDefault();
                this.patchOptions({
                    background:
                        this.options.background === 'transparent' ? 'opaque' : 'transparent',
                });
                break;
            case 'KeyL':
                if (!this.active) {
                    return;
                }
                event.preventDefault();
                this.patchOptions({ left: !this.options.left });
                break;
            case 'KeyR':
                event.preventDefault();
                this.patchOptions({ recommendations: !this.options.recommendations });
                break;
            default:
                break;
        }
    };
}
