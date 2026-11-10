export type PlayerMode = 'default' | 'theater' | 'fullscreen' | 'miniplayer' | 'pip';
export type VideoKind = 'standard' | 'live' | 'premiere' | 'unknown';
export type SuspendReason = 'fullscreen' | 'miniplayer';

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
