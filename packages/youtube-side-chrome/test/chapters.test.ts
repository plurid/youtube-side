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
