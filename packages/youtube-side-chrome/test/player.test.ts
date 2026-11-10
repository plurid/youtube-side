import { afterEach, describe, expect, it } from '@jest/globals';

import {
    derivePlayerContext,
    type LayoutRequest,
    type PlayerContext,
    resolveActivation,
    resolveLayout,
    resolveOptions,
} from '~contentscript/player';
import { DEFAULT_OPTIONS, type Options } from '~data/options';

describe('player & layout module', () => {
    describe('resolveLayout', () => {
        const defaultRequest: LayoutRequest = {
            anchor: 'viewport',
            side: 'left',
            width: 500,
            height: 550,
            explicitSize: false,
            mode: 'default',
            playerRect: null,
            viewport: { width: 1440, height: 900 },
        };

        it('suspends in fullscreen and miniplayer modes', () => {
            const fsDecision = resolveLayout({
                ...defaultRequest,
                mode: 'fullscreen',
            });
            expect(fsDecision.visible).toBe(false);
            expect(fsDecision.suspendReason).toBe('fullscreen');

            const miniDecision = resolveLayout({
                ...defaultRequest,
                mode: 'miniplayer',
            });
            expect(miniDecision.visible).toBe(false);
            expect(miniDecision.suspendReason).toBe('miniplayer');
        });

        it('does not suspend in pip or theater mode', () => {
            const pipDecision = resolveLayout({
                ...defaultRequest,
                mode: 'pip',
            });
            expect(pipDecision.visible).toBe(true);
            expect(pipDecision.suspendReason).toBeNull();

            const theaterDecision = resolveLayout({
                ...defaultRequest,
                mode: 'theater',
            });
            expect(theaterDecision.visible).toBe(true);
            expect(theaterDecision.suspendReason).toBeNull();
        });

        it('resolves viewport anchor correctly', () => {
            const decision = resolveLayout(defaultRequest);
            expect(decision.visible).toBe(true);
            expect(decision.top).toBe(56);
            expect(decision.sideOffset).toBe(0);
            expect(decision.width).toBe(500);
            expect(decision.height).toBe(550);
        });

        it('falls back to viewport anchor if playerRect is null', () => {
            const decision = resolveLayout({
                ...defaultRequest,
                anchor: 'player',
                playerRect: null,
            });
            expect(decision.visible).toBe(true);
            expect(decision.top).toBe(56);
            expect(decision.sideOffset).toBe(0);
        });

        it('resolves player anchor geometry on left and right sides', () => {
            const playerRect = {
                top: 70,
                left: 100,
                right: 900,
                bottom: 550,
                width: 800,
                height: 480,
            };

            const leftDecision = resolveLayout({
                ...defaultRequest,
                anchor: 'player',
                side: 'left',
                playerRect,
            });
            expect(leftDecision.visible).toBe(true);
            expect(leftDecision.top).toBe(70);
            expect(leftDecision.sideOffset).toBe(100);
            expect(leftDecision.height).toBe(480); // derives height from playerRect when explicitSize is false

            const rightDecision = resolveLayout({
                ...defaultRequest,
                anchor: 'player',
                side: 'right',
                playerRect,
            });
            expect(rightDecision.sideOffset).toBe(1440 - 900); // viewport.width - playerRect.right
        });

        it('preserves explicit user height when explicitSize is true', () => {
            const playerRect = {
                top: 70,
                left: 100,
                right: 900,
                bottom: 550,
                width: 800,
                height: 480,
            };

            const decision = resolveLayout({
                ...defaultRequest,
                anchor: 'player',
                playerRect,
                height: 600,
                explicitSize: true,
            });
            expect(decision.height).toBe(600);
        });

        it('clamps width and height within safe bounds and viewport limits', () => {
            const decision = resolveLayout({
                ...defaultRequest,
                width: 50, // below WIDTH_MIN
                height: 3000, // above HEIGHT_MAX
                viewport: { width: 400, height: 600 },
            });
            expect(decision.width).toBe(320); // WIDTH_MIN
            expect(decision.height).toBe(544); // 600 - 56
        });
    });

    describe('resolveActivation', () => {
        const dummyContext: PlayerContext = {
            videoId: 'v123',
            channelKey: '/c/testchannel',
            mode: 'default',
            kind: 'standard',
            durationSeconds: 600,
            playerRect: null,
        };

        it('manual override takes highest precedence', () => {
            expect(
                resolveActivation({
                    manualOverride: true,
                    channelRule: 'never',
                    autoActivate: 'never',
                    context: dummyContext,
                }),
            ).toBe('activate');

            expect(
                resolveActivation({
                    manualOverride: false,
                    channelRule: 'always',
                    autoActivate: 'always',
                    context: dummyContext,
                }),
            ).toBe('deactivate');
        });

        it('channel rules take second precedence', () => {
            expect(
                resolveActivation({
                    manualOverride: null,
                    channelRule: 'always',
                    autoActivate: 'never',
                    context: dummyContext,
                }),
            ).toBe('activate');

            expect(
                resolveActivation({
                    manualOverride: null,
                    channelRule: 'never',
                    autoActivate: 'always',
                    context: dummyContext,
                }),
            ).toBe('deactivate');
        });

        it('global autoActivate rules evaluate correctly', () => {
            expect(
                resolveActivation({
                    manualOverride: null,
                    channelRule: null,
                    autoActivate: 'always',
                    context: dummyContext,
                }),
            ).toBe('activate');

            expect(
                resolveActivation({
                    manualOverride: null,
                    channelRule: null,
                    autoActivate: 'never',
                    context: dummyContext,
                }),
            ).toBe('stay');

            // live autoActivate
            expect(
                resolveActivation({
                    manualOverride: null,
                    channelRule: null,
                    autoActivate: 'live',
                    context: { ...dummyContext, kind: 'live' },
                }),
            ).toBe('activate');
            expect(
                resolveActivation({
                    manualOverride: null,
                    channelRule: null,
                    autoActivate: 'live',
                    context: { ...dummyContext, kind: 'standard' },
                }),
            ).toBe('stay');

            // long autoActivate
            expect(
                resolveActivation({
                    manualOverride: null,
                    channelRule: null,
                    autoActivate: 'long',
                    context: { ...dummyContext, kind: 'standard', durationSeconds: 1500 },
                }),
            ).toBe('activate');
            expect(
                resolveActivation({
                    manualOverride: null,
                    channelRule: null,
                    autoActivate: 'long',
                    context: { ...dummyContext, kind: 'standard', durationSeconds: 600 },
                }),
            ).toBe('stay');
            expect(
                resolveActivation({
                    manualOverride: null,
                    channelRule: null,
                    autoActivate: 'long',
                    context: { ...dummyContext, kind: 'live', durationSeconds: null },
                }),
            ).toBe('stay');
        });
    });

    describe('resolveOptions', () => {
        const baseOptions: Options = {
            ...DEFAULT_OPTIONS,
            width: 500,
            presets: {
                standard: { width: 600 },
                live: { background: 'opaque', opacity: 90 },
                theater: { width: 700, blur: 8 },
            },
        };

        it('overlays presets matching context', () => {
            const standardResolved = resolveOptions(baseOptions, {
                videoId: 'abc',
                channelKey: null,
                mode: 'default',
                kind: 'standard',
                durationSeconds: 100,
                playerRect: null,
            });
            expect(standardResolved.width).toBe(600);

            const liveResolved = resolveOptions(baseOptions, {
                videoId: 'abc',
                channelKey: null,
                mode: 'default',
                kind: 'live',
                durationSeconds: null,
                playerRect: null,
            });
            expect(liveResolved.background).toBe('opaque');
            expect(liveResolved.opacity).toBe(90);

            // Stacking live and theater (theater last)
            const liveTheaterResolved = resolveOptions(baseOptions, {
                videoId: 'abc',
                channelKey: null,
                mode: 'theater',
                kind: 'live',
                durationSeconds: null,
                playerRect: null,
            });
            expect(liveTheaterResolved.background).toBe('opaque');
            expect(liveTheaterResolved.width).toBe(700);
            expect(liveTheaterResolved.blur).toBe(8);
        });
    });

    describe('derivePlayerContext', () => {
        afterEach(() => {
            document.body.innerHTML = '';
            window.history.pushState({}, '', '/');
        });

        const addVideo = (duration: number, parent: Element = document.body) => {
            const video = document.createElement('video');
            Object.defineProperty(video, 'duration', { value: duration });
            parent.append(video);
            return video;
        };

        it('derives context from DOM nodes and document properties', () => {
            window.history.pushState({}, '', '/watch?v=abcdefgh123');
            document.body.innerHTML = `
                <ytd-watch-flexy theater video-id="abcdefgh123"></ytd-watch-flexy>
                <ytd-watch-metadata>
                    <ytd-video-owner-renderer><a href="https://www.youtube.com/@TechChannel/">Tech</a></ytd-video-owner-renderer>
                </ytd-watch-metadata>`;
            addVideo(360);

            const context = derivePlayerContext(document);
            expect(context.videoId).toBe('abcdefgh123');
            expect(context.mode).toBe('theater');
            expect(context.channelKey).toBe('/@techchannel');
            expect(context.kind).toBe('standard');
            expect(context.durationSeconds).toBe(360);
        });

        it('reads no channel until YouTube shows the current video', () => {
            // right after navigation the owner link still belongs to the previous video
            window.history.pushState({}, '', '/watch?v=newVideo123');
            document.body.innerHTML = `
                <ytd-watch-flexy video-id="oldVideo123"></ytd-watch-flexy>
                <ytd-watch-metadata>
                    <ytd-video-owner-renderer><a href="/@previous">Previous</a></ytd-video-owner-renderer>
                </ytd-watch-metadata>`;

            expect(derivePlayerContext(document).channelKey).toBeNull();
        });

        it('ignores video ids off the watch page', () => {
            window.history.pushState({}, '', '/results?v=abcdefgh123');
            expect(derivePlayerContext(document).videoId).toBeNull();
        });

        it('treats unknown, ad, and live-in-sidebar durations correctly', () => {
            addVideo(Number.NaN);
            expect(derivePlayerContext(document).kind).toBe('unknown');

            // a live badge in the related list says nothing about this video
            document.body.innerHTML =
                '<ytd-watch-next-secondary-results-renderer><div class="badge-style-type-live-now"></div></ytd-watch-next-secondary-results-renderer>';
            addVideo(600);
            expect(derivePlayerContext(document).kind).toBe('standard');

            // pre-roll ads play in the main video element with their own duration
            document.body.innerHTML =
                '<div id="movie_player" class="html5-video-player ad-showing"></div>';
            addVideo(15, document.getElementById('movie_player') as HTMLElement);
            expect(derivePlayerContext(document)).toMatchObject({
                kind: 'unknown',
                durationSeconds: null,
            });
        });

        it('detects live streams via infinite duration or badge', () => {
            const video = document.createElement('video');
            Object.defineProperty(video, 'duration', { value: Number.POSITIVE_INFINITY });
            document.body.append(video);

            const context = derivePlayerContext(document);
            expect(context.kind).toBe('live');
        });

        it('detects picture in picture mode in derivePlayerContext', () => {
            Object.defineProperty(document, 'pictureInPictureElement', {
                configurable: true,
                value: document.createElement('video'),
            });
            expect(derivePlayerContext(document).mode).toBe('pip');
            Object.defineProperty(document, 'pictureInPictureElement', {
                configurable: true,
                value: null,
            });
        });

        it('detects the miniplayer from the app shell and premieres from the player', () => {
            document.body.innerHTML = `
                <ytd-app miniplayer-is-active>
                    <ytd-watch-flexy theater hidden></ytd-watch-flexy>
                    <div id="movie_player" class="html5-video-player"><div class="ytp-premiere-badge"></div></div>
                </ytd-app>`;
            addVideo(0, document.getElementById('movie_player') as HTMLElement);

            const context = derivePlayerContext(document);
            expect(context.mode).toBe('miniplayer');
            expect(context.kind).toBe('premiere');
        });

        it('measures the movie player wherever theater mode moved it', () => {
            const rect = (width: number, height: number) => () =>
                ({ top: 56, left: 0, right: width, bottom: 56 + height, width, height }) as DOMRect;

            document.body.innerHTML = `
                <ytd-watch-flexy theater><div id="player"></div></ytd-watch-flexy>
                <div id="full-bleed-container"><div id="movie_player"></div></div>`;
            // the regular slot collapses to 0x0 once the player moves to the theater container
            (document.getElementById('player') as HTMLElement).getBoundingClientRect = rect(0, 0);
            (document.getElementById('movie_player') as HTMLElement).getBoundingClientRect = rect(
                1600,
                831,
            );
            expect(derivePlayerContext(document).playerRect?.height).toBe(831);

            (document.getElementById('movie_player') as HTMLElement).getBoundingClientRect = rect(
                0,
                0,
            );
            (document.getElementById('player') as HTMLElement).getBoundingClientRect = rect(
                800,
                500,
            );
            expect(derivePlayerContext(document).playerRect?.width).toBe(800);

            (document.getElementById('player') as HTMLElement).getBoundingClientRect = rect(0, 0);
            expect(derivePlayerContext(document).playerRect).toBeNull();
        });
    });
});
