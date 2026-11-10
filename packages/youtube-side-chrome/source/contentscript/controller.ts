import { log } from '~common/utilities';
import { isSideRequest, type SideResponse, type SideStatus } from '~data/messages';
import type { Options, OptionsUpdate } from '~data/options';
import {
    DEFAULT_OPTIONS,
    loadOptions,
    normalizeOptions,
    subscribeOptions,
    updateOptions,
} from '~data/options';
import {
    derivePlayerContext,
    type LayoutDecision,
    resolveActivation,
    resolveLayout,
    resolveOptions,
} from './player';
import { StudyPanel } from './study/studyPanel';
import {
    ACTIVE_ATTRIBUTE,
    BACKGROUND_ATTRIBUTE,
    BELOW_ID,
    BLUR_PROPERTY,
    CHAT_ID,
    CHAT_TOP_PROPERTY,
    HEIGHT_PROPERTY,
    INVERTED_ATTRIBUTE,
    MASTHEAD_HEIGHT,
    OFFSET_X_PROPERTY,
    OFFSET_Y_PROPERTY,
    OPACITY_PROPERTY,
    POSITION_ATTRIBUTE,
    RELATED_HIDDEN_ATTRIBUTE,
    RELATED_ID,
    STYLE_ID,
    STYLES,
    SUSPENDED_ATTRIBUTE,
    WIDTH_PROPERTY,
} from './styles';

const OBSERVER_LIFETIME = 10_000;
const RESIZE_COMMIT_DELAY = 200;

