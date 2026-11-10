import { log } from '~common/utilities';
import { isPageDataCurrent } from '../page';

export interface TranscriptSegment {
    startMs: number;
    durationMs: number;
    text: string;
}

export interface Transcript {
    language: string;
    kind: 'manual' | 'asr' | 'unknown';
    segments: TranscriptSegment[];
    truncated: boolean;
}

export interface CaptionTrackInfo {
    baseUrl: string;
    languageCode: string;
    kind: string | null;
}

export interface SearchResult {
    segment: TranscriptSegment;
    index: number;
    matchRange?: [number, number];
}

export const MAX_TRANSCRIPT_SEGMENTS = 10_000;
const MAX_CACHED_TRANSCRIPTS = 3;
const FALLBACK_SEGMENT_DURATION = 3_000;
const PANEL_POLL_INTERVAL = 250;
const PANEL_TIMEOUT = 10_000;
const YOUTUBE_ORIGIN = 'https://www.youtube.com';

// YouTube's own transcript panel; the modern view-model markup replaced the
// ytd-transcript-* renderers, both are read so either rollout state works
const TRANSCRIPT_BUTTON_SELECTOR = 'ytd-video-description-transcript-section-renderer button';
const PANEL_SEGMENT_SELECTOR = 'transcript-segment-view-model, ytd-transcript-segment-renderer';
const SEGMENT_TIME_SELECTOR = '.ytwTranscriptSegmentViewModelTimestamp, .segment-timestamp';
const SEGMENT_TEXT_SELECTOR = '.ytAttributedStringHost, [role="text"], .segment-text';
const TRANSCRIPT_PANEL_SELECTOR =
    'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]';
const EXPANDED_PANEL_SELECTOR = `${TRANSCRIPT_PANEL_SELECTOR}[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]`;
const PANEL_CLOSE_SELECTOR = '#visibility-button button';

