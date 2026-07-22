import { describe, expect, jest, test } from '@jest/globals';

import {
    BLUR_MAX,
    DEFAULT_OPTIONS,
    HEIGHT_MAX,
    loadOptions,
    normalizeOptions,
    OPTIONS_KEY,
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
            version: 2,
            values: {
                ...DEFAULT_OPTIONS,
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
