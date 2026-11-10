import { describe, expect, jest, test } from '@jest/globals';

import {
    BLUR_MAX,
    DEFAULT_OPTIONS,
    HEIGHT_MAX,
    loadOptions,
    MAX_CHANNEL_RULES,
    normalizeChannelRules,
    normalizeOptions,
    normalizePreset,
    normalizePresets,
    OPTIONS_KEY,
    OPTIONS_VERSION,
    resetOptions,
    subscribeOptions,
    updateOptions,
    WIDTH_MIN,
} from '~data/options';

import { createChromeMock } from './chrome';

describe('Options module', () => {
    test('normalizes malformed and legacy values', () => {
        expect(normalizeOptions(null)).toEqual(DEFAULT_OPTIONS);
        expect(
            normalizeOptions({
                background: 'opaque',
                width: -100,
                height: Number.POSITIVE_INFINITY,
                left: 'yes',
                blur: 99,
                opacity: 250,
            }),
        ).toEqual({
            ...DEFAULT_OPTIONS,
            background: 'opaque',
            width: WIDTH_MIN,
            blur: BLUR_MAX,
            opacity: 100,
        });
    });

    test('derives the opacity of pre-opacity values from their blur', () => {
        expect(normalizeOptions({ blur: 10 })).toEqual({
            ...DEFAULT_OPTIONS,
            blur: 10,
            opacity: 80,
        });
    });

    test('reads the versioned envelope and clamps dimensions', () => {
        expect(
            normalizeOptions({
                version: 2,
                values: {
                    ...DEFAULT_OPTIONS,
                    width: 511.7,
                    height: 99_999,
                },
            }),
        ).toEqual({
            ...DEFAULT_OPTIONS,
            width: 512,
            height: HEIGHT_MAX,
        });
    });

    test('migrates the boolean blurred option to a blur strength', () => {
        expect(
            normalizeOptions({
                version: 1,
                values: {
                    ...DEFAULT_OPTIONS,
                    blur: undefined,
                    opacity: undefined,
                    blurred: true,
                },
            }),
        ).toEqual({
            ...DEFAULT_OPTIONS,
            blur: 5,
            opacity: 90,
        });

        expect(
            normalizeOptions({
                background: 'opaque',
                blurred: false,
            }),
        ).toEqual({
            ...DEFAULT_OPTIONS,
            background: 'opaque',
            blur: 0,
        });
    });

    test('migrates the boolean invert option to a mode', () => {
        expect(normalizeOptions({ invertText: true })).toEqual({
            ...DEFAULT_OPTIONS,
            invertText: 'on',
        });
        expect(normalizeOptions({ invertText: 'auto' })).toEqual({
            ...DEFAULT_OPTIONS,
            invertText: 'auto',
        });
        expect(normalizeOptions({ invertText: 'nonsense' })).toEqual(DEFAULT_OPTIONS);
    });

    test('normalizes options v3 fields (adaptive layout and study mode)', () => {
        const result = normalizeOptions({
            layoutAnchor: 'player',
            autoActivate: 'long',
            studyEnabled: false,
            studyFollow: false,
            studyAutoOpen: 'chapters',
            presets: {
                standard: { width: 600, background: 'opaque' },
            },
            channelRules: {
                '/c/test': 'always',
            },
        });

        expect(result.layoutAnchor).toBe('player');
        expect(result.autoActivate).toBe('long');
        expect(result.studyEnabled).toBe(false);
        expect(result.studyFollow).toBe(false);
        expect(result.studyAutoOpen).toBe('chapters');
        expect(result.presets.standard).toEqual({ width: 600, background: 'opaque' });
        expect(result.channelRules).toEqual({ '/c/test': 'always' });
    });

    test('normalizePreset and normalizePresets clamp and validate', () => {
        expect(normalizePreset(null)).toBeUndefined();
        expect(
            normalizePreset({
                width: 2000,
                blur: 50,
                opacity: 200,
                background: 'opaque',
                layoutAnchor: 'player',
                invertText: 'on',
                left: false,
                recommendations: true,
            }),
        ).toEqual({
            width: 1200,
            blur: 20,
            opacity: 100,
            background: 'opaque',
            layoutAnchor: 'player',
            invertText: 'on',
            left: false,
            recommendations: true,
        });

        expect(normalizePresets('invalid')).toEqual({});
        expect(
            normalizePresets({
                standard: { width: 550 },
                live: { background: 'transparent' },
                theater: { height: 600 },
                unknown: { width: 100 },
            }),
        ).toEqual({
            standard: { width: 550 },
            live: { background: 'transparent' },
            theater: { height: 600 },
        });
    });

    test('normalizeChannelRules caps at MAX_CHANNEL_RULES', () => {
        expect(normalizeChannelRules(null)).toEqual({});
        const manyRules: Record<string, string> = {};
        for (let i = 0; i < 150; i++) {
            manyRules[`/c/channel_${i}`] = 'always';
        }
        const normalized = normalizeChannelRules(manyRules);
        expect(Object.keys(normalized).length).toBe(MAX_CHANNEL_RULES);
        expect(normalized['/c/channel_149']).toBe('always');
        expect(normalized['/c/channel_0']).toBeUndefined();
    });

    test('serializes updates and resets every option', async () => {
        const mock = createChromeMock({
            [OPTIONS_KEY]: {
                background: 'transparent',
                blurred: true,
                width: 500,
                height: 550,
                left: true,
                recommendations: false,
            },
        });

        await expect(updateOptions({ width: 640 })).resolves.toMatchObject({
            width: 640,
            blur: 5,
            opacity: 90,
            recommendations: false,
        });
        expect(mock.data[OPTIONS_KEY]).toEqual({
            version: OPTIONS_VERSION,
            values: {
                ...DEFAULT_OPTIONS,
                background: 'transparent',
                blur: 5,
                opacity: 90,
                recommendations: false,
                width: 640,
            },
        });

        await expect(resetOptions()).resolves.toEqual(DEFAULT_OPTIONS);
        await expect(loadOptions()).resolves.toEqual(DEFAULT_OPTIONS);
    });

    test('subscribes only to the local options key', () => {
        const mock = createChromeMock();
        const listener = jest.fn();
        const unsubscribe = subscribeOptions(listener);
        const [storageListener] = [...mock.storageListeners];

        storageListener?.({ unrelated: { newValue: true } }, 'local');
        storageListener?.(
            {
                [OPTIONS_KEY]: {
                    newValue: {
                        ...DEFAULT_OPTIONS,
                        left: false,
                    },
                },
            },
            'sync',
        );
        storageListener?.(
            {
                [OPTIONS_KEY]: {
                    newValue: {
                        ...DEFAULT_OPTIONS,
                        left: false,
                    },
                },
            },
            'local',
        );

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith({
            ...DEFAULT_OPTIONS,
            left: false,
        });

        unsubscribe();
        expect(mock.storageListeners.size).toBe(0);
    });
});
