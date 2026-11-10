import { afterEach, describe, expect, it } from '@jest/globals';

import {
    extractChaptersFromDOM,
    parseDescriptionChapters,
    parseTimestampToMs,
} from '~contentscript/study/chapters';

describe('chapters parsing', () => {
    describe('parseTimestampToMs', () => {
        it('parses mm:ss and hh:mm:ss', () => {
            expect(parseTimestampToMs(undefined, '02', '30')).toBe(150_000);
            expect(parseTimestampToMs('1', '10', '00')).toBe(4_200_000);
        });
    });

    describe('parseDescriptionChapters', () => {
        it('parses multi-line description chapters with various separators', () => {
            const description = `
Here is the outline of the talk:
0:00 Introduction
1:45 - The Problem Statement
5:20 • Proposed Architecture
1:10:05 — Summary and Q&A
            `;

            const chapters = parseDescriptionChapters(description);
            expect(chapters).not.toBeNull();
            expect(chapters?.length).toBe(4);
            expect(chapters?.[0]).toEqual({ startMs: 0, title: 'Introduction' });
            expect(chapters?.[1]).toEqual({ startMs: 105_000, title: 'The Problem Statement' });
            expect(chapters?.[2]).toEqual({ startMs: 320_000, title: 'Proposed Architecture' });
            expect(chapters?.[3]).toEqual({ startMs: 4_205_000, title: 'Summary and Q&A' });
        });

        it('rejects a single timestamp', () => {
            const text = 'Check out this moment at 3:15!';
            expect(parseDescriptionChapters(text)).toBeNull();
        });

        it('rejects non-increasing timestamps', () => {
            const text = `
0:00 Intro
5:00 Architecture
3:00 Oops backwards
            `;
            expect(parseDescriptionChapters(text)).toBeNull();
        });

        it('handles empty or invalid strings gracefully', () => {
            expect(parseDescriptionChapters('')).toBeNull();
            expect(parseDescriptionChapters('no timestamps here')).toBeNull();
        });
    });

    describe('extractChaptersFromDOM', () => {
        afterEach(() => {
            document.body.innerHTML = '';
        });

        it('extracts from macro markers DOM when available', () => {
            const container = document.createElement('div');
            container.innerHTML = `
                <ytd-macro-markers-list-item-renderer>
                    <div id="time">0:00</div>
                    <div id="details"><h4>Start</h4></div>
                </ytd-macro-markers-list-item-renderer>
                <ytd-macro-markers-list-item-renderer>
                    <div id="time">2:30</div>
                    <div id="details"><h4>Middle</h4></div>
                </ytd-macro-markers-list-item-renderer>
            `;
            document.body.append(container);

            const result = extractChaptersFromDOM(document);
            expect(result).toHaveLength(2);
            expect(result?.[0]?.title).toBe('Start');
            expect(result?.[1]?.startMs).toBe(150_000);
        });

        it('reads current YouTube markers once, preferring the chapters panel', () => {
            // recorded markup: the title sits in h3.macro-markers, and each chapter is
            // rendered in the description cards, the chapters panel, and key moments
            const marker = (time: string, title: string) => `
                <ytd-macro-markers-list-item-renderer>
                    <a id="endpoint"><div id="details">
                        <h3 class="macro-markers" title="${title}">${title}</h3>
                        <h3 class="problem-walkthroughs" hidden title="${title}">${title}</h3>
                        <div id="time">${time}</div>
                    </div></a>
                </ytd-macro-markers-list-item-renderer>`;

            document.body.innerHTML = `
                <div id="items">${marker('1:07', 'Card copy')}${marker('0:00', 'Intro')}</div>
                <ytd-engagement-panel-section-list-renderer target-id="engagement-panel-macro-markers-description-chapters">
                    ${marker('0:00', 'Intro')}${marker('1:07', 'Layers')}${marker('1:07', 'Duplicate')}${marker('2:42', 'Weights')}
                </ytd-engagement-panel-section-list-renderer>
                <ytd-engagement-panel-section-list-renderer target-id="engagement-panel-macro-markers-auto-chapters">
                    ${marker('0:30', 'Key moment')}
                </ytd-engagement-panel-section-list-renderer>`;

            expect(extractChaptersFromDOM(document)).toEqual([
                { startMs: 0, title: 'Intro' },
                { startMs: 67_000, title: 'Layers' },
                { startMs: 162_000, title: 'Weights' },
            ]);
        });

        it('falls back to all markers, then the description', () => {
            document.body.innerHTML = `
                <ytd-macro-markers-list-item-renderer><div id="time">2:00</div><div id="details"><h4>B</h4></div></ytd-macro-markers-list-item-renderer>
                <ytd-macro-markers-list-item-renderer><div id="time">0:10</div><div id="details"><h4>A</h4></div></ytd-macro-markers-list-item-renderer>
                <ytd-macro-markers-list-item-renderer><div id="time">no time</div><div id="details"><h4>C</h4></div></ytd-macro-markers-list-item-renderer>`;
            expect(extractChaptersFromDOM(document)?.map((chapter) => chapter.title)).toEqual([
                'A',
                'B',
            ]);
        });

        it('falls back to description text in DOM', () => {
            const desc = document.createElement('div');
            desc.id = 'description';
            desc.textContent = '0:00 Intro\n1:00 Outro';
            document.body.append(desc);

            const result = extractChaptersFromDOM(document);
            expect(result).toHaveLength(2);
            expect(result?.[1]?.title).toBe('Outro');
        });
        it('returns null when no chapters or description exist in DOM', () => {
            expect(extractChaptersFromDOM(document)).toBeNull();
        });
    });
});
