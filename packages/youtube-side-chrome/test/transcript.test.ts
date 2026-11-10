import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
    chooseCaptionTrack,
    clearTranscriptCache,
    extractCaptionTracksFromText,
    extractJsonArray,
    fetchTranscript,
    filterTranscriptSegments,
    findCurrentSegmentIndex,
    getCachedTranscript,
    isTranscriptButton,
    loadTranscriptFromPanel,
    MAX_TRANSCRIPT_SEGMENTS,
    normalizeSearchText,
    parseClockTime,
    parseTimedtextJson3,
    readTranscriptPanel,
    requiresPoToken,
    type TranscriptSegment,
} from '~contentscript/study/transcript';

const timedtextUrl = (videoId: string, extra = '') =>
    `https://www.youtube.com/api/timedtext?v=${videoId}&caps=asr${extra}`;

const playerResponseScript = (
    videoId: string,
    tracks: { baseUrl: string; languageCode: string; kind?: string }[],
) =>
    `var ytInitialPlayerResponse = ${JSON.stringify({
        captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
        videoDetails: { videoId, title: 'Lecture' },
    })};`;

const documentWith = (...scripts: string[]): Document => {
    const doc = document.implementation.createHTMLDocument();
    for (const content of scripts) {
        const script = doc.createElement('script');
        script.textContent = content;
        doc.body.append(script);
    }
    return doc;
};

const json3Response = (events: unknown[]) =>
    ({
        ok: true,
        text: async () => JSON.stringify({ events }),
    }) as Response;

// the modern panel markup recorded from a live watch page
const modernSegment = (time: string, text: string) => `
    <transcript-segment-view-model>
        <div aria-hidden="true" class="ytwTranscriptSegmentViewModelTimestamp">${time}</div>
        <div class="ytwTranscriptSegmentViewModelTimestampA11yLabel">${time} seconds</div>
        <span class="ytAttributedStringHost" role="text">${text}</span>
    </transcript-segment-view-model>`;

