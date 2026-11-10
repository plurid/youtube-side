import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const distributionDirectory = path.join(packageRoot, 'distribution');

// a lecture with an English transcript and no chapters, and a chaptered video
export const LECTURE_VIDEO = process.env.LIVE_LECTURE_VIDEO || 'ZK3O402wf1c';
export const CHAPTERED_VIDEO = process.env.LIVE_CHAPTERED_VIDEO || 'aircAruvnKk';

export const sleep = (ms) =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

export const watchUrl = (videoId, startSeconds = 0) =>
    `https://www.youtube.com/watch?v=${videoId}${startSeconds > 0 ? `&t=${startSeconds}s` : ''}`;

/** Launches the installed Chrome with the built extension loaded unpacked. */
export const launchWithExtension = async ({ width = 1600, height = 1000 } = {}) => {
    const browser = await puppeteer.launch({
        ...(process.env.CHROME_PATH
            ? { executablePath: process.env.CHROME_PATH }
            : { channel: 'chrome' }),
        headless: !process.env.HEADFUL,
        pipe: true,
        enableExtensions: true,
        args: [
            `--window-size=${width},${height}`,
            '--lang=en-US',
            '--mute-audio',
            '--autoplay-policy=no-user-gesture-required',
        ],
        defaultViewport: { width, height },
    });

    const extensionId = await browser.installExtension(distributionDirectory);
    // YouTube serves a reduced page to user agents that announce headless Chrome
    const userAgent = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');

    return { browser, extensionId, userAgent };
};

export const openPage = async (session, { colorScheme } = {}) => {
    const page = await session.browser.newPage();
    await page.setUserAgent(session.userAgent);
    if (colorScheme) {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: colorScheme }]);
    }
    return page;
};

/** Fresh profiles in the EU get a cookie dialog that traps keyboard focus. */
export const dismissConsent = async (page) => {
    const dismissed = await page.evaluate(() => {
        const reject = [
            ...document.querySelectorAll(
                'tp-yt-paper-dialog button, ytd-consent-bump-v2-lightbox button',
            ),
        ].find((button) =>
            /^Reject/i.test(button.getAttribute('aria-label') || button.textContent?.trim() || ''),
        );
        reject?.click();
        return Boolean(reject);
    });

    if (dismissed) {
        await sleep(3_000);
    }
    return dismissed;
};

/** Waits out pre-roll ads, skipping them when YouTube allows it. */
export const skipAds = async (page, timeout = 60_000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
        const adShowing = await page.evaluate(() => {
            const player = document.querySelector('#movie_player');
            if (!player?.classList.contains('ad-showing')) {
                return false;
            }
            document
                .querySelector(
                    '.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button',
                )
                ?.click();
            return true;
        });
        if (!adShowing) {
            return true;
        }
        await sleep(500);
    }
    return false;
};

// automated, logged-out sessions cannot stream ranges past the initial buffer, so
// positions are set with the start-time URL parameter rather than by seeking
export const openVideo = async (page, videoId, { startSeconds = 0 } = {}) => {
    await page.goto(watchUrl(videoId, startSeconds), {
        waitUntil: 'networkidle2',
        timeout: 60_000,
    });
    await sleep(1_500);
    await dismissConsent(page);
    await skipAds(page);
};

/** Navigates the way YouTube's own links do, without a page load. */
export const navigateInPage = async (page, videoId) => {
    await page.evaluate((id) => {
        document.querySelector('ytd-app')?.dispatchEvent(
            new CustomEvent('yt-navigate', {
                bubbles: true,
                composed: true,
                detail: {
                    endpoint: {
                        commandMetadata: {
                            webCommandMetadata: {
                                url: `/watch?v=${id}`,
                                webPageType: 'WEB_PAGE_TYPE_WATCH',
                                rootVe: 3832,
                            },
                        },
                        watchEndpoint: { videoId: id },
                    },
                },
            }),
        );
    }, videoId);

    await waitFor(
        page,
        (id) => document.querySelector('ytd-watch-flexy')?.getAttribute('video-id') === id,
        20_000,
        videoId,
    );
    await skipAds(page);
};

export const pressShortcut = async (page, code) => {
    await page.keyboard.down('Alt');
    await page.keyboard.press(code);
    await page.keyboard.up('Alt');
};

/** Polls a page function until it returns a truthy value; resolves null on timeout. */
export const waitFor = async (page, predicate, timeout = 15_000, ...args) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
        const value = await page.evaluate(predicate, ...args).catch(() => null);
        if (value) {
            return value;
        }
        await sleep(250);
    }
    return null;
};

/** Replaces extension storage entries, from an extension page. */
export const writeStorage = async (session, items) => {
    const page = await session.browser.newPage();
    await page.goto(`chrome-extension://${session.extensionId}/popup.html`);
    await page.evaluate((items) => chrome.storage.local.set(items), items);
    await page.close();
};

/** Writes options the way the popup does, from an extension page. */
export const setOptions = async (session, values) => {
    const page = await session.browser.newPage();
    await page.goto(`chrome-extension://${session.extensionId}/popup.html`);
    await page.evaluate(async (values) => {
        const { youtubeSideOptions: stored } = await chrome.storage.local.get('youtubeSideOptions');
        await chrome.storage.local.set({
            youtubeSideOptions: {
                version: stored?.version ?? 3,
                values: { ...(stored?.values ?? {}), ...values },
            },
        });
    }, values);
    await page.close();
};

export const panelState = (page) =>
    page.evaluate(() => {
        const below = document.querySelector('#below');
        const video = document.querySelector('#movie_player video');
        return {
            active: below?.getAttribute('data-youtube-side-active') ?? null,
            view: below?.getAttribute('data-youtube-side-view') ?? null,
            suspended: below?.getAttribute('data-youtube-side-suspended') ?? null,
            study: Boolean(document.getElementById('youtube-side-study')),
            rect: below?.getBoundingClientRect().toJSON() ?? null,
            descriptionVisible: Boolean(
                document.querySelector('#below ytd-watch-metadata')?.getBoundingClientRect().height,
            ),
            content: document.getElementById('youtube-side-study-content')?.textContent ?? '',
            youtubePanel:
                document
                    .querySelector(
                        'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]',
                    )
                    ?.getAttribute('visibility') ?? null,
            time: video?.currentTime ?? null,
            paused: video?.paused ?? null,
        };
    });