// automatic inversion samples the video region behind the panel
const SAMPLE_INTERVAL = 700;
const SAMPLE_SIZE = 32;
const SAMPLE_MIN_OVERLAP = 48;
const SAMPLE_AGREEMENT = 2;
const AUTO_INVERT_ABOVE = 0.6;
const AUTO_REVERT_BELOW = 0.45;

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

    private flexyObserver: MutationObserver | undefined;
    private playerResizeObserver: ResizeObserver | undefined;
    private resizeObserver: ResizeObserver | undefined;
    private resizeTarget: HTMLElement | undefined;
    private resizeTimer: number | undefined;

    private autoInverted = false;
    private sampleVotes = 0;
    private samplerTimer: number | undefined;
    private samplerBroken = false;
    private samplerContext: CanvasRenderingContext2D | null | undefined;

    private unsubscribeOptions: (() => void) | undefined;
    private studyPanel: StudyPanel | null = null;
    private manualOverrideMap = new Map<string, boolean>();
    private explicitSize = false;
    private effectiveVisible = false;
    private suspendReason: 'fullscreen' | 'miniplayer' | null = null;

    public async start(): Promise<void> {
        if (this.started) {
            return;
        }

        this.started = true;
        this.installStyles();

        document.addEventListener('keydown', this.handleKeyDown);
        document.addEventListener('click', this.handleDocumentClick);
        document.addEventListener('yt-navigate-finish', this.handleNavigation);
        document.addEventListener('yt-page-data-updated', this.handleNavigation);
        document.addEventListener('fullscreenchange', this.handleModeChange);
        window.addEventListener('resize', this.scheduleApply);

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

        this.studyPanel = new StudyPanel();
        this.watchFlexyAndPlayer();
        this.evaluateAutoActivation();

        this.scheduleApply();
        this.watchForTargets();
    }

    public stop(): void {
        if (!this.started) {
            return;
        }

        this.started = false;
        document.removeEventListener('keydown', this.handleKeyDown);
        document.removeEventListener('click', this.handleDocumentClick);
        document.removeEventListener('yt-navigate-finish', this.handleNavigation);
        document.removeEventListener('yt-page-data-updated', this.handleNavigation);
        document.removeEventListener('fullscreenchange', this.handleModeChange);
        window.removeEventListener('resize', this.scheduleApply);

        const video = document.querySelector('video');
        if (video) {
            video.removeEventListener('timeupdate', this.handleTimeUpdate);
            video.removeEventListener('enterpictureinpicture', this.handleModeChange);
            video.removeEventListener('leavepictureinpicture', this.handleModeChange);
        }

        chrome.runtime.onMessage.removeListener(this.handleMessage);
        this.unsubscribeOptions?.();
        this.unsubscribeOptions = undefined;
        this.stopObserver();
        this.stopFlexyAndPlayerWatch();

        if (typeof this.frame === 'number') {
            window.cancelAnimationFrame(this.frame);
            this.frame = undefined;
        }

        this.studyPanel?.unmount();
        this.studyPanel = null;

        this.active = false;
        this.applyLayout();
    }

    public getState(): SideStatus {
        const below = getElement(BELOW_ID);
        const context = derivePlayerContext();
        return {
            active: this.active,
            available: below !== null,
            effectiveVisible: this.active && this.effectiveVisible,
            suspendReason: this.suspendReason,
            context,
        };
    }

    public setActive(active: boolean, isManual = false): SideStatus {
        this.active = active;
        const context = derivePlayerContext();
        if (isManual && context.videoId) {
            if (this.manualOverrideMap.size >= 100) {
                const firstKey = this.manualOverrideMap.keys().next().value;
                if (firstKey) {
                    this.manualOverrideMap.delete(firstKey);
                }
            }
            this.manualOverrideMap.set(context.videoId, active);
        }

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

        const context = derivePlayerContext();
        const effectiveOptions = resolveOptions(this.options, context);

        const decision: LayoutDecision = resolveLayout({
            anchor: effectiveOptions.layoutAnchor,
            side: effectiveOptions.left ? 'left' : 'right',
            width: effectiveOptions.width,
            height: effectiveOptions.height,
            explicitSize: this.explicitSize,
            mode: context.mode,
            playerRect: context.playerRect,
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
            },
        });

        this.effectiveVisible = decision.visible;
        this.suspendReason = decision.suspendReason;

        const chatTop =
            this.active && this.effectiveVisible && chat
                ? Math.max(0, chat.getBoundingClientRect().top + window.scrollY - MASTHEAD_HEIGHT)
                : 0;

        if (below) {
            if (this.active) {
                below.setAttribute(ACTIVE_ATTRIBUTE, 'true');
                below.setAttribute(POSITION_ATTRIBUTE, effectiveOptions.left ? 'left' : 'right');
                below.setAttribute(BACKGROUND_ATTRIBUTE, effectiveOptions.background);
                below.setAttribute(INVERTED_ATTRIBUTE, String(this.inverted(effectiveOptions)));

                if (decision.visible) {
                    below.removeAttribute(SUSPENDED_ATTRIBUTE);
                } else {
                    below.setAttribute(SUSPENDED_ATTRIBUTE, 'true');
                }

                below.style.setProperty(WIDTH_PROPERTY, `${decision.width}px`);
                below.style.setProperty(HEIGHT_PROPERTY, `${decision.height}px`);
                below.style.setProperty(BLUR_PROPERTY, `${effectiveOptions.blur}px`);
                below.style.setProperty(OPACITY_PROPERTY, `${effectiveOptions.opacity}%`);

                this.correctPanelOffset(below, decision, effectiveOptions);

                // Mount or sync Study panel
                if (effectiveOptions.studyEnabled && this.studyPanel) {
                    this.studyPanel.mount(below, context.videoId);
                } else {
                    this.studyPanel?.unmount();
                }
            } else {
                below.removeAttribute(ACTIVE_ATTRIBUTE);
                below.removeAttribute(POSITION_ATTRIBUTE);
                below.removeAttribute(BACKGROUND_ATTRIBUTE);
                below.removeAttribute(INVERTED_ATTRIBUTE);
                below.removeAttribute(SUSPENDED_ATTRIBUTE);
                below.style.removeProperty(WIDTH_PROPERTY);
                below.style.removeProperty(HEIGHT_PROPERTY);
                below.style.removeProperty(BLUR_PROPERTY);
                below.style.removeProperty(OPACITY_PROPERTY);
                below.style.removeProperty(OFFSET_X_PROPERTY);
                below.style.removeProperty(OFFSET_Y_PROPERTY);
                below.style.removeProperty('width');
                below.style.removeProperty('height');

                this.studyPanel?.unmount();
            }
        }

        this.watchResize(this.active && this.effectiveVisible ? below : null);
        this.updateSampler(effectiveOptions);

        if (chat) {
            if (this.active && this.effectiveVisible) {
                chat.setAttribute(ACTIVE_ATTRIBUTE, 'true');
                chat.style.setProperty(CHAT_TOP_PROPERTY, `-${chatTop}px`);
            } else {
                chat.removeAttribute(ACTIVE_ATTRIBUTE);
                chat.style.removeProperty(CHAT_TOP_PROPERTY);
            }
        }

        if (related) {
            if (effectiveOptions.recommendations) {
                related.removeAttribute(RELATED_HIDDEN_ATTRIBUTE);
            } else {
                related.setAttribute(RELATED_HIDDEN_ATTRIBUTE, 'true');
            }
        }

        if (!this.needsTargets()) {
            this.stopObserver();
        }
    }

    private correctPanelOffset(
        below: HTMLElement,
        decision: LayoutDecision,
        options: Options,
    ): void {
        below.style.setProperty(OFFSET_X_PROPERTY, '0px');
        below.style.setProperty(OFFSET_Y_PROPERTY, '0px');

        const rect = below.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
            return;
        }

        const targetTop = decision.top;
        const targetSide = decision.sideOffset;

        const offsetX = options.left
            ? targetSide - rect.left
            : rect.right - (window.innerWidth - targetSide);

        const offsetY = targetTop - rect.top;
        below.style.setProperty(OFFSET_X_PROPERTY, `${offsetX}px`);
        below.style.setProperty(OFFSET_Y_PROPERTY, `${offsetY}px`);
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

    private watchFlexyAndPlayer(): void {
        this.stopFlexyAndPlayerWatch();

        const flexy = document.querySelector('ytd-watch-flexy');
        if (flexy) {
            this.flexyObserver = new MutationObserver(() => {
                this.scheduleApply();
            });
            this.flexyObserver.observe(flexy, {
                attributes: true,
                attributeFilter: ['theater', 'fullscreen', 'miniplayer'],
            });
        }

        const playerElement =
            document.getElementById('player') || document.querySelector('#ytd-player');
        if (playerElement && typeof ResizeObserver !== 'undefined') {
            this.playerResizeObserver = new ResizeObserver(() => {
                this.scheduleApply();
            });
            this.playerResizeObserver.observe(playerElement);
        }

        const video = document.querySelector('video');
        if (video) {
            video.addEventListener('timeupdate', this.handleTimeUpdate);
            video.addEventListener('enterpictureinpicture', this.handleModeChange);
            video.addEventListener('leavepictureinpicture', this.handleModeChange);
        }
    }

    private stopFlexyAndPlayerWatch(): void {
        this.flexyObserver?.disconnect();
        this.flexyObserver = undefined;

        this.playerResizeObserver?.disconnect();
        this.playerResizeObserver = undefined;
    }

    private handleTimeUpdate = (): void => {
        const video = document.querySelector('video');
        if (video && this.studyPanel) {
            this.studyPanel.updateTime(video.currentTime * 1000);
        }
    };

    private handleModeChange = (): void => {
        this.scheduleApply();
    };

    private inverted(effectiveOptions: Options): boolean {
        return (
            effectiveOptions.invertText === 'on' ||
            (effectiveOptions.invertText === 'auto' && this.autoInverted)
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

    private updateSampler(effectiveOptions = this.options): void {
        const shouldSample =
            this.active &&
            this.effectiveVisible &&
            effectiveOptions.invertText === 'auto' &&
            !this.samplerBroken;

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

        this.explicitSize = true;

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

    private evaluateAutoActivation(): void {
        const context = derivePlayerContext();
        if (!context.videoId) {
            return;
        }

        const manualOverride = this.manualOverrideMap.get(context.videoId) ?? null;
        const channelRule = context.channelKey
            ? (this.options.channelRules[context.channelKey] ?? null)
            : null;

        const decision = resolveActivation({
            manualOverride,
            channelRule,
            autoActivate: this.options.autoActivate,
            context,
        });

        if (decision === 'activate' && !this.active) {
            this.active = true;
            if (this.options.studyAutoOpen !== 'off' && this.studyPanel) {
                this.studyPanel.setView(this.options.studyAutoOpen);
            }
        } else if (decision === 'deactivate' && this.active) {
            this.active = false;
        }
    }

    private handleMessage = (
        message: unknown,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response: SideResponse) => void,
    ): boolean => {
        if (!isSideRequest(message)) {
            return false;
        }

        if (message.type === 'APPLY_CHANNEL_RULE') {
            const nextRules = { ...this.options.channelRules };
            if (message.rule === null) {
                delete nextRules[message.channelKey];
            } else {
                nextRules[message.channelKey] = message.rule;
            }
            this.patchOptions({ channelRules: nextRules });
            sendResponse({ ok: true, status: this.getState() });
            return false;
        }

        const status =
            message.type === 'SET_ACTIVE' ? this.setActive(message.active, true) : this.getState();

        sendResponse({ ok: true, status });
        return false;
    };

    private handleNavigation = (): void => {
        this.watchFlexyAndPlayer();
        const context = derivePlayerContext();
        if (this.studyPanel) {
            void this.studyPanel.handleVideoChange(context.videoId);
        }
        this.evaluateAutoActivation();
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
                this.setActive(!this.active, true);
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
            case 'KeyT':
                if (!this.active || !this.options.studyEnabled) {
                    return;
                }
                event.preventDefault();
                this.studyPanel?.cycleView();
                break;
            default:
                break;
        }
    };

    private handleDocumentClick = (event: MouseEvent): void => {
        const target = event.target as HTMLElement | null;
        if (!target || target.closest('#youtube-side-study')) {
            return;
        }

        const transcriptBtn =
            target.closest('ytd-video-description-transcript-section-renderer button') ||
            target.closest('button[aria-label*="transcript" i]') ||
            (target.closest('button')?.textContent?.toLowerCase().includes('transcript')
                ? target.closest('button')
                : null);

        if (transcriptBtn) {
            if (this.options.studyEnabled && this.studyPanel) {
                this.setActive(true, true);
                this.studyPanel.setView('transcript');
            }
        }
    };
}
