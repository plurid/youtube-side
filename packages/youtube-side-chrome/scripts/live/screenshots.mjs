// Writes Chrome Web Store screenshots (1280x800) of the built extension on live YouTube.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import {
    CHAPTERED_VIDEO,
    LECTURE_VIDEO,
    launchWithExtension,
    openPage,
    openVideo,
    packageRoot,
    pressShortcut,
    setOptions,
    sleep,
    waitFor,
    writeStorage,
} from './browser.mjs';

const WIDTH = 1280;
const HEIGHT = 800;
const ATTEMPTS = 4;
// SCREENSHOTS_ONLY=4,5 regenerates only the scenes whose file names start with those prefixes
const only = process.env.SCREENSHOTS_ONLY?.split(',').map((prefix) => prefix.trim());
const outputDirectory = process.env.SCREENSHOT_DIR
    ? path.resolve(process.env.SCREENSHOT_DIR)
    : path.resolve(packageRoot, '..', '..', 'about', 'images', 'store');

const BOOKMARKS = [
    [230, 'Two equations, two unknowns', 'Start from the 2 by 2 case.'],
    [425, 'Row picture', 'Each equation is a line; the solution is where they meet.'],
    [760, 'Column picture', 'Combine the columns to produce b.'],
];
const NOTE =
    'Ax = b can be read two ways: rows are lines or planes meeting at the solution, columns are vectors combined to reach b.';

// ads, sponsored cards, the merch shelf, and transient player overlays
const CLUTTER = [
    '#player-ads',
    '#masthead-ad',
    'ytd-ad-slot-renderer',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-companion-slot-renderer',
    'ytd-action-companion-ad-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-display-ad-renderer',
    'ytd-banner-promo-renderer',
    'ytd-statement-banner-renderer',
    'ytd-merch-shelf-renderer',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
    '.ytp-ad-module',
    '.ytp-cards-teaser',
    '.ytp-ce-element',
    '.ytp-paid-content-overlay',
    '.ytp-spinner',
    '.ytp-tooltip',
].join(', ');

const TOPICS = {
    [CHAPTERED_VIDEO]: [
        '3Blue1Brown',
        'neural',
        'deep learning',
        'machine learning',
        'gradient',
        'backpropagation',
        'transformer',
        'LLM',
        'math',
        'calculus',
        'physics',
        'AI',
    ],
    [LECTURE_VIDEO]: [
        'MIT',
        'OpenCourseWare',
        'Strang',
        'linear algebra',
        'matrix',
        'matrices',
        'lecture',
        'course',
        'math',
        'calculus',
        'algebra',
        'equation',
    ],
};

const tidy = (page, clutter, topics) =>
    page.evaluate(
        (clutter, topics) => {
            const hide = (element) => {
                element.style.setProperty('display', 'none', 'important');
            };
            for (const element of document.querySelectorAll(clutter)) {
                hide(element);
            }
            const onTopic = topics.length > 0 ? new RegExp(`(?:${topics.join('|')})`, 'i') : null;
            for (const item of document.querySelectorAll('#related #contents > *')) {
                const text = item.textContent ?? '';
                if (
                    /Sponsored|Recommendations not quite right|turn on (watch )?history/i.test(
                        text,
                    ) ||
                    (onTopic && !onTopic.test(text))
                ) {
                    hide(item);
                }
            }
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
        },
        clutter,
        topics,
    );

/** The main video shows the requested moment, with no ad and no player error. */
const isCleanFrame = (page, seconds) =>
    page.evaluate((seconds) => {
        const player = document.querySelector('#movie_player');
        const video = player?.querySelector('video');
        const error = document.querySelector('.ytp-error');
        return Boolean(
            video &&
                !player.classList.contains('ad-showing') &&
                !(error && error.getBoundingClientRect().height > 0) &&
                video.readyState >= 2 &&
                Math.abs(video.currentTime - seconds) < 30,
        );
    }, seconds);

const waitForFrame = (page, seconds) =>
    waitFor(
        page,
        (seconds) => {
            const player = document.querySelector('#movie_player');
            const video = player?.querySelector('video');
            if (!video) {
                return null;
            }
            if (player.classList.contains('ad-showing')) {
                document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern')?.click();
                return null;
            }
            return video.readyState >= 3 && Math.abs(video.currentTime - seconds) < 30
                ? true
                : null;
        },
        60_000,
        seconds,
    );

const setPlaying = (page, playing) =>
    page.evaluate((playing) => {
        const video = document.querySelector('#movie_player video');
        if (playing) {
            void video?.play();
        } else {
            video?.pause();
        }
    }, playing);

/** Plays briefly so the open panel receives time updates, then holds the frame. */
const settle = async (page) => {
    await setPlaying(page, true);
    await sleep(1_500);
    await setPlaying(page, false);
};

const activate = async (page) => {
    await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
    });
    await pressShortcut(page, 'KeyS');
    await sleep(2_000);
};

const openTab = (page, view) =>
    page.evaluate((view) => {
        document.getElementById(`youtube-side-tab-${view}`)?.click();
    }, view);

