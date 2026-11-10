export type InvertTextMode = 'off' | 'auto' | 'on';
export type LayoutAnchor = 'viewport' | 'player';
export type AutoActivate = 'never' | 'live' | 'long' | 'always';
export type PresetKey = 'standard' | 'live' | 'theater';
export type StudyAutoOpen = 'off' | 'transcript' | 'chapters';
export type ChannelRule = 'always' | 'never';

export const INVERT_TEXT_MODES: readonly InvertTextMode[] = ['off', 'auto', 'on'];
export const LAYOUT_ANCHORS: readonly LayoutAnchor[] = ['viewport', 'player'];
export const AUTO_ACTIVATE_MODES: readonly AutoActivate[] = ['never', 'live', 'long', 'always'];
export const STUDY_AUTO_OPEN_MODES: readonly StudyAutoOpen[] = ['off', 'transcript', 'chapters'];

export interface LayoutPreset {
    background?: 'transparent' | 'opaque';
    blur?: number;
    opacity?: number;
    invertText?: InvertTextMode;
    width?: number;
    height?: number;
    left?: boolean;
    recommendations?: boolean;
    layoutAnchor?: LayoutAnchor;
}

export interface Options {
    background: 'transparent' | 'opaque';
    blur: number;
    opacity: number;
    invertText: InvertTextMode;
    width: number;
    height: number;
    left: boolean;
    recommendations: boolean;

    // Direction C (Adaptive Layout)
    layoutAnchor: LayoutAnchor;
    autoActivate: AutoActivate;
    presets: Partial<Record<PresetKey, LayoutPreset>>;
    channelRules: Record<string, ChannelRule>;

    // Direction A (Study Mode)
    studyEnabled: boolean;
    studyFollow: boolean;
    studyAutoOpen: StudyAutoOpen;
}

interface StoredOptions {
    version: 3;
    values: Options;
}

export type OptionsUpdate = Partial<Options>;
export type OptionsListener = (options: Options) => void;

export const OPTIONS_KEY = 'youtubeSideOptions';
export const OPTIONS_VERSION = 3;

export const WIDTH_MIN = 320;
export const WIDTH_MAX = 1_200;
export const HEIGHT_MIN = 240;
export const HEIGHT_MAX = 1_200;
export const BLUR_MIN = 0;
export const BLUR_MAX = 20;
export const OPACITY_MIN = 0;
export const OPACITY_MAX = 100;

export const MAX_CHANNEL_RULES = 100;

// the blur strength that the boolean `blurred` option applied before version 2
const LEGACY_BLUR = 5;

export const DEFAULT_OPTIONS: Readonly<Options> = Object.freeze({
    background: 'opaque',
    blur: 10,
    opacity: 50,
    invertText: 'off',
    width: 500,
    height: 550,
    left: true,
    recommendations: true,

    layoutAnchor: 'viewport',
    autoActivate: 'never',
    presets: Object.freeze({}),
    channelRules: Object.freeze({}),

    studyEnabled: true,
    studyFollow: true,
    studyAutoOpen: 'off',
});

const defaults = (): Options => ({
    ...DEFAULT_OPTIONS,
    presets: {},
    channelRules: {},
});

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

    if ((value.version === OPTIONS_VERSION || value.version === 2) && isRecord(value.values)) {
        return value.values;
    }

    if (value.version === 1 && isRecord(value.values)) {
        return migrateBlurred(value.values);
    }

    return migrateBlurred(value);
};

