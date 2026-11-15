import { beforeEach, describe, expect, it } from '@jest/globals';

import { detectWatchLayout, measureYouTubePanel } from '~contentscript/page';
import { resolveSide } from '~contentscript/player';
import { BookmarkMarkers } from '~contentscript/study/markers';
import { studyKey } from '~data/study';
import { type ChromeMock, createChromeMock } from './chrome';

const wait = (ms = 10) =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });

const ticks = () =>
    [...document.querySelectorAll<HTMLElement>('.ytp-progress-bar .youtube-side-markers-tick')].map(
        (tick) => tick.style.left,
    );

describe('BookmarkMarkers', () => {
    let mock: ChromeMock;
    let video: HTMLVideoElement;
    let duration: number;

    beforeEach(() => {
        document.body.innerHTML =
            '<div id="movie_player"><div class="ytp-progress-bar"></div><video></video></div>';
        video = document.querySelector('video') as HTMLVideoElement;
        duration = 200;
        Object.defineProperty(video, 'duration', { configurable: true, get: () => duration });
        mock = createChromeMock({
            [studyKey('markVideo1')]: {
                bookmarks: [
                    { timeMs: 50_000, createdAt: 1 },
                    { timeMs: 150_000, createdAt: 2 },
                    { timeMs: 900_000, createdAt: 3 },
                ],
            },
        });
    });

    it('draws a tick per bookmark inside the video, and follows storage changes', async () => {
        const markers = new BookmarkMarkers();
        markers.setVideo('markVideo1');
        await wait();
        expect(ticks()).toEqual(['25%', '75%']);

        await mock.chrome.storage.local.set({
            [studyKey('markVideo1')]: { bookmarks: [{ timeMs: 100_000, createdAt: 1 }] },
        });
        expect(ticks()).toEqual(['50%']);

        // a re-render with nothing changed keeps the same elements
        const before = document.querySelector('.youtube-side-markers-tick');
        markers.render();
        expect(document.querySelector('.youtube-side-markers-tick')).toBe(before);

        await mock.chrome.storage.local.remove(studyKey('markVideo1'));
        expect(ticks()).toEqual([]);
        markers.destroy();
    });

    it('stays off during ads, for live streams, when disabled, and without a video', async () => {
        const markers = new BookmarkMarkers();
        markers.setVideo('markVideo1');
        await wait();
        expect(ticks()).toHaveLength(2);

        document.getElementById('movie_player')?.classList.add('ad-showing');
        markers.render();
        expect(ticks()).toHaveLength(0);
        document.getElementById('movie_player')?.classList.remove('ad-showing');

        duration = Number.POSITIVE_INFINITY;
        markers.render();
        expect(ticks()).toHaveLength(0);
        duration = 200;

        markers.setEnabled(false);
        expect(ticks()).toHaveLength(0);
        markers.setEnabled(true);
        expect(ticks()).toHaveLength(2);

        markers.setVideo(null);
        expect(ticks()).toHaveLength(0);
        markers.destroy();
    });

    it('moves to a progress bar YouTube rebuilt', async () => {
        const markers = new BookmarkMarkers();
        markers.setVideo('markVideo1');
        await wait();

        const player = document.getElementById('movie_player') as HTMLElement;
        player.querySelector('.ytp-progress-bar')?.remove();
        player.insertAdjacentHTML('afterbegin', '<div class="ytp-progress-bar" id="fresh"></div>');
        markers.render();
        expect(document.querySelectorAll('#fresh .youtube-side-markers-tick')).toHaveLength(2);
        markers.destroy();
        expect(ticks()).toHaveLength(0);
    });
});

describe('watch layout adapters', () => {
    it('tells the classic layout from the panels layout, and waits for the title', () => {
        document.body.innerHTML =
            '<div id="below"><ytd-watch-metadata><h1></h1></ytd-watch-metadata></div>';
        expect(detectWatchLayout()).toBe('unknown');

        const heading = document.querySelector('h1') as HTMLElement;
        heading.textContent = 'A title';
        expect(detectWatchLayout()).toBe('panels');

        document
            .querySelector('ytd-watch-metadata')
            ?.insertAdjacentHTML('beforeend', '<div id="description"></div>');
        expect(detectWatchLayout()).toBe('classic');

        document.body.innerHTML =
            '<div id="below"><ytd-watch-metadata><h1>T</h1></ytd-watch-metadata><ytd-comments id="comments"></ytd-comments></div>';
        expect(detectWatchLayout()).toBe('classic');

        document.body.innerHTML = '';
        expect(detectWatchLayout()).toBe('unknown');
    });

    it("measures only YouTube's expanded side panels, never an ad's companion panel", () => {
        // recorded on 2026-11-15: an ad's companion panel opens by itself while the ad plays
        document.body.innerHTML = `
            <ytd-engagement-panel-section-list-renderer visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"></ytd-engagement-panel-section-list-renderer>
            <ytd-engagement-panel-section-list-renderer target-id="engagement-panel-ads" visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"></ytd-engagement-panel-section-list-renderer>
            <ytd-engagement-panel-section-list-renderer visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"></ytd-engagement-panel-section-list-renderer>
        `;
        const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
        Object.defineProperty(panels[1], 'getBoundingClientRect', {
            value: () => ({
                top: 0,
                left: 1000,
                right: 1400,
                bottom: 800,
                width: 400,
                height: 800,
            }),
        });
        expect(measureYouTubePanel()).toBeNull();

        const expanded = panels[2] as HTMLElement;
        Object.defineProperty(expanded, 'getBoundingClientRect', {
            value: () => ({
                top: 0,
                left: 1000,
                right: 1400,
                bottom: 800,
                width: 400,
                height: 800,
            }),
        });
        expect(measureYouTubePanel()).toMatchObject({ left: 1000, width: 400 });
    });

    it('takes the free edge only when the preferred one is covered', () => {
        const base = { width: 500, viewportWidth: 1600 };
        const rightPanel = {
            top: 0,
            left: 1200,
            right: 1600,
            bottom: 800,
            width: 400,
            height: 800,
        };
        const fullWidth = { ...rightPanel, left: 0, width: 1600 };

        expect(resolveSide({ ...base, left: false, youtubePanel: null })).toEqual({
            left: false,
            dodged: false,
        });
        expect(resolveSide({ ...base, left: false, youtubePanel: rightPanel })).toEqual({
            left: true,
            dodged: true,
        });
        expect(resolveSide({ ...base, left: true, youtubePanel: rightPanel })).toEqual({
            left: true,
            dodged: false,
        });
        expect(resolveSide({ ...base, left: false, youtubePanel: fullWidth })).toEqual({
            left: false,
            dodged: false,
        });
    });
});
