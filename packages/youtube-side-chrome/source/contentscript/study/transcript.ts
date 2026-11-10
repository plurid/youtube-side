import { log } from '~common/utilities';

export interface TranscriptSegment {
    startMs: number;
    durationMs: number;
    text: string;
}

export interface Transcript {
    language: string;
    kind: 'manual' | 'asr' | 'unknown';
    segments: TranscriptSegment[];
    truncated?: boolean;
}

export const MAX_TRANSCRIPT_SEGMENTS = 10_000;
const MAX_CACHED_TRANSCRIPTS = 3;

// In-memory LRU cache
const transcriptCache = new Map<string, Transcript>();
let currentGeneration = 0;

export const incrementGeneration = (): number => {
    currentGeneration += 1;
    return currentGeneration;
};

export const getGeneration = (): number => currentGeneration;

export const clearTranscriptCache = (): void => {
    transcriptCache.clear();
};

export const normalizeSearchText = (text: string): string =>
    text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

export const parseTimedtextJson3 = (json: unknown): TranscriptSegment[] => {
    if (!json || typeof json !== 'object' || !('events' in json)) {
        return [];
    }

    const events = (json as { events: unknown }).events;
    if (!Array.isArray(events)) {
        return [];
    }

    const segments: TranscriptSegment[] = [];

    for (const ev of events) {
        if (!ev || typeof ev !== 'object') {
            continue;
        }

        const tStartMs = typeof ev.tStartMs === 'number' ? Math.max(0, ev.tStartMs) : null;
        const dDurationMs = typeof ev.dDurationMs === 'number' ? Math.max(0, ev.dDurationMs) : 0;

        if (tStartMs === null) {
            continue;
        }

        let text = '';
        if (Array.isArray(ev.segs)) {
            for (const seg of ev.segs) {
                if (seg && typeof seg === 'object' && typeof seg.utf8 === 'string') {
                    text += seg.utf8;
                }
            }
        }

        const cleanText = text.replace(/\s+/g, ' ').trim();
        if (cleanText.length > 0) {
            segments.push({
                startMs: tStartMs,
                durationMs: dDurationMs,
                text: cleanText,
            });
        }
    }

    segments.sort((a, b) => a.startMs - b.startMs);

    if (segments.length > MAX_TRANSCRIPT_SEGMENTS) {
        return segments.slice(0, MAX_TRANSCRIPT_SEGMENTS);
    }

    return segments;
};

export const findCurrentSegmentIndex = (
    segments: readonly TranscriptSegment[],
    currentTimeMs: number,
): number => {
    if (segments.length === 0) {
        return -1;
    }

    let low = 0;
    let high = segments.length - 1;
    let best = -1;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const seg = segments[mid];
        if (!seg) {
            break;
        }

        if (seg.startMs <= currentTimeMs) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return best;
};

export const filterTranscriptSegments = (
    segments: readonly TranscriptSegment[],
    query: string,
): { segment: TranscriptSegment; index: number; matchRange?: [number, number] }[] => {
    const cleanQuery = normalizeSearchText(query.trim());
    if (!cleanQuery) {
        return segments.map((segment, index) => ({ segment, index }));
    }

    const results: {
        segment: TranscriptSegment;
        index: number;
        matchRange?: [number, number];
    }[] = [];
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (!seg) {
            continue;
        }
        const norm = normalizeSearchText(seg.text);
        const matchIdx = norm.indexOf(cleanQuery);
        if (matchIdx !== -1) {
            results.push({
                segment: seg,
                index: i,
                matchRange: [matchIdx, matchIdx + cleanQuery.length],
            });
        }
    }

    return results;
};

export interface CaptionTrackInfo {
    baseUrl: string;
    languageCode: string;
    kind?: string;
}

export const extractJsonArray = (text: string, startIndex: number): string | null => {
    let depth = 0;
    let inString = false;
    let isEscaped = false;
    let start = -1;

    for (let i = startIndex; i < text.length; i++) {
        const char = text[i];
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
                start = i;
            }
            depth++;
        } else if (char === ']') {
            depth--;
            if (depth === 0 && start !== -1) {
                return text.slice(start, i + 1);
            }
        }
    }

    return null;
};

export const extractCaptionTracksFromText = (content: string): CaptionTrackInfo[] => {
    if (!content.includes('captionTracks')) {
        return [];
    }

    const keyword = '"captionTracks":';
    let searchPos = 0;
    while (true) {
        const idx = content.indexOf(keyword, searchPos);
        if (idx === -1) {
            break;
        }

        const openBracket = content.indexOf('[', idx + keyword.length);
        if (openBracket !== -1 && openBracket - (idx + keyword.length) < 10) {
            const rawArray = extractJsonArray(content, openBracket);
            if (rawArray) {
                try {
                    const parsed = JSON.parse(rawArray);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        return parsed
                            .filter(
                                (t) =>
                                    t &&
                                    typeof t.baseUrl === 'string' &&
                                    typeof t.languageCode === 'string',
                            )
                            .map((t) => ({
                                baseUrl: t.baseUrl,
                                languageCode: t.languageCode,
                                kind: typeof t.kind === 'string' ? t.kind : undefined,
                            }));
                    }
                } catch {
                    // try next match
                }
            }
        }
        searchPos = idx + keyword.length;
    }

    return [];
};

