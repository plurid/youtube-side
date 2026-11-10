import { HEIGHT_MAX, HEIGHT_MIN, type Options, WIDTH_MAX, WIDTH_MIN } from '~data/options';
import { MASTHEAD_HEIGHT } from './styles';

export type PlayerMode = 'default' | 'theater' | 'fullscreen' | 'miniplayer' | 'pip';
export type VideoKind = 'standard' | 'live' | 'premiere' | 'unknown';
export type AutoActivate = 'never' | 'live' | 'long' | 'always';
export type ActivationDecision = 'activate' | 'stay' | 'deactivate';
export type PresetKey = 'standard' | 'live' | 'theater';

export interface Rect {
    top: number;
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface PlayerContext {
    videoId: string | null;
    channelKey: string | null;
    mode: PlayerMode;
    kind: VideoKind;
    durationSeconds: number | null;
    playerRect: Rect | null;
}

export interface LayoutRequest {
    anchor: 'viewport' | 'player';
    side: 'left' | 'right';
    width: number;
    height: number;
    explicitSize: boolean;
    mode: PlayerMode;
    playerRect: Rect | null;
    viewport: { width: number; height: number };
}

export interface LayoutDecision {
    visible: boolean;
    suspendReason: 'fullscreen' | 'miniplayer' | null;
    top: number;
    sideOffset: number;
    width: number;
    height: number;
}

export interface LayoutPreset {
    background?: Options['background'];
    blur?: number;
    opacity?: number;
    invertText?: Options['invertText'];
    width?: number;
    height?: number;
    left?: boolean;
    recommendations?: boolean;
    layoutAnchor?: 'viewport' | 'player';
}

const LONG_VIDEO_THRESHOLD_SECONDS = 20 * 60; // 20 minutes

export const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, Math.round(value)));

export const resolveLayout = (request: LayoutRequest): LayoutDecision => {
    if (request.mode === 'fullscreen' || request.mode === 'miniplayer') {
        return {
            visible: false,
            suspendReason: request.mode,
            top: MASTHEAD_HEIGHT,
            sideOffset: 0,
            width: clamp(request.width, WIDTH_MIN, Math.min(WIDTH_MAX, request.viewport.width)),
            height: clamp(
                request.height,
                HEIGHT_MIN,
                Math.min(
                    HEIGHT_MAX,
                    Math.max(HEIGHT_MIN, request.viewport.height - MASTHEAD_HEIGHT),
                ),
            ),
        };
    }

    const usePlayerAnchor = request.anchor === 'player' && request.playerRect !== null;
    const playerRect = request.playerRect;

    let top = MASTHEAD_HEIGHT;
    let sideOffset = 0;
    let targetHeight = request.height;

    if (usePlayerAnchor && playerRect) {
        top = Math.max(MASTHEAD_HEIGHT, Math.round(playerRect.top));
        sideOffset =
            request.side === 'left'
                ? Math.max(0, Math.round(playerRect.left))
                : Math.max(0, Math.round(request.viewport.width - playerRect.right));

        if (!request.explicitSize && playerRect.height > 0) {
            targetHeight = Math.round(playerRect.height);
        }
    }

    const maxAllowedWidth = Math.max(WIDTH_MIN, request.viewport.width);
    const maxAllowedHeight = Math.max(
        HEIGHT_MIN,
        Math.max(HEIGHT_MIN, request.viewport.height - top),
    );

    const width = clamp(request.width, WIDTH_MIN, Math.min(WIDTH_MAX, maxAllowedWidth));
    const height = clamp(targetHeight, HEIGHT_MIN, Math.min(HEIGHT_MAX, maxAllowedHeight));

    return {
        visible: true,
        suspendReason: null,
        top,
        sideOffset,
        width,
        height,
    };
};

export const resolveActivation = (input: {
    manualOverride: boolean | null;
    channelRule: 'always' | 'never' | null;
    autoActivate: AutoActivate;
    context: PlayerContext;
}): ActivationDecision => {
    if (input.manualOverride !== null) {
        return input.manualOverride ? 'activate' : 'deactivate';
    }

    if (input.channelRule === 'always') {
        return 'activate';
    }
    if (input.channelRule === 'never') {
        return 'deactivate';
    }

    switch (input.autoActivate) {
        case 'always':
            return 'activate';
        case 'live':
            return input.context.kind === 'live' ? 'activate' : 'stay';
        case 'long':
            return input.context.kind === 'standard' &&
                (input.context.durationSeconds ?? 0) >= LONG_VIDEO_THRESHOLD_SECONDS
                ? 'activate'
                : 'stay';
        default:
            return 'stay';
    }
};

