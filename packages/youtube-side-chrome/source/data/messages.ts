export interface SideStatus {
    active: boolean;
    available: boolean;
}

export type SideRequest = { type: 'GET_STATE' } | { type: 'SET_ACTIVE'; active: boolean };

export interface SideResponse {
    ok: true;
    status: SideStatus;
}

export const isSideRequest = (value: unknown): value is SideRequest => {
    if (typeof value !== 'object' || value === null || !('type' in value)) {
        return false;
    }

    const request = value as { type: unknown; active?: unknown };
    if (request.type === 'GET_STATE') {
        return true;
    }

    return request.type === 'SET_ACTIVE' && typeof request.active === 'boolean';
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