export const extractCaptionTracks = (root: Document = document): CaptionTrackInfo[] => {
    try {
        const winResponse = (window as unknown as { ytInitialPlayerResponse?: unknown })
            .ytInitialPlayerResponse;
        const winTracks = (
            winResponse as {
                captions?: {
                    playerCaptionsTracklistRenderer?: { captionTracks?: unknown };
                };
            }
        )?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(winTracks) && winTracks.length > 0) {
            return winTracks.filter(
                (t) => t && typeof t.baseUrl === 'string' && typeof t.languageCode === 'string',
            );
        }
    } catch {
        // ignore
    }

    const scripts = root.querySelectorAll('script');
    for (const script of scripts) {
        const content = script.textContent || '';
        const tracks = extractCaptionTracksFromText(content);
        if (tracks.length > 0) {
            return tracks;
        }
    }

    return [];
};

export const fetchTranscript = async (
    videoId: string,
    root: Document = document,
): Promise<Transcript | null> => {
    const generationAtStart = currentGeneration;

    // 1. Check in-memory cache
    if (transcriptCache.has(videoId)) {
        return transcriptCache.get(videoId) ?? null;
    }

    // Source 1: Timedtext via caption tracks (from DOM scripts or watch page fetch fallback)
    let tracks = extractCaptionTracks(root);
    if (tracks.length === 0) {
        try {
            const watchResponse = await fetch(`/watch?v=${encodeURIComponent(videoId)}`);
            if (watchResponse.ok) {
                const html = await watchResponse.text();
                tracks = extractCaptionTracksFromText(html);
            }
        } catch {
            // ignore network errors
        }
    }
    if (tracks.length > 0) {
        // Preferred track: manual before ASR, language matching document or navigator
        const preferredLang = (
            root.documentElement.lang ||
            navigator.language ||
            'en'
        ).toLowerCase();
        const chosenTrack =
            tracks.find((t) => t.kind !== 'asr' && t.languageCode.startsWith(preferredLang)) ||
            tracks.find((t) => t.languageCode.startsWith(preferredLang)) ||
            tracks.find((t) => t.kind !== 'asr') ||
            tracks[0];

        if (chosenTrack) {
            try {
                const url = new URL(chosenTrack.baseUrl);
                url.searchParams.set('fmt', 'json3');

                const response = await fetch(url.toString());
                if (response.ok) {
                    const json: unknown = await response.json();
                    if (generationAtStart !== currentGeneration) {
                        return null; // Discard stale fetch
                    }

                    const segments = parseTimedtextJson3(json);
                    if (segments.length > 0) {
                        const transcript: Transcript = {
                            language: chosenTrack.languageCode,
                            kind: chosenTrack.kind === 'asr' ? 'asr' : 'manual',
                            segments,
                            truncated: segments.length >= MAX_TRANSCRIPT_SEGMENTS,
                        };

                        if (transcriptCache.size >= MAX_CACHED_TRANSCRIPTS) {
                            const firstKey = transcriptCache.keys().next().value;
                            if (firstKey) {
                                transcriptCache.delete(firstKey);
                            }
                        }
                        transcriptCache.set(videoId, transcript);

                        return transcript;
                    }
                }
            } catch (error) {
                log('Failed to fetch timedtext JSON3 transcript:', error);
            }
        }
    }

    // Source 2: Scrape transcript engagement panel DOM if open
    const domSegments = root.querySelectorAll(
        'ytd-transcript-segment-renderer, ytd-transcript-search-panel-renderer [class*="segment"]',
    );
    if (domSegments.length > 0) {
        const segments: TranscriptSegment[] = [];
        for (const el of domSegments) {
            const timeEl = el.querySelector('[class*="timestamp"], #timestamp');
            const textEl = el.querySelector('[class*="text"], #text');

            const timeText = timeEl?.textContent?.trim() || '';
            const text = textEl?.textContent?.replace(/\s+/g, ' ').trim() || '';

            const match = /(?:(\d+):)?([0-5]?\d):([0-5]\d)/.exec(timeText);
            if (match && text) {
                const [, h, m, s] = match;
                if (m && s) {
                    const hours = h ? Number.parseInt(h, 10) : 0;
                    const mins = Number.parseInt(m, 10);
                    const secs = Number.parseInt(s, 10);
                    segments.push({
                        startMs: (hours * 3600 + mins * 60 + secs) * 1000,
                        durationMs: 3000,
                        text,
                    });
                }
            }
        }

        if (segments.length > 0) {
            const transcript: Transcript = {
                language: 'unknown',
                kind: 'unknown',
                segments,
            };
            transcriptCache.set(videoId, transcript);
            return transcript;
        }
    }

    return null;
};