const CLOCK_PATTERN = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/;
const PLAYER_VIDEO_ID_PATTERN = /"videoDetails"\s*:\s*\{\s*"videoId"\s*:\s*"([\w-]+)"/;
const COMBINING_MARKS = /\p{M}/gu;

const transcriptCache = new Map<string, Transcript>();

export const clearTranscriptCache = (): void => {
    transcriptCache.clear();
};

export const getCachedTranscript = (videoId: string): Transcript | null => {
    const transcript = transcriptCache.get(videoId);
    if (!transcript) {
        return null;
    }

    transcriptCache.delete(videoId);
    transcriptCache.set(videoId, transcript);
    return transcript;
};

const cacheTranscript = (videoId: string, transcript: Transcript): void => {
    transcriptCache.delete(videoId);
    transcriptCache.set(videoId, transcript);

    while (transcriptCache.size > MAX_CACHED_TRANSCRIPTS) {
        const oldest = transcriptCache.keys().next().value;
        if (oldest === undefined) {
            break;
        }
        transcriptCache.delete(oldest);
    }
};

// search folds each code point on its own so match offsets map back to the original text
const foldCodePoint = (codePoint: string): string =>
    codePoint.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();

export const normalizeSearchText = (text: string): string => {
    let folded = '';
    for (const codePoint of text) {
        folded += foldCodePoint(codePoint);
    }
    return folded;
};

interface SearchIndex {
    folded: string;
    starts: number[];
    ends: number[];
}

const searchIndexes = new WeakMap<TranscriptSegment, SearchIndex>();

const getSearchIndex = (segment: TranscriptSegment): SearchIndex => {
    const cached = searchIndexes.get(segment);
    if (cached) {
        return cached;
    }

    let folded = '';
    const starts: number[] = [];
    const ends: number[] = [];
    let offset = 0;
    for (const codePoint of segment.text) {
        const piece = foldCodePoint(codePoint);
        for (let index = 0; index < piece.length; index += 1) {
            starts.push(offset);
            ends.push(offset + codePoint.length);
        }
        folded += piece;
        offset += codePoint.length;
    }

    const index = { folded, starts, ends };
    searchIndexes.set(segment, index);
    return index;
};

export const filterTranscriptSegments = (
    segments: readonly TranscriptSegment[],
    query: string,
): SearchResult[] => {
    const foldedQuery = normalizeSearchText(query.trim());
    if (!foldedQuery) {
        return segments.map((segment, index) => ({ segment, index }));
    }

    const results: SearchResult[] = [];
    segments.forEach((segment, index) => {
        const searchIndex = getSearchIndex(segment);
        const position = searchIndex.folded.indexOf(foldedQuery);
        if (position === -1) {
            return;
        }

        const start = searchIndex.starts[position] ?? 0;
        const end = searchIndex.ends[position + foldedQuery.length - 1] ?? segment.text.length;
        results.push({ segment, index, matchRange: [start, end] });
    });

    return results;
};

export const findCurrentSegmentIndex = (
    items: readonly { startMs: number }[],
    currentTimeMs: number,
): number => {
    let low = 0;
    let high = items.length - 1;
    let best = -1;

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const item = items[middle];
        if (!item) {
            break;
        }

        if (item.startMs <= currentTimeMs) {
            best = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    return best;
};

/** Sorts, de-duplicates, caps, and fills missing durations from the next start. */
const finalizeSegments = (
    raw: TranscriptSegment[],
): { segments: TranscriptSegment[]; truncated: boolean } => {
    const sorted = [...raw].sort((a, b) => a.startMs - b.startMs);
    const unique: TranscriptSegment[] = [];
    for (const segment of sorted) {
        const previous = unique.at(-1);
        if (previous?.startMs === segment.startMs && previous.text === segment.text) {
            continue;
        }
        unique.push(segment);
    }

    const truncated = unique.length > MAX_TRANSCRIPT_SEGMENTS;
    const segments = unique.slice(0, MAX_TRANSCRIPT_SEGMENTS).map((segment, index, list) => {
        if (segment.durationMs > 0) {
            return segment;
        }

        const next = list[index + 1];
        return {
            ...segment,
            durationMs: next
                ? Math.max(0, next.startMs - segment.startMs)
                : FALLBACK_SEGMENT_DURATION,
        };
    });

    return { segments, truncated };
};

const readJson3Events = (json: unknown): TranscriptSegment[] => {
    if (!json || typeof json !== 'object' || !('events' in json)) {
        return [];
    }

    const events = (json as { events: unknown }).events;
    if (!Array.isArray(events)) {
        return [];
    }

    const segments: TranscriptSegment[] = [];
    for (const event of events) {
        if (!event || typeof event !== 'object') {
            continue;
        }

        const { tStartMs, dDurationMs, segs } = event as {
            tStartMs?: unknown;
            dDurationMs?: unknown;
            segs?: unknown;
        };
        if (typeof tStartMs !== 'number' || !Number.isFinite(tStartMs)) {
            continue;
        }

        let text = '';
        if (Array.isArray(segs)) {
            for (const seg of segs) {
                if (seg && typeof seg === 'object' && typeof seg.utf8 === 'string') {
                    text += seg.utf8;
                }
            }
        }

        const cleanText = text.replace(/\s+/g, ' ').trim();
        if (cleanText.length > 0) {
            segments.push({
                startMs: Math.max(0, tStartMs),
                durationMs:
                    typeof dDurationMs === 'number' && Number.isFinite(dDurationMs)
                        ? Math.max(0, dDurationMs)
                        : 0,
                text: cleanText,
            });
        }
    }

    return segments;
};

export const parseTimedtextJson3 = (json: unknown): TranscriptSegment[] =>
    finalizeSegments(readJson3Events(json)).segments;

export const extractJsonArray = (text: string, startIndex: number): string | null => {
    let depth = 0;
    let inString = false;
    let isEscaped = false;
    let start = -1;

    for (let index = startIndex; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (isEscaped) {
                isEscaped = false;
            } else if (char === '\\') {
                isEscaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
        } else if (char === '[') {
            if (depth === 0) {
                start = index;
            }
            depth += 1;
        } else if (char === ']') {
            depth -= 1;
            if (depth === 0 && start !== -1) {
                return text.slice(start, index + 1);
            }
        }
    }

    return null;
};

const toUrl = (value: string): URL | null => {
    try {
        return new URL(value, YOUTUBE_ORIGIN);
    } catch {
        return null;
    }
};

const isTrack = (
    value: unknown,
): value is { baseUrl: string; languageCode: string; kind?: unknown } =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { baseUrl?: unknown }).baseUrl === 'string' &&
    typeof (value as { languageCode?: unknown }).languageCode === 'string';

/**
 * Reads caption tracks from serialized player-response markup. With a
 * `videoId`, only tracks that provably belong to that video are returned:
 * after in-page navigation the inline player response still describes the
 * first video that loaded.
 */
export const extractCaptionTracksFromText = (
    content: string,
    videoId: string | null = null,
): CaptionTrackInfo[] => {
    const keyword = '"captionTracks":';
    if (!content.includes(keyword)) {
        return [];
    }

    const declaredVideoId = PLAYER_VIDEO_ID_PATTERN.exec(content)?.[1] ?? null;
    if (videoId && declaredVideoId && declaredVideoId !== videoId) {
        return [];
    }

    let searchFrom = 0;
    while (true) {
        const keywordIndex = content.indexOf(keyword, searchFrom);
        if (keywordIndex === -1) {
            return [];
        }
        searchFrom = keywordIndex + keyword.length;

        const openBracket = content.indexOf('[', searchFrom);
        if (openBracket === -1 || openBracket - searchFrom >= 10) {
            continue;
        }

        const rawArray = extractJsonArray(content, openBracket);
        if (!rawArray) {
            continue;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(rawArray);
        } catch {
            continue;
        }

        if (!Array.isArray(parsed)) {
            continue;
        }

        const tracks = parsed.filter(isTrack).flatMap((track): CaptionTrackInfo[] => {
            const owner = toUrl(track.baseUrl)?.searchParams.get('v') ?? declaredVideoId;
            if (videoId && owner !== videoId) {
                return [];
            }

            return [
                {
                    baseUrl: track.baseUrl,
                    languageCode: track.languageCode,
                    kind: typeof track.kind === 'string' ? track.kind : null,
                },
            ];
        });

        if (tracks.length > 0) {
            return tracks;
        }
    }
};

export const extractCaptionTracks = (root: Document, videoId: string): CaptionTrackInfo[] => {
    for (const script of root.querySelectorAll('script')) {
        const tracks = extractCaptionTracksFromText(script.textContent ?? '', videoId);
        if (tracks.length > 0) {
            return tracks;
        }
    }

    return [];
};

/**
 * Caption URLs marked `exp=xpe` need a proof-of-origin token that only the
 * player can mint; without it YouTube answers 200 with an empty body.
 */
export const requiresPoToken = (track: CaptionTrackInfo): boolean =>
    (toUrl(track.baseUrl)?.searchParams.get('exp') ?? '').split(',').includes('xpe');

const isYouTubeUrl = (url: URL): boolean =>
    url.protocol === 'https:' &&
    (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com'));

const baseLanguage = (language: string): string => language.toLowerCase().split('-')[0] ?? '';

export const chooseCaptionTrack = (
    tracks: readonly CaptionTrackInfo[],
    preferredLanguage: string,
): CaptionTrackInfo | null => {
    const preferred = baseLanguage(preferredLanguage);
    const matches = (track: CaptionTrackInfo) => baseLanguage(track.languageCode) === preferred;

    return (
        tracks.find((track) => track.kind !== 'asr' && matches(track)) ??
        tracks.find(matches) ??
        tracks.find((track) => track.kind !== 'asr') ??
        tracks[0] ??
        null
    );
};

const fetchTimedtext = async (
    videoId: string,
    root: Document,
    signal: AbortSignal | undefined,
): Promise<Transcript | null> => {
    const tracks = extractCaptionTracks(root, videoId).filter((track) => !requiresPoToken(track));
    const track = chooseCaptionTrack(
        tracks,
        root.documentElement.lang || navigator.language || 'en',
    );
    if (!track) {
        return null;
    }

    const url = toUrl(track.baseUrl);
    if (!url || !isYouTubeUrl(url)) {
        return null;
    }
    url.searchParams.set('fmt', 'json3');

    try {
        const response = await fetch(url.toString(), {
            credentials: 'same-origin',
            ...(signal && { signal }),
        });
        if (!response.ok) {
            return null;
        }

        const body = await response.text();
        if (!body.trim()) {
            return null;
        }

        const { segments, truncated } = finalizeSegments(readJson3Events(JSON.parse(body)));
        if (segments.length === 0) {
            return null;
        }

        return {
            language: track.languageCode,
            kind: track.kind === 'asr' ? 'asr' : 'manual',
            segments,
            truncated,
        };
    } catch (error) {
        if (!signal?.aborted) {
            log('Could not load the timedtext transcript.', error);
        }
        return null;
    }
};

export const parseClockTime = (text: string): number | null => {
    const match = CLOCK_PATTERN.exec(text.trim());
    if (!match) {
        return null;
    }

    const [, hours, minutes, seconds] = match;
    const value =
        (Number(hours ?? 0) * 3_600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)) * 1_000;
    return Number.isFinite(value) ? value : null;
};

/** Reads the segments YouTube rendered into its own transcript panel. */
export const readTranscriptPanel = (root: Document = document): Transcript | null => {
    const raw: TranscriptSegment[] = [];
    for (const node of root.querySelectorAll(PANEL_SEGMENT_SELECTOR)) {
        const startMs = parseClockTime(
            node.querySelector(SEGMENT_TIME_SELECTOR)?.textContent ?? '',
        );
        const text = (node.querySelector(SEGMENT_TEXT_SELECTOR)?.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim();
        if (startMs !== null && text) {
            raw.push({ startMs, durationMs: 0, text });
        }
    }

    const { segments, truncated } = finalizeSegments(raw);
    if (segments.length === 0) {
        return null;
    }

    return { language: 'unknown', kind: 'unknown', segments, truncated };
};

export const findTranscriptButton = (root: Document = document): HTMLElement | null =>
    root.querySelector<HTMLElement>(TRANSCRIPT_BUTTON_SELECTOR);

// set while this module clicks YouTube's button itself, so that click is not
// mistaken for the user opening the transcript
let openingPanel = false;

/** A click on YouTube's own "Show transcript" button that this module did not make. */
export const isTranscriptButton = (target: EventTarget | null): boolean =>
    !openingPanel &&
    target instanceof Element &&
    target.closest(TRANSCRIPT_BUTTON_SELECTOR) !== null;

const isPanelExpanded = (root: Document): boolean =>
    root.querySelector(EXPANDED_PANEL_SELECTOR) !== null;

const closePanel = (root: Document): void => {
    root.querySelector<HTMLElement>(`${EXPANDED_PANEL_SELECTOR} ${PANEL_CLOSE_SELECTOR}`)?.click();
};

/**
 * Cache, then timedtext, then a transcript panel YouTube already rendered
 * for this video. Never opens YouTube's panel; see `loadTranscriptFromPanel`.
 */
export const fetchTranscript = async (
    videoId: string,
    root: Document = document,
    signal?: AbortSignal,
): Promise<Transcript | null> => {
    const cached = getCachedTranscript(videoId);
    if (cached) {
        return cached;
    }

    const transcript =
        (await fetchTimedtext(videoId, root, signal)) ??
        (isPageDataCurrent(videoId, root) ? readTranscriptPanel(root) : null);

    if (transcript && !signal?.aborted) {
        cacheTranscript(videoId, transcript);
    }

    return transcript;
};

export interface PanelLoadOptions {
    videoId: string;
    /** click YouTube's "Show transcript" button and close the panel again afterwards */
    openPanel: boolean;
    signal?: AbortSignal;
    root?: Document;
    timeoutMs?: number;
}

/**
 * Waits for YouTube's transcript panel to render this video's segments,
 * optionally opening it first. Bounded by a timeout; polling stops on
 * success, timeout, or abort. A panel opened here is closed again so the
 * page returns to the state the user left it in.
 */
export const loadTranscriptFromPanel = ({
    videoId,
    openPanel,
    signal,
    root = document,
    timeoutMs = PANEL_TIMEOUT,
}: PanelLoadOptions): Promise<Transcript | null> =>
    new Promise((resolve) => {
        const startedAt = Date.now();
        let done = false;
        let clicked = false;
        let openedByUs = false;
        let lastCount = -1;
        let timer: number | undefined;

        const finish = (transcript: Transcript | null) => {
            if (done) {
                return;
            }
            done = true;
            window.clearInterval(timer);
            signal?.removeEventListener('abort', handleAbort);
            if (openedByUs) {
                closePanel(root);
            }
            if (transcript && !signal?.aborted) {
                cacheTranscript(videoId, transcript);
            }
            resolve(signal?.aborted ? null : transcript);
        };

        const handleAbort = () => {
            finish(null);
        };

        const tick = () => {
            if (Date.now() - startedAt > timeoutMs) {
                finish(null);
                return;
            }

            // the panel and its button still belong to the previous video until the page swaps
            if (!isPageDataCurrent(videoId, root)) {
                return;
            }

            if (openPanel && !clicked) {
                const button = findTranscriptButton(root);
                if (!button) {
                    finish(null);
                    return;
                }
                clicked = true;
                openedByUs = !isPanelExpanded(root);
                openingPanel = true;
                try {
                    button.click();
                } finally {
                    openingPanel = false;
                }
                return;
            }

            // segments render in batches; accept them once the count stops changing
            const count = root.querySelectorAll(PANEL_SEGMENT_SELECTOR).length;
            if (count > 0 && count === lastCount) {
                finish(readTranscriptPanel(root));
                return;
            }
            lastCount = count;
        };

        if (signal?.aborted) {
            resolve(null);
            return;
        }

        signal?.addEventListener('abort', handleAbort, { once: true });
        timer = window.setInterval(tick, PANEL_POLL_INTERVAL);
        tick();
    });