export const resolveOptions = (base: Options, context: PlayerContext): Options => {
    let effective = { ...base };

    const applyPreset = (preset: LayoutPreset | undefined) => {
        if (!preset) {
            return;
        }
        effective = {
            ...effective,
            ...(preset.background !== undefined && { background: preset.background }),
            ...(preset.blur !== undefined && { blur: preset.blur }),
            ...(preset.opacity !== undefined && { opacity: preset.opacity }),
            ...(preset.invertText !== undefined && { invertText: preset.invertText }),
            ...(preset.width !== undefined && { width: preset.width }),
            ...(preset.height !== undefined && { height: preset.height }),
            ...(preset.left !== undefined && { left: preset.left }),
            ...(preset.recommendations !== undefined && {
                recommendations: preset.recommendations,
            }),
            ...(preset.layoutAnchor !== undefined && { layoutAnchor: preset.layoutAnchor }),
        };
    };

    const presets = base.presets;
    if (presets) {
        if (context.kind === 'standard') {
            applyPreset(presets.standard);
        } else if (context.kind === 'live') {
            applyPreset(presets.live);
        }

        if (context.mode === 'theater') {
            applyPreset(presets.theater);
        }
    }

    return effective;
};

export const derivePlayerContext = (rootDocument = document): PlayerContext => {
    const url = new URL(rootDocument.location?.href || 'https://www.youtube.com/');
    const videoId = url.searchParams.get('v') || null;

    // Detect player mode
    let mode: PlayerMode = 'default';
    if (rootDocument.fullscreenElement !== null && rootDocument.fullscreenElement !== undefined) {
        mode = 'fullscreen';
    } else if (
        rootDocument.pictureInPictureElement !== null &&
        rootDocument.pictureInPictureElement !== undefined
    ) {
        mode = 'pip';
    } else {
        const watchFlexy = rootDocument.querySelector('ytd-watch-flexy');
        if (watchFlexy?.hasAttribute('theater')) {
            mode = 'theater';
        } else if (watchFlexy?.hasAttribute('miniplayer')) {
            mode = 'miniplayer';
        }
    }

    // Detect channel key
    let channelKey: string | null = null;
    const channelLink = rootDocument.querySelector(
        'ytd-watch-metadata #channel-name a, ytd-video-owner-renderer a',
    ) as HTMLAnchorElement | null;
    if (channelLink?.href) {
        try {
            const channelUrl = new URL(channelLink.href);
            const path = channelUrl.pathname.replace(/\/+$/, '').toLowerCase();
            if (path) {
                channelKey = path;
            }
        } catch {
            channelKey = null;
        }
    }

    // Detect video element duration and kind
    const video = rootDocument.querySelector('video') as HTMLVideoElement | null;
    let durationSeconds: number | null = null;
    let kind: VideoKind = 'unknown';

    const isLiveBadge = rootDocument.querySelector(
        '.ytp-live, .badge-style-type-live-now, ytd-badge-supported-renderer[aria-label="LIVE"]',
    );

    if (video) {
        const duration = video.duration;
        if (isLiveBadge || duration === Number.POSITIVE_INFINITY) {
            kind = 'live';
        } else if (Number.isFinite(duration) && duration > 0) {
            durationSeconds = Math.round(duration);
            kind = 'standard';
        } else if (rootDocument.querySelector('.ytp-premiere-badge')) {
            kind = 'premiere';
        } else {
            kind = 'standard';
        }
    }

    // Measure player rect
    let playerRect: Rect | null = null;
    const playerElement =
        rootDocument.getElementById('player') ||
        rootDocument.querySelector('#ytd-player') ||
        rootDocument.querySelector('.html5-video-player');

    if (playerElement instanceof HTMLElement) {
        const rect = playerElement.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            playerRect = {
                top: rect.top,
                left: rect.left,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
            };
        }
    }

    return {
        videoId,
        channelKey,
        mode,
        kind,
        durationSeconds,
        playerRect,
    };
};