const transcriptPanel = (segments: string, visibility = 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') => `
    <ytd-engagement-panel-section-list-renderer target-id="PAmodern_transcript_view" visibility="${visibility}">
        <div id="visibility-button"><button aria-label="Close"></button></div>
        <div id="content">${segments}</div>
    </ytd-engagement-panel-section-list-renderer>`;

describe('transcript module', () => {
    let fetchMock: jest.Mock<typeof fetch>;

    beforeEach(() => {
        clearTranscriptCache();
        fetchMock = jest.fn<typeof fetch>();
        global.fetch = fetchMock;
    });

    afterEach(() => {
        jest.useRealTimers();
        document.body.innerHTML = '';
    });

    describe('parseTimedtextJson3', () => {
        it('parses valid json3 events', () => {
            const segments = parseTimedtextJson3({
                events: [
                    {
                        tStartMs: 1000,
                        dDurationMs: 2000,
                        segs: [{ utf8: 'Hello ' }, { utf8: 'world!' }],
                    },
                    { tStartMs: 3500, dDurationMs: 1500, segs: [{ utf8: 'Second segment.' }] },
                ],
            });

            expect(segments).toEqual([
                { startMs: 1000, durationMs: 2000, text: 'Hello world!' },
                { startMs: 3500, durationMs: 1500, text: 'Second segment.' },
            ]);
        });

        it('sorts events, clamps negative starts, and drops non-finite times', () => {
            const segments = parseTimedtextJson3({
                events: [
                    { tStartMs: 5000, dDurationMs: 1000, segs: [{ utf8: 'Later' }] },
                    { tStartMs: -500, dDurationMs: 500, segs: [{ utf8: 'Negative' }] },
                    { tStartMs: Number.NaN, segs: [{ utf8: 'Broken' }] },
                    { tStartMs: 2000, segs: [{ utf8: 'Middle' }] },
                ],
            });

            expect(segments.map((segment) => segment.text)).toEqual([
                'Negative',
                'Middle',
                'Later',
            ]);
            expect(segments[0]?.startMs).toBe(0);
            // a missing duration runs to the next segment
            expect(segments[1]?.durationMs).toBe(3000);
        });

        it('discards empty segments and malformed input', () => {
            expect(
                parseTimedtextJson3({
                    events: [
                        { tStartMs: 100, segs: [{ utf8: '   ' }] },
                        { tStartMs: 200, segs: [] },
                        null,
                        { tStartMs: 300, segs: [{ utf8: 'Valid' }] },
                    ],
                }),
            ).toHaveLength(1);
            expect(parseTimedtextJson3(null)).toEqual([]);
            expect(parseTimedtextJson3({ events: 'nope' })).toEqual([]);
        });

        it('caps segments at MAX_TRANSCRIPT_SEGMENTS', () => {
            const events = Array.from({ length: 12_000 }, (_, i) => ({
                tStartMs: i * 1000,
                dDurationMs: 900,
                segs: [{ utf8: `Segment ${i}` }],
            }));

            expect(parseTimedtextJson3({ events })).toHaveLength(MAX_TRANSCRIPT_SEGMENTS);
        });

        it('keeps markup as plain text', () => {
            const [segment] = parseTimedtextJson3({
                events: [{ tStartMs: 0, segs: [{ utf8: '<img src=x onerror="alert(1)">' }] }],
            });
            expect(segment?.text).toBe('<img src=x onerror="alert(1)">');
        });
    });

    describe('findCurrentSegmentIndex', () => {
        const segments: TranscriptSegment[] = [
            { startMs: 1000, durationMs: 2000, text: 'One' },
            { startMs: 4000, durationMs: 2000, text: 'Two' },
            { startMs: 8000, durationMs: 2000, text: 'Three' },
        ];

        it('finds the segment at or before a time', () => {
            expect(findCurrentSegmentIndex(segments, 500)).toBe(-1);
            expect(findCurrentSegmentIndex(segments, 1000)).toBe(0);
            expect(findCurrentSegmentIndex(segments, 6000)).toBe(1);
            expect(findCurrentSegmentIndex(segments, 10000)).toBe(2);
            expect(findCurrentSegmentIndex([], 1000)).toBe(-1);
        });
    });

    describe('search', () => {
        const segments: TranscriptSegment[] = [
            { startMs: 0, durationMs: 1000, text: 'Café au lait' },
            { startMs: 2000, durationMs: 1000, text: 'Coffee with milk' },
        ];

        it('matches case- and diacritic-insensitively', () => {
            const results = filterTranscriptSegments(segments, 'CAFE');
            expect(results).toHaveLength(1);
            expect(results[0]?.matchRange).toEqual([0, 4]);
            expect(normalizeSearchText('Ångström')).toBe('angstrom');
        });

        it('maps highlight ranges back to the original text', () => {
            // decomposed input and characters that expand when folded shift naive offsets
            const decomposed = [{ startMs: 0, durationMs: 1, text: 'cafe\u0301 au lait' }];
            const [match] = filterTranscriptSegments(decomposed, 'au');
            expect(match?.matchRange).toEqual([6, 8]);
            expect(decomposed[0]?.text.slice(...(match?.matchRange ?? [0, 0]))).toBe('au');

            // Hangul syllables decompose into several jamo, so folded offsets run ahead
            const expanding = [{ startMs: 0, durationMs: 1, text: '한국 tour' }];
            const [tour] = filterTranscriptSegments(expanding, 'tour');
            expect(tour?.matchRange).toEqual([3, 7]);
        });

        it('returns every segment for blank queries and none for misses', () => {
            expect(filterTranscriptSegments(segments, '   ')).toHaveLength(2);
            expect(filterTranscriptSegments(segments, 'nomatchhere')).toHaveLength(0);
        });
    });

    describe('caption tracks', () => {
        it('extracts nested arrays and tracks without a video filter', () => {
            expect(extractJsonArray('no array here', 0)).toBeNull();
            const sample = 'prefix: [{"name": "a]\\"b", "baseUrl": "u"}], suffix';
            expect(extractJsonArray(sample, sample.indexOf('['))).toContain('"baseUrl": "u"');

            const tracks = extractCaptionTracksFromText(
                '{"captionTracks":[{"name":{"runs":[{"text":"English"}]},"baseUrl":"https://www.youtube.com/api/timedtext?v=a","languageCode":"en","kind":"asr"}]}',
            );
            expect(tracks).toEqual([
                {
                    baseUrl: 'https://www.youtube.com/api/timedtext?v=a',
                    languageCode: 'en',
                    kind: 'asr',
                },
            ]);
            expect(extractCaptionTracksFromText('"captionTracks": [not json]')).toEqual([]);
        });

        it('ignores tracks that belong to another video', () => {
            // after in-page navigation the inline player response still describes the first video
            const stale = playerResponseScript('firstVideo1', [
                { baseUrl: timedtextUrl('firstVideo1'), languageCode: 'en' },
            ]);
            expect(extractCaptionTracksFromText(stale, 'secondVideo')).toEqual([]);
            expect(extractCaptionTracksFromText(stale, 'firstVideo1')).toHaveLength(1);

            const mixed =
                '"captionTracks":[{"baseUrl":"/api/timedtext?v=other","languageCode":"en"}]';
            expect(extractCaptionTracksFromText(mixed, 'mine123')).toEqual([]);
        });

        it('recognizes proof-of-origin bound tracks', () => {
            expect(
                requiresPoToken({
                    baseUrl: timedtextUrl('a', '&exp=xpe'),
                    languageCode: 'en',
                    kind: null,
                }),
            ).toBe(true);
            expect(
                requiresPoToken({ baseUrl: timedtextUrl('a'), languageCode: 'en', kind: null }),
            ).toBe(false);
        });

        it('prefers manual tracks in the base language', () => {
            const tracks = [
                { baseUrl: 'a', languageCode: 'fr', kind: null },
                { baseUrl: 'b', languageCode: 'en', kind: 'asr' },
                { baseUrl: 'c', languageCode: 'en-GB', kind: null },
            ];
            expect(chooseCaptionTrack(tracks, 'en-US')?.baseUrl).toBe('c');
            expect(chooseCaptionTrack(tracks.slice(0, 2), 'en-US')?.baseUrl).toBe('b');
            expect(chooseCaptionTrack(tracks.slice(1, 2), 'de')?.baseUrl).toBe('b');
            expect(chooseCaptionTrack([], 'en')).toBeNull();
        });

        it('parses clock times', () => {
            expect(parseClockTime('0:45')).toBe(45_000);
            expect(parseClockTime(' 1:02:03 ')).toBe(3_723_000);
            expect(parseClockTime('45 seconds')).toBeNull();
        });
    });

    describe('fetchTranscript', () => {
        it('fetches timedtext for the current video and caches the result', async () => {
            const doc = documentWith(
                playerResponseScript('video_success', [
                    { baseUrl: timedtextUrl('video_success', '&lang=fr'), languageCode: 'fr' },
                    { baseUrl: timedtextUrl('video_success', '&lang=en'), languageCode: 'en' },
                ]),
            );
            doc.documentElement.lang = 'en';
            fetchMock.mockResolvedValue(
                json3Response([
                    { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'First' }] },
                    { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'Second' }] },
                ]),
            );

            const transcript = await fetchTranscript('video_success', doc);
            expect(transcript?.segments).toHaveLength(2);
            expect(transcript?.kind).toBe('manual');
            expect(String(fetchMock.mock.calls[0]?.[0])).toContain('lang=en');
            expect(String(fetchMock.mock.calls[0]?.[0])).toContain('fmt=json3');

            expect(await fetchTranscript('video_success', doc)).toBe(transcript);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('evicts the least recently used transcript beyond three', async () => {
            fetchMock.mockImplementation(async () =>
                json3Response([{ tStartMs: 0, segs: [{ utf8: 'Line' }] }]),
            );
            for (const id of ['videoA1', 'videoB1', 'videoC1']) {
                await fetchTranscript(
                    id,
                    documentWith(
                        playerResponseScript(id, [
                            { baseUrl: timedtextUrl(id), languageCode: 'en' },
                        ]),
                    ),
                );
            }

            // reading A makes B the oldest entry
            expect(getCachedTranscript('videoA1')).not.toBeNull();
            await fetchTranscript(
                'videoD1',
                documentWith(
                    playerResponseScript('videoD1', [
                        { baseUrl: timedtextUrl('videoD1'), languageCode: 'en' },
                    ]),
                ),
            );

            expect(getCachedTranscript('videoA1')).not.toBeNull();
            expect(getCachedTranscript('videoB1')).toBeNull();
        });

        it('skips token-bound tracks, foreign hosts, and empty bodies without failing', async () => {
            const tokenBound = documentWith(
                playerResponseScript('xpeVideo1', [
                    { baseUrl: timedtextUrl('xpeVideo1', '&exp=xpe'), languageCode: 'en' },
                ]),
            );
            expect(await fetchTranscript('xpeVideo1', tokenBound)).toBeNull();
            expect(fetchMock).not.toHaveBeenCalled();

            const foreign = documentWith(
                playerResponseScript('foreign01', [
                    {
                        baseUrl: 'https://example.com/api/timedtext?v=foreign01',
                        languageCode: 'en',
                    },
                ]),
            );
            expect(await fetchTranscript('foreign01', foreign)).toBeNull();
            expect(fetchMock).not.toHaveBeenCalled();

            const empty = documentWith(
                playerResponseScript('emptyBody1', [
                    { baseUrl: timedtextUrl('emptyBody1'), languageCode: 'en', kind: 'asr' },
                ]),
            );
            fetchMock.mockResolvedValueOnce({ ok: true, text: async () => '' } as Response);
            expect(await fetchTranscript('emptyBody1', empty)).toBeNull();

            fetchMock.mockResolvedValueOnce({ ok: false, text: async () => '' } as Response);
            expect(await fetchTranscript('emptyBody1', empty)).toBeNull();

            fetchMock.mockRejectedValueOnce(new Error('network'));
            expect(await fetchTranscript('emptyBody1', empty)).toBeNull();
        });

        it('reads an open YouTube transcript panel for the current video', async () => {
            const doc = documentWith();
            doc.body.innerHTML = `
                <ytd-watch-flexy video-id="panelVideo"></ytd-watch-flexy>
                ${transcriptPanel(
                    modernSegment('0:19', 'Second line') +
                        modernSegment('0:00', 'First <b>line</b>') +
                        modernSegment('39:29', ''),
                )}`;

            const transcript = await fetchTranscript('panelVideo', doc);
            expect(transcript?.segments).toEqual([
                { startMs: 0, durationMs: 19_000, text: 'First line' },
                { startMs: 19_000, durationMs: 3_000, text: 'Second line' },
            ]);
        });

        it('ignores a panel that still shows the previous video', async () => {
            const doc = documentWith();
            doc.body.innerHTML = `
                <ytd-watch-flexy video-id="previous01"></ytd-watch-flexy>
                ${transcriptPanel(modernSegment('0:00', 'Old video'))}`;

            expect(await fetchTranscript('current01', doc)).toBeNull();
        });

        it('reads the legacy transcript renderer markup', () => {
            const doc = documentWith();
            doc.body.innerHTML = `
                <ytd-transcript-segment-renderer>
                    <div class="segment-timestamp">1:05</div>
                    <yt-formatted-string class="segment-text">Legacy text</yt-formatted-string>
                </ytd-transcript-segment-renderer>`;

            expect(readTranscriptPanel(doc)?.segments[0]).toMatchObject({
                startMs: 65_000,
                text: 'Legacy text',
            });
            expect(readTranscriptPanel(documentWith())).toBeNull();
        });
    });

    describe('loadTranscriptFromPanel', () => {
        it('opens YouTube’s panel, waits for stable segments, and closes it again', async () => {
            jest.useFakeTimers();
            document.body.innerHTML = `
                <ytd-watch-flexy video-id="openVideo1"></ytd-watch-flexy>
                <ytd-video-description-transcript-section-renderer>
                    <button>Show transcript</button>
                </ytd-video-description-transcript-section-renderer>
                <div id="panels"></div>`;

            const showButton = document.querySelector('button') as HTMLButtonElement;
            const closeClicks = jest.fn();
            const seenAsUserClick: boolean[] = [];
            showButton.addEventListener('click', (event) => {
                // the controller must not mistake this module's own click for the user's
                seenAsUserClick.push(isTranscriptButton(event.target));
                const panels = document.getElementById('panels') as HTMLElement;
                panels.innerHTML = transcriptPanel(modernSegment('0:00', 'Hi.'));
                panels
                    .querySelector('#visibility-button button')
                    ?.addEventListener('click', closeClicks);
                // a second batch renders a moment later
                window.setTimeout(() => {
                    panels
                        .querySelector('#content')
                        ?.insertAdjacentHTML('beforeend', modernSegment('0:05', 'Second batch.'));
                }, 100);
            });
            expect(isTranscriptButton(showButton)).toBe(true);

            const pending = loadTranscriptFromPanel({ videoId: 'openVideo1', openPanel: true });
            await jest.advanceTimersByTimeAsync(1_000);
            const transcript = await pending;

            expect(transcript?.segments.map((segment) => segment.text)).toEqual([
                'Hi.',
                'Second batch.',
            ]);
            expect(closeClicks).toHaveBeenCalledTimes(1);
            expect(seenAsUserClick).toEqual([false]);
            expect(getCachedTranscript('openVideo1')).toBe(transcript);
        });

        it('waits for the page to show the video before using its button', async () => {
            jest.useFakeTimers();
            document.body.innerHTML = `
                <ytd-watch-flexy video-id="previous01"></ytd-watch-flexy>
                <ytd-video-description-transcript-section-renderer>
                    <button>Show transcript</button>
                </ytd-video-description-transcript-section-renderer>`;
            const clicks = jest.fn();
            document.querySelector('button')?.addEventListener('click', clicks);

            const pending = loadTranscriptFromPanel({
                videoId: 'current01',
                openPanel: true,
                timeoutMs: 600,
            });
            await jest.advanceTimersByTimeAsync(400);
            expect(clicks).not.toHaveBeenCalled();

            await jest.advanceTimersByTimeAsync(1_000);
            expect(await pending).toBeNull();
        });

        it('gives up without a button, on timeout, and on abort', async () => {
            jest.useFakeTimers();
            document.body.innerHTML = '<ytd-watch-flexy video-id="noButton01"></ytd-watch-flexy>';
            expect(
                await loadTranscriptFromPanel({ videoId: 'noButton01', openPanel: true }),
            ).toBeNull();

            const waiting = loadTranscriptFromPanel({
                videoId: 'noButton01',
                openPanel: false,
                timeoutMs: 500,
            });
            await jest.advanceTimersByTimeAsync(1_000);
            expect(await waiting).toBeNull();

            const controller = new AbortController();
            const aborted = loadTranscriptFromPanel({
                videoId: 'noButton01',
                openPanel: false,
                signal: controller.signal,
            });
            controller.abort();
            expect(await aborted).toBeNull();

            expect(
                await loadTranscriptFromPanel({
                    videoId: 'noButton01',
                    openPanel: false,
                    signal: controller.signal,
                }),
            ).toBeNull();
        });
    });
});
