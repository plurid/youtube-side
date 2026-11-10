import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
    clearTranscriptCache,
    extractCaptionTracksFromText,
    extractJsonArray,
    fetchTranscript,
    filterTranscriptSegments,
    findCurrentSegmentIndex,
    getGeneration,
    incrementGeneration,
    MAX_TRANSCRIPT_SEGMENTS,
    parseTimedtextJson3,
    type TranscriptSegment,
} from '~contentscript/study/transcript';

describe('transcript module', () => {
    beforeEach(() => {
        clearTranscriptCache();
    });

    describe('parseTimedtextJson3', () => {
        it('parses valid json3 events', () => {
            const raw = {
                events: [
                    {
                        tStartMs: 1000,
                        dDurationMs: 2000,
                        segs: [{ utf8: 'Hello ' }, { utf8: 'world!' }],
                    },
                    {
                        tStartMs: 3500,
                        dDurationMs: 1500,
                        segs: [{ utf8: 'Second segment.' }],
                    },
                ],
            };

            const segments = parseTimedtextJson3(raw);
            expect(segments).toEqual([
                { startMs: 1000, durationMs: 2000, text: 'Hello world!' },
                { startMs: 3500, durationMs: 1500, text: 'Second segment.' },
            ]);
        });

        it('sorts unsorted events and clamps negative startMs to 0', () => {
            const raw = {
                events: [
                    { tStartMs: 5000, dDurationMs: 1000, segs: [{ utf8: 'Later' }] },
                    { tStartMs: -500, dDurationMs: 500, segs: [{ utf8: 'Negative' }] },
                    { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'Middle' }] },
                ],
            };

            const segments = parseTimedtextJson3(raw);
            expect(segments[0]).toEqual({ startMs: 0, durationMs: 500, text: 'Negative' });
            expect(segments[1]).toEqual({ startMs: 2000, durationMs: 1000, text: 'Middle' });
            expect(segments[2]).toEqual({ startMs: 5000, durationMs: 1000, text: 'Later' });
        });

        it('discards empty and whitespace-only segments', () => {
            const raw = {
                events: [
                    { tStartMs: 100, segs: [{ utf8: '   ' }] },
                    { tStartMs: 200, segs: [] },
                    { tStartMs: 300, segs: [{ utf8: 'Valid' }] },
                ],
            };

            const segments = parseTimedtextJson3(raw);
            expect(segments).toHaveLength(1);
            expect(segments[0]?.text).toBe('Valid');
        });

        it('caps segments at MAX_TRANSCRIPT_SEGMENTS', () => {
            const rawEvents = Array.from({ length: 12_000 }, (_, i) => ({
                tStartMs: i * 1000,
                dDurationMs: 900,
                segs: [{ utf8: `Segment ${i}` }],
            }));

            const segments = parseTimedtextJson3({ events: rawEvents });
            expect(segments).toHaveLength(MAX_TRANSCRIPT_SEGMENTS);
        });

        it('handles malicious script strings safely as text', () => {
            const raw = {
                events: [
                    {
                        tStartMs: 0,
                        segs: [{ utf8: '<img src=x onerror="alert(1)">' }],
                    },
                ],
            };
            const segments = parseTimedtextJson3(raw);
            expect(segments[0]?.text).toBe('<img src=x onerror="alert(1)">');
        });
    });

    describe('findCurrentSegmentIndex', () => {
        const segments: TranscriptSegment[] = [
            { startMs: 1000, durationMs: 2000, text: 'One' },
            { startMs: 4000, durationMs: 2000, text: 'Two' },
            { startMs: 8000, durationMs: 2000, text: 'Three' },
        ];

        it('finds correct segment before or during timestamp', () => {
            expect(findCurrentSegmentIndex(segments, 500)).toBe(-1);
            expect(findCurrentSegmentIndex(segments, 1000)).toBe(0);
            expect(findCurrentSegmentIndex(segments, 2500)).toBe(0);
            expect(findCurrentSegmentIndex(segments, 4000)).toBe(1);
            expect(findCurrentSegmentIndex(segments, 6000)).toBe(1);
            expect(findCurrentSegmentIndex(segments, 10000)).toBe(2);
        });

        it('returns -1 for empty list', () => {
            expect(findCurrentSegmentIndex([], 1000)).toBe(-1);
        });
    });

    describe('filterTranscriptSegments & normalizeSearchText', () => {
        const segments: TranscriptSegment[] = [
            { startMs: 0, durationMs: 1000, text: 'Café au lait' },
            { startMs: 2000, durationMs: 1000, text: 'Coffee with milk' },
        ];

        it('handles diacritics and case insensitivity', () => {
            const results = filterTranscriptSegments(segments, 'cafe');
            expect(results).toHaveLength(1);
            expect(results[0]?.segment.text).toBe('Café au lait');
            expect(results[0]?.matchRange).toEqual([0, 4]);
        });

        it('returns all segments when query is empty and handles non-matching queries', () => {
            expect(filterTranscriptSegments(segments, '')).toHaveLength(2);
            expect(filterTranscriptSegments(segments, '   ')).toHaveLength(2);
            expect(filterTranscriptSegments(segments, 'nomatchhere')).toHaveLength(0);
        });
    });

    describe('generation counter', () => {
        it('increments correctly and discards stale fetch results', async () => {
            const startGen = getGeneration();
            const nextGen = incrementGeneration();
            expect(nextGen).toBe(startGen + 1);

            // Mock fetch that resolves after generation changes
            const doc = document.implementation.createHTMLDocument();
            const script = doc.createElement('script');
            script.textContent = `
                var ytInitialPlayerResponse = {
                    captions: {
                        playerCaptionsTracklistRenderer: {
                            captionTracks: [{ baseUrl: "https://example.com/timedtext", languageCode: "en" }]
                        }
                    }
                };
            `;
            doc.body.append(script);

            global.fetch = jest.fn(async () => {
                // simulate generation change mid-flight
                incrementGeneration();
                return {
                    ok: true,
                    json: async () => ({
                        events: [{ tStartMs: 0, segs: [{ utf8: 'Stale' }] }],
                    }),
                };
            }) as unknown as typeof fetch;

            const result = await fetchTranscript('vTest', doc);
            expect(result).toBeNull();
        });

        it('fetches timedtext successfully and caches the result', async () => {
            const doc = document.implementation.createHTMLDocument();
            const script = doc.createElement('script');
            script.textContent = `
                var ytInitialPlayerResponse = {
                    "captions": {
                        "playerCaptionsTracklistRenderer": {
                            "captionTracks": [
                                { "baseUrl": "https://example.com/timedtext?v=1", "languageCode": "fr" },
                                { "baseUrl": "https://example.com/timedtext?v=2", "languageCode": "en" }
                            ]
                        }
                    }
                };
            `;
            doc.body.append(script);

            global.fetch = jest.fn(async () => ({
                ok: true,
                json: async () => ({
                    events: [
                        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'First' }] },
                        { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'Second' }] },
                    ],
                }),
            })) as unknown as typeof fetch;

            const transcript = await fetchTranscript('video_success', doc);
            expect(transcript).not.toBeNull();
            expect(transcript?.segments).toHaveLength(2);

            // Second call should return from cache without re-fetching
            const cached = await fetchTranscript('video_success', doc);
            expect(cached).toBe(transcript);

            // Add more transcripts to trigger LRU cache eviction (> 3)
            await fetchTranscript('v2', doc);
            await fetchTranscript('v3', doc);
            await fetchTranscript('v4', doc);
        });

        it('handles window.ytInitialPlayerResponse and ASR caption tracks', async () => {
            (window as unknown as { ytInitialPlayerResponse: unknown }).ytInitialPlayerResponse = {
                captions: {
                    playerCaptionsTracklistRenderer: {
                        captionTracks: [
                            { baseUrl: 'https://example.com/asr', languageCode: 'en', kind: 'asr' },
                        ],
                    },
                },
            };

            global.fetch = jest.fn(async () => ({
                ok: true,
                json: async () => ({
                    events: [
                        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Auto generated' }] },
                    ],
                }),
            })) as unknown as typeof fetch;

            const transcript = await fetchTranscript('video_asr');
            expect(transcript?.kind).toBe('asr');

            delete (window as unknown as { ytInitialPlayerResponse?: unknown })
                .ytInitialPlayerResponse;
        });

        it('falls back to DOM transcript segments when timedtext fetch fails or tracks are absent', async () => {
            const doc = document.implementation.createHTMLDocument();
            const uncaptionedScript = doc.createElement('script');
            uncaptionedScript.textContent = 'console.log("no captions here");';
            doc.body.append(uncaptionedScript);

            const script = doc.createElement('script');
            script.textContent = `
                var ytInitialPlayerResponse = {
                    "captions": {
                        "playerCaptionsTracklistRenderer": {
                            "captionTracks": [{ "baseUrl": "https://example.com/broken", "languageCode": "en" }]
                        }
                    }
                };
            `;
            doc.body.append(script);

            global.fetch = jest.fn(async () => {
                throw new Error('Network error');
            }) as unknown as typeof fetch;

            const domSegment = doc.createElement('ytd-transcript-segment-renderer');
            domSegment.innerHTML = `
                <div class="segment-timestamp">0:45</div>
                <div class="segment-text">DOM Segment text</div>
            `;
            doc.body.append(domSegment);

            const transcript = await fetchTranscript('video_dom', doc);
            expect(transcript).not.toBeNull();
            expect(transcript?.segments).toHaveLength(1);
            expect(transcript?.segments[0]?.text).toBe('DOM Segment text');
            expect(transcript?.segments[0]?.startMs).toBe(45_000);
        });

        it('extracts nested caption tracks and handles watch page fetch fallback', async () => {
            expect(extractJsonArray('no array here', 0)).toBeNull();
            const sampleJson =
                'prefix: [{"name": {"simpleText": "English"}, "baseUrl": "https://example.com/test", "languageCode": "en"}], suffix';
            const arrayStr = extractJsonArray(sampleJson, sampleJson.indexOf('['));
            expect(arrayStr).toContain('https://example.com/test');

            const tracks = extractCaptionTracksFromText(
                '{"playerCaptionsTracklistRenderer":{"captionTracks":[{"name":{"runs":[{"text":"English"}]},"baseUrl":"https://example.com/cap","languageCode":"en"}]}}',
            );
            expect(tracks).toHaveLength(1);
            expect(tracks[0]?.baseUrl).toBe('https://example.com/cap');

            // Empty document triggers watch page fetch fallback
            const emptyDoc = document.implementation.createHTMLDocument();
            global.fetch = jest.fn(async (url: string | URL | Request) => {
                const urlStr = String(url);
                if (urlStr.includes('/watch?v=')) {
                    return {
                        ok: true,
                        text: async () =>
                            'var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://example.com/fallback","languageCode":"en"}]}}};',
                    };
                }
                return {
                    ok: true,
                    json: async () => ({
                        events: [
                            { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Fallback text' }] },
                        ],
                    }),
                };
            }) as unknown as typeof fetch;

            const transcript = await fetchTranscript('video_fallback', emptyDoc);
            expect(transcript).not.toBeNull();
            expect(transcript?.segments[0]?.text).toBe('Fallback text');
        });
    });
});
