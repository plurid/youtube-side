import { describe, expect, test } from '@jest/globals';

import { isSideRequest, isSideResponse } from '~data/messages';

describe('Messages module', () => {
    test('validates requests', () => {
        expect(isSideRequest({ type: 'GET_STATE' })).toBe(true);
        expect(isSideRequest({ type: 'SET_ACTIVE', active: true })).toBe(true);
        expect(isSideRequest({ type: 'SET_ACTIVE' })).toBe(false);
        expect(isSideRequest({ type: 'OTHER' })).toBe(false);
        expect(isSideRequest('GET_STATE')).toBe(false);
        expect(isSideRequest(null)).toBe(false);
    });

    test('validates responses', () => {
        expect(
            isSideResponse({
                ok: true,
                status: { active: true, available: false },
            }),
        ).toBe(true);
        expect(
            isSideResponse({
                ok: false,
                status: { active: true, available: false },
            }),
        ).toBe(false);
        expect(
            isSideResponse({
                ok: true,
                status: { active: 'yes', available: false },
            }),
        ).toBe(false);
        expect(isSideResponse(undefined)).toBe(false);
    });
});
