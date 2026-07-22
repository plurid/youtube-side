export type InvertTextMode = 'off' | 'auto' | 'on';

export const INVERT_TEXT_MODES: readonly InvertTextMode[] = ['off', 'auto', 'on'];

export interface Options {
    background: 'transparent' | 'opaque';
    blur: number;
    opacity: number;
    invertText: InvertTextMode;
    width: number;
    height: number;
    left: boolean;
    recommendations: boolean;
}

interface StoredOptions {
    version: 2;
    values: Options;
}

export type OptionsUpdate = Partial<Options>;
export type OptionsListener = (options: Options) => void;

export const OPTIONS_KEY = 'youtubeSideOptions';
export const OPTIONS_VERSION = 2;

export const WIDTH_MIN = 320;
export const WIDTH_MAX = 1_200;
export const HEIGHT_MIN = 240;
export const HEIGHT_MAX = 1_200;
export const BLUR_MIN = 0;
export const BLUR_MAX = 20;
export const OPACITY_MIN = 0;
export const OPACITY_MAX = 100;

// the blur strength that the boolean `blurred` option applied before version 2
const LEGACY_BLUR = 5;

export const DEFAULT_OPTIONS: Readonly<Options> = Object.freeze({
    background: 'transparent',
    blur: 0,
    opacity: 100,
    invertText: 'off',
    width: 500,
    height: 550,
    left: true,
    recommendations: true,
});

const defaults = (): Options => ({ ...DEFAULT_OPTIONS });

const isInvertTextMode = (value: unknown): value is InvertTextMode =>
    value === 'off' || value === 'auto' || value === 'on';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedInteger = (value: unknown, fallback: number, minimum: number, maximum: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(maximum, Math.max(minimum, Math.round(value)));
};

const migrateBlurred = (values: Record<string, unknown>): Record<string, unknown> => {
    if (typeof values.blur === 'number' || typeof values.blurred !== 'boolean') {
        return values;
    }

    return {
        ...values,
        blur: values.blurred ? LEGACY_BLUR : 0,
    };
};

const optionValues = (value: unknown): Record<string, unknown> => {
    if (!isRecord(value)) {
        return {};
    }

    if (value.version === OPTIONS_VERSION && isRecord(value.values)) {
        return value.values;
    }

    if (value.version === 1 && isRecord(value.values)) {
        return migrateBlurred(value.values);
    }

    return migrateBlurred(value);
};

export const normalizeOptions = (value: unknown): Options => {
    const candidate = optionValues(value);
    const blur = boundedInteger(candidate.blur, DEFAULT_OPTIONS.blur, BLUR_MIN, BLUR_MAX);

    // values stored before opacity became its own option composed it
    // from the blur strength; derive the same look for them
    const opacityFallback = blur > 0 ? 100 - blur * 2 : DEFAULT_OPTIONS.opacity;

    return {
        background:
            candidate.background === 'opaque' || candidate.background === 'transparent'
                ? candidate.background
                : DEFAULT_OPTIONS.background,
        blur,
        opacity: boundedInteger(candidate.opacity, opacityFallback, OPACITY_MIN, OPACITY_MAX),
        invertText: isInvertTextMode(candidate.invertText)
            ? candidate.invertText
            : candidate.invertText === true
              ? 'on'
              : DEFAULT_OPTIONS.invertText,
        width: boundedInteger(candidate.width, DEFAULT_OPTIONS.width, WIDTH_MIN, WIDTH_MAX),
        height: boundedInteger(candidate.height, DEFAULT_OPTIONS.height, HEIGHT_MIN, HEIGHT_MAX),
        left: typeof candidate.left === 'boolean' ? candidate.left : DEFAULT_OPTIONS.left,
        recommendations:
            typeof candidate.recommendations === 'boolean'
                ? candidate.recommendations
                : DEFAULT_OPTIONS.recommendations,
    };
};

const storeOptions = async (options: Options): Promise<Options> => {
    const normalized = normalizeOptions(options);
    const stored: StoredOptions = {
        version: OPTIONS_VERSION,
        values: normalized,
    };

    await chrome.storage.local.set({
        [OPTIONS_KEY]: stored,
    });

    return normalized;
};

export const loadOptions = async (): Promise<Options> => {
    const stored = await chrome.storage.local.get(OPTIONS_KEY);

    return normalizeOptions(stored[OPTIONS_KEY]);
};

let writeQueue: Promise<void> = Promise.resolve();

const enqueueWrite = (resolveOptions: () => Promise<Options> | Options): Promise<Options> => {
    const result = writeQueue.then(async () => {
        const options = await resolveOptions();
        return storeOptions(options);
    });

    writeQueue = result.then(
        () => undefined,
        () => undefined,
    );

    return result;
};

export const updateOptions = (update: OptionsUpdate): Promise<Options> =>
    enqueueWrite(async () => {
        const current = await loadOptions();
        return normalizeOptions({
            ...current,
            ...update,
        });
    });

export const resetOptions = (): Promise<Options> => enqueueWrite(defaults);

export const subscribeOptions = (listener: OptionsListener): (() => void) => {
    const handleChange = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
    ) => {
        if (areaName !== 'local') {
            return;
        }

        const change = changes[OPTIONS_KEY];
        if (!change || typeof change.newValue === 'undefined') {
            return;
        }

        listener(normalizeOptions(change.newValue));
    };

    chrome.storage.onChanged.addListener(handleChange);

    return () => {
        chrome.storage.onChanged.removeListener(handleChange);
    };
};
