import type { Rect } from '~data/context';

// YouTube watch-page markup, verified against live pages; every other module
// reads the page through these adapters so selector drift stays in one place
const APP = 'ytd-app';
const WATCH_FLEXY = 'ytd-watch-flexy';
const MOVIE_PLAYER_ID = 'movie_player';
const MINIPLAYER_ATTRIBUTE = 'miniplayer-is-active';
const VIDEO_ID_PATTERN = /^[\w-]{6,20}$/;

export const PAGE_MODE_ATTRIBUTES = ['theater', 'fullscreen', 'hidden', 'video-id'] as const;
export const APP_MODE_ATTRIBUTES = [MINIPLAYER_ATTRIBUTE] as const;

export const getApp = (root: Document = document): HTMLElement | null =>
    root.querySelector<HTMLElement>(APP);

export const getWatchFlexy = (root: Document = document): HTMLElement | null =>
    root.querySelector<HTMLElement>(WATCH_FLEXY);

export const getWatchVideoId = (root: Document = document): string | null => {
    try {
        const url = new URL(root.location?.href || window.location.href);
        if (url.pathname !== '/watch') {
            return null;
        }

        const videoId = url.searchParams.get('v');
        return videoId && VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
    } catch {
        return null;
    }
};

/**
 * YouTube updates the URL and the video before its navigation events, but
 * the watch metadata (channel, chapters, transcript panel) only switches to
 * the new video when `ytd-watch-flexy[video-id]` flips. Reading that
 * metadata earlier returns the previous video's data.
 */
export const isPageDataCurrent = (videoId: string | null, root: Document = document): boolean => {
    if (!videoId) {
        return false;
    }

    const flexy = getWatchFlexy(root);
    if (!flexy?.hasAttribute('video-id')) {
        // unknown markup: do not block features on a signal that does not exist
        return true;
    }

    return flexy.getAttribute('video-id') === videoId;
};

export const getMoviePlayer = (root: Document = document): HTMLElement | null =>
    root.getElementById(MOVIE_PLAYER_ID) ?? root.querySelector<HTMLElement>('.html5-video-player');

export const getMainVideo = (root: Document = document): HTMLVideoElement | null => {
    const video =
        root.querySelector(`#${MOVIE_PLAYER_ID} video`) ??
        root.querySelector('video.html5-main-video') ??
        root.querySelector('video');

    return video instanceof HTMLVideoElement ? video : null;
};

export const isAdShowing = (root: Document = document): boolean =>
    getMoviePlayer(root)?.classList.contains('ad-showing') ?? false;

export const isMiniplayerActive = (root: Document = document): boolean =>
    Boolean(getApp(root)?.hasAttribute(MINIPLAYER_ATTRIBUTE)) ||
    Boolean(getMoviePlayer(root)?.classList.contains('ytp-player-minimized'));

export const isTheaterMode = (root: Document = document): boolean =>
    Boolean(getWatchFlexy(root)?.hasAttribute('theater'));

export const isLiveBroadcast = (root: Document = document): boolean =>
    root.querySelector(
        `#${MOVIE_PLAYER_ID} .ytp-live, ytd-watch-metadata .badge-style-type-live-now`,
    ) !== null;

export const isPremiere = (root: Document = document): boolean =>
    root.querySelector(`#${MOVIE_PLAYER_ID} .ytp-premiere-badge`) !== null;

export const readChannelKey = (root: Document = document): string | null => {
    const link = root.querySelector<HTMLAnchorElement>(
        'ytd-watch-metadata ytd-video-owner-renderer a[href], ytd-watch-metadata #channel-name a[href]',
    );
    if (!link?.href) {
        return null;
    }

    try {
        const path = new URL(link.href).pathname.replace(/\/+$/, '').toLowerCase();
        return path || null;
    } catch {
        return null;
    }
};

export const readVideoTitle = (root: Document = document): string => {
    const heading = root.querySelector('ytd-watch-metadata h1')?.textContent?.trim();
    if (heading) {
        return heading;
    }

    return (root.title || '').replace(/\s+-\s+YouTube$/, '').trim();
};

export const canonicalVideoUrl = (videoId: string): string =>
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

const toRect = (element: Element): Rect | null => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return null;
    }

    return {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
    };
};

/**
 * The movie player moves between `#player` and the theater container; the
 * container that does not hold it measures 0x0, so take the first candidate
 * that actually has a size.
 */
export const measurePlayer = (root: Document = document): Rect | null => {
    const candidates = [
        getMoviePlayer(root),
        root.querySelector('ytd-watch-flexy #player'),
        root.getElementById('player'),
    ];

    for (const candidate of candidates) {
        if (candidate) {
            const rect = toRect(candidate);
            if (rect) {
                return rect;
            }
        }
    }

    return null;
};
