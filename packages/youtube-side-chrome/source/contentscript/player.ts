import type { PlayerContext, PlayerMode, Rect, SuspendReason, VideoKind } from '~data/context';
import {
    type AutoActivate,
    type ChannelRule,
    HEIGHT_MAX,
    HEIGHT_MIN,
    type LayoutAnchor,
    type LayoutPreset,
    type Options,
    WIDTH_MAX,
    WIDTH_MIN,
} from '~data/options';
import {
    getMainVideo,
    getWatchVideoId,
    isAdShowing,
    isLiveBroadcast,
    isMiniplayerActive,
    isPageDataCurrent,
    isPremiere,
    isTheaterMode,
    measurePlayer,
    readChannelKey,
} from './page';
import { MASTHEAD_HEIGHT } from './styles';

export type { PlayerContext, PlayerMode, Rect, SuspendReason, VideoKind };
export type ActivationDecision = 'activate' | 'stay' | 'deactivate';

export interface LayoutRequest {
    anchor: LayoutAnchor;
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
    suspendReason: SuspendReason | null;
    top: number;
    sideOffset: number;
    width: number;
    height: number;
}

export const LONG_VIDEO_THRESHOLD_SECONDS = 20 * 60;

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

    const playerRect = request.anchor === 'player' ? request.playerRect : null;

    let top = MASTHEAD_HEIGHT;
    let sideOffset = 0;
    let targetHeight = request.height;

    if (playerRect) {
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
    const maxAllowedHeight = Math.max(HEIGHT_MIN, request.viewport.height - top);

    return {
        visible: true,
        suspendReason: null,
        top,
        sideOffset,
        width: clamp(request.width, WIDTH_MIN, Math.min(WIDTH_MAX, maxAllowedWidth)),
        height: clamp(targetHeight, HEIGHT_MIN, Math.min(HEIGHT_MAX, maxAllowedHeight)),
    };
};

export const resolveActivation = (input: {
    manualOverride: boolean | null;
    channelRule: ChannelRule | null;
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

// presets are normalized on every read, so they never carry explicit undefined values
const overlayPreset = (base: Options, preset: LayoutPreset | undefined): Options =>
    preset ? { ...base, ...preset } : base;

export const resolveOptions = (base: Options, context: PlayerContext): Options => {
    let effective = { ...base };

    if (context.kind === 'standard') {
        effective = overlayPreset(effective, base.presets.standard);
    } else if (context.kind === 'live') {
        effective = overlayPreset(effective, base.presets.live);
    }

    if (context.mode === 'theater') {
        effective = overlayPreset(effective, base.presets.theater);
    }

    return effective;
};

const detectMode = (root: Document): PlayerMode => {
    if (root.fullscreenElement) {
        return 'fullscreen';
    }
    if (root.pictureInPictureElement) {
        return 'pip';
    }
    if (isMiniplayerActive(root)) {
        return 'miniplayer';
    }
    if (isTheaterMode(root)) {
        return 'theater';
    }

    return 'default';
};

const detectKind = (root: Document): { kind: VideoKind; durationSeconds: number | null } => {
    const video = getMainVideo(root);
    if (!video) {
        return { kind: 'unknown', durationSeconds: null };
    }

    if (isLiveBroadcast(root) || video.duration === Number.POSITIVE_INFINITY) {
        return { kind: 'live', durationSeconds: null };
    }

    // pre-roll ads play in the same element; their duration is not the video's
    if (isAdShowing(root)) {
        return { kind: 'unknown', durationSeconds: null };
    }

    if (Number.isFinite(video.duration) && video.duration > 0) {
        return { kind: 'standard', durationSeconds: Math.round(video.duration) };
    }

    if (isPremiere(root)) {
        return { kind: 'premiere', durationSeconds: null };
    }

    return { kind: 'unknown', durationSeconds: null };
};

export const derivePlayerContext = (root: Document = document): PlayerContext => {
    const videoId = getWatchVideoId(root);
    const { kind, durationSeconds } = detectKind(root);

    return {
        videoId,
        // the channel link still shows the previous video right after navigation
        channelKey: isPageDataCurrent(videoId, root) ? readChannelKey(root) : null,
        mode: detectMode(root),
        kind,
        durationSeconds,
        playerRect: measurePlayer(root),
    };
};
