import type { PlayerContext } from '~contentscript/player';

export interface SideStatus {
    active: boolean;
    available: boolean;
    effectiveVisible?: boolean;
    suspendReason?: 'fullscreen' | 'miniplayer' | null;
    context?: PlayerContext;
}

export type SideRequest =
    | { type: 'GET_STATE' }
    | { type: 'SET_ACTIVE'; active: boolean }
    | { type: 'APPLY_CHANNEL_RULE'; channelKey: string; rule: 'always' | 'never' | null };

export interface SideResponse {
    ok: true;
    status: SideStatus;
}

export const isSideRequest = (value: unknown): value is SideRequest => {
    if (typeof value !== 'object' || value === null || !('type' in value)) {
        return false;
    }

    const request = value as {
        type: unknown;
        active?: unknown;
        channelKey?: unknown;
        rule?: unknown;
    };

    if (request.type === 'GET_STATE') {
        return true;
    }

    if (request.type === 'SET_ACTIVE') {
        return typeof request.active === 'boolean';
    }

    if (request.type === 'APPLY_CHANNEL_RULE') {
        return (
            typeof request.channelKey === 'string' &&
            (request.rule === 'always' || request.rule === 'never' || request.rule === null)
        );
    }

    return false;
};

export const isSideResponse = (value: unknown): value is SideResponse => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const response = value as Partial<SideResponse>;
    return (
        response.ok === true &&
        typeof response.status?.active === 'boolean' &&
        typeof response.status?.available === 'boolean'
    );
};