export const normalizePreset = (value: unknown): LayoutPreset | undefined => {
    if (!isRecord(value)) {
        return undefined;
    }

    const preset: LayoutPreset = {};
    if (value.background === 'opaque' || value.background === 'transparent') {
        preset.background = value.background;
    }
    if (typeof value.blur === 'number') {
        preset.blur = boundedInteger(value.blur, DEFAULT_OPTIONS.blur, BLUR_MIN, BLUR_MAX);
    }
    if (typeof value.opacity === 'number') {
        preset.opacity = boundedInteger(
            value.opacity,
            DEFAULT_OPTIONS.opacity,
            OPACITY_MIN,
            OPACITY_MAX,
        );
    }
    if (isInvertTextMode(value.invertText)) {
        preset.invertText = value.invertText;
    }
    if (typeof value.width === 'number') {
        preset.width = boundedInteger(value.width, DEFAULT_OPTIONS.width, WIDTH_MIN, WIDTH_MAX);
    }
    if (typeof value.height === 'number') {
        preset.height = boundedInteger(
            value.height,
            DEFAULT_OPTIONS.height,
            HEIGHT_MIN,
            HEIGHT_MAX,
        );
    }
    if (typeof value.left === 'boolean') {
        preset.left = value.left;
    }
    if (typeof value.recommendations === 'boolean') {
        preset.recommendations = value.recommendations;
    }
    if (value.layoutAnchor === 'viewport' || value.layoutAnchor === 'player') {
        preset.layoutAnchor = value.layoutAnchor;
    }

    return Object.keys(preset).length > 0 ? preset : undefined;
};

export const normalizePresets = (value: unknown): Partial<Record<PresetKey, LayoutPreset>> => {
    if (!isRecord(value)) {
        return {};
    }

    const presets: Partial<Record<PresetKey, LayoutPreset>> = {};
    const standard = normalizePreset(value.standard);
    if (standard) {
        presets.standard = standard;
    }
    const live = normalizePreset(value.live);
    if (live) {
        presets.live = live;
    }
    const theater = normalizePreset(value.theater);
    if (theater) {
        presets.theater = theater;
    }

    return presets;
};

export const normalizeChannelRules = (value: unknown): Record<string, ChannelRule> => {
    if (!isRecord(value)) {
        return {};
    }

    const rules: Record<string, ChannelRule> = {};
    const entries = Object.entries(value);
    const start = Math.max(0, entries.length - MAX_CHANNEL_RULES);
    for (let index = start; index < entries.length; index += 1) {
        const [key, rule] = entries[index] ?? [];
        if (!key) {
            continue;
        }
        const normalizedKey = key.trim().toLowerCase();
        if (normalizedKey.length > 0 && (rule === 'always' || rule === 'never')) {
            rules[normalizedKey] = rule;
        }
    }

    return rules;
};

export const normalizeOptions = (value: unknown): Options => {
    const candidate = optionValues(value);
    const blur = boundedInteger(candidate.blur, DEFAULT_OPTIONS.blur, BLUR_MIN, BLUR_MAX);

    // values stored before opacity became its own option composed it
    // from the blur strength; derive the same look for them
    const opacityFallback =
        typeof candidate.blur === 'number' && candidate.blur > 0
            ? 100 - candidate.blur * 2
            : DEFAULT_OPTIONS.opacity;

    const layoutAnchor: LayoutAnchor = candidate.layoutAnchor === 'player' ? 'player' : 'viewport';

    const autoActivate: AutoActivate =
        candidate.autoActivate === 'live' ||
        candidate.autoActivate === 'long' ||
        candidate.autoActivate === 'always'
            ? candidate.autoActivate
            : 'never';

    const studyAutoOpen: StudyAutoOpen =
        candidate.studyAutoOpen === 'transcript' || candidate.studyAutoOpen === 'chapters'
            ? candidate.studyAutoOpen
            : 'off';

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

        layoutAnchor,
        autoActivate,
        presets: normalizePresets(candidate.presets),
        channelRules: normalizeChannelRules(candidate.channelRules),

        studyEnabled:
            typeof candidate.studyEnabled === 'boolean'
                ? candidate.studyEnabled
                : DEFAULT_OPTIONS.studyEnabled,
        studyFollow:
            typeof candidate.studyFollow === 'boolean'
                ? candidate.studyFollow
                : DEFAULT_OPTIONS.studyFollow,
        studyAutoOpen,
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

export const enqueueWrite = (
    resolveOptions: () => Promise<Options> | Options,
): Promise<Options> => {
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