const studyFixture = () => {
    const now = Date.now();
    return {
        version: 1,
        videos: {
            [LECTURE_VIDEO]: {
                bookmarks: BOOKMARKS.map(([seconds, label, note], index) => ({
                    timeMs: seconds * 1_000,
                    label,
                    note,
                    createdAt: now + index,
                })),
                note: NOTE,
                updatedAt: now,
            },
        },
    };
};

/**
 * YouTube A/B tests a watch layout that moves the description and comments out
 * of the panel; only the standard layout shows what the extension does.
 */
const isStandardLayout = (page) =>
    waitFor(
        page,
        () =>
            (document.querySelector('#below #description-inline-expander')?.getBoundingClientRect()
                .height ?? 0) > 0 || null,
        10_000,
    );

/**
 * Renders a scene in a fresh profile, so each retry is a new YouTube visitor;
 * retries cover ads, player errors, and the experimental layout.
 */
const scene = async (name, { colorScheme, videoId, seconds, options = {} }, prepare) => {
    if (only && !only.some((prefix) => name.startsWith(prefix))) {
        return;
    }

    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        const session = await launchWithExtension({ width: WIDTH, height: HEIGHT });
        try {
            await setOptions(session, { height: 700, ...options });
            await writeStorage(session, { youtubeSideStudy: studyFixture() });

            const page = await openPage(session, { colorScheme });
            await openVideo(page, videoId, { startSeconds: seconds });
            if (!(await waitForFrame(page, seconds))) {
                throw new Error('the video did not reach the requested moment');
            }
            if (!(await isStandardLayout(page))) {
                throw new Error('YouTube served its experimental watch layout');
            }
            await setPlaying(page, false);
            await activate(page);
            await prepare(page);
            await page.mouse.move(WIDTH - 4, HEIGHT - 4);
            await sleep(1_000);
            await tidy(page, CLUTTER, TOPICS[videoId] ?? []);
            // thumbnails lazy-load as hidden items move others into view
            await waitFor(
                page,
                () =>
                    [...document.querySelectorAll('#related img')]
                        .filter((image) => {
                            const rect = image.getBoundingClientRect();
                            return rect.height > 0 && rect.top < window.innerHeight;
                        })
                        .every((image) => image.complete && image.naturalWidth > 0) || null,
                8_000,
            );
            if (!(await isCleanFrame(page, seconds))) {
                throw new Error('an ad or a player error is showing');
            }

            const file = path.join(outputDirectory, name);
            await page.screenshot({ path: file });
            console.log(`wrote ${path.relative(process.cwd(), file)}`);
            return;
        } catch (error) {
            console.warn(`${name}: attempt ${attempt} failed: ${error.message}`);
            if (attempt === ATTEMPTS) {
                process.exitCode = 1;
            }
        } finally {
            await session.browser.close();
        }
    }
};

await mkdir(outputDirectory, { recursive: true });

await scene(
    '1-side-panel.png',
    {
        colorScheme: 'dark',
        videoId: CHAPTERED_VIDEO,
        seconds: 340,
        options: { opacity: 62, blur: 10 },
    },
    async () => undefined,
);

await scene(
    '2-transcript-search.png',
    {
        colorScheme: 'dark',
        videoId: LECTURE_VIDEO,
        seconds: 610,
        options: { opacity: 92, blur: 3 },
    },
    async (page) => {
        await openTab(page, 'transcript');
        await waitFor(
            page,
            () => document.querySelectorAll('.youtube-side-transcript-row').length || null,
            25_000,
        );
        await page.focus('#youtube-side-study input[type="search"]');
        await page.keyboard.type('vector');
        await sleep(600);
    },
);

await scene(
    '3-chapters.png',
    {
        colorScheme: 'dark',
        videoId: CHAPTERED_VIDEO,
        seconds: 345,
        options: { opacity: 90, blur: 3 },
    },
    async (page) => {
        await openTab(page, 'chapters');
        await waitFor(
            page,
            () => document.querySelectorAll('.youtube-side-chapter-row').length || null,
            10_000,
        );
        await settle(page);
    },
);

await scene(
    '4-notes.png',
    {
        colorScheme: 'dark',
        videoId: LECTURE_VIDEO,
        seconds: 425,
        options: { opacity: 94, blur: 3 },
    },
    async (page) => {
        await openTab(page, 'notes');
        await waitFor(
            page,
            (count) => document.querySelectorAll('.youtube-side-bookmark').length === count || null,
            10_000,
            BOOKMARKS.length,
        );
    },
);

await scene(
    '5-theater-anchor.png',
    {
        colorScheme: 'dark',
        videoId: CHAPTERED_VIDEO,
        seconds: 345,
        options: { layoutAnchor: 'player', opacity: 88, blur: 3 },
    },
    async (page) => {
        await page.click('#movie_player').catch(() => undefined);
        await page.keyboard.press('t');
        await sleep(1_500);
        await settle(page);
    },
);

await scene(
    '6-light-right.png',
    {
        colorScheme: 'light',
        videoId: LECTURE_VIDEO,
        seconds: 900,
        options: { left: false, recommendations: false, opacity: 100, blur: 0 },
    },
    async () => undefined,
);
