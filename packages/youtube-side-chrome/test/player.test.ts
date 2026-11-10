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
        });

        it('derives context from DOM nodes and document properties', () => {
            const flexy = document.createElement('ytd-watch-flexy');
            flexy.setAttribute('theater', '');
            document.body.append(flexy);

            const channelOwner = document.createElement('ytd-video-owner-renderer');
            const link = document.createElement('a');
            link.href = 'https://www.youtube.com/@techchannel/';
            channelOwner.append(link);
            document.body.append(channelOwner);

            const video = document.createElement('video');
            Object.defineProperty(video, 'duration', { value: 360 });
            document.body.append(video);

            const context = derivePlayerContext(document);
            expect(context.mode).toBe('theater');
            expect(context.channelKey).toBe('/@techchannel');
            expect(context.kind).toBe('standard');
            expect(context.durationSeconds).toBe(360);
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

        it('detects miniplayer mode, premiere badge, and player rect', () => {
            const flexy = document.createElement('ytd-watch-flexy');
            flexy.setAttribute('miniplayer', '');
            document.body.append(flexy);

            const video = document.createElement('video');
            Object.defineProperty(video, 'duration', { value: 0 });
            document.body.append(video);

            const premiereBadge = document.createElement('div');
            premiereBadge.className = 'ytp-premiere-badge';
            document.body.append(premiereBadge);

            const player = document.createElement('div');
            player.id = 'player';
            player.getBoundingClientRect = () =>
                ({
                    top: 56,
                    left: 200,
                    right: 1000,
                    bottom: 556,
                    width: 800,
                    height: 500,
                }) as DOMRect;
            document.body.append(player);

            const context = derivePlayerContext(document);
            expect(context.mode).toBe('miniplayer');
            expect(context.kind).toBe('premiere');
            expect(context.playerRect?.width).toBe(800);
        });
    });
});
