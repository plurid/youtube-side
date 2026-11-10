// Runs the built extension in the installed Chrome against live YouTube.
// Needs `pnpm build` first (the `test:live` script does it) and network access.
import {
    CHAPTERED_VIDEO,
    LECTURE_VIDEO,
    launchWithExtension,
    navigateInPage,
    openPage,
    openVideo,
    panelState,
    pressShortcut,
    setOptions,
    sleep,
    waitFor,
} from './browser.mjs';

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok: Boolean(ok) });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const clickStudy = (page, selector) =>
    page.evaluate((selector) => document.querySelector(selector)?.click(), selector);
const clickStudyButton = (page, text) =>
    page.evaluate(
        (text) =>
            [...document.querySelectorAll('#youtube-side-study button')]
                .find((button) => button.textContent === text)
                ?.click(),
        text,
    );

const session = await launchWithExtension();
const page = await openPage(session);
const errors = [];
page.on('pageerror', (error) => {
    errors.push(String(error));
});
const cdp = await page.createCDPSession();
await cdp.send('Runtime.enable');
cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    if (/contentscript|youtube-side/i.test(JSON.stringify(exceptionDetails))) {
        errors.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
    }
});

try {
    console.log(`Lecture ${LECTURE_VIDEO}, chaptered ${CHAPTERED_VIDEO}`);
    await openVideo(page, LECTURE_VIDEO);
    await page.click('body').catch(() => undefined);

    // activation and the Side view
    await pressShortcut(page, 'KeyS');
    await sleep(800);
    let state = await panelState(page);
    check(
        'Alt+S opens the panel flush under the masthead',
        state.active === 'true' && state.rect?.left === 0 && state.rect?.top === 56,
        JSON.stringify(state.rect),
    );
    check(
        'the Side view shows YouTube content under the study header',
        state.study && !state.view && state.descriptionVisible,
    );

    // transcript through YouTube's own panel
    await pressShortcut(page, 'KeyT');
    const rowCount = await waitFor(
        page,
        () => document.querySelectorAll('.youtube-side-transcript-row').length || null,
        20_000,
    );
    state = await panelState(page);
    check('Alt+T opens the Transcript view', state.view === 'transcript');
    check('the transcript loads', (rowCount ?? 0) > 100, `${rowCount} rows`);
    check(
        "YouTube's transcript panel is closed again",
        state.youtubePanel !== 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED',
        state.youtubePanel,
    );
    check("YouTube's own content is hidden in a study view", !state.descriptionVisible);

    await page.evaluate(() =>
        document.querySelectorAll('.youtube-side-transcript-row')[50]?.click(),
    );
    await sleep(500);
    const expectedTime = await page.evaluate(
        () =>
            Number(document.querySelectorAll('.youtube-side-transcript-row')[50]?.dataset.seek) /
            1000,
    );
    state = await panelState(page);
    check(
        'clicking a line seeks the video',
        Math.abs(state.time - expectedTime) < 1.5,
        `${state.time} vs ${expectedTime}`,
    );

    // search, typed without triggering YouTube's single-key shortcuts
    const pausedBeforeTyping = state.paused;
    await page.focus('#youtube-side-study input[type="search"]');
    await page.keyboard.type('matrix');
    await sleep(400);
    const search = await page.evaluate(() => ({
        rows: document.querySelectorAll('.youtube-side-transcript-row').length,
        marks: document.querySelectorAll('.youtube-side-transcript-row mark').length,
    }));
    state = await panelState(page);
    check(
        'search filters and highlights matches',
        search.rows > 0 && search.rows === search.marks && search.rows < rowCount,
        JSON.stringify(search),
    );
    check(
        'typing in the search box leaves playback and the page alone',
        state.paused === pausedBeforeTyping && state.active === 'true',
    );
    await page.keyboard.press('Escape');
    await sleep(300);

    // tab arrow keys stay inside the panel
    await page.focus('#youtube-side-tab-transcript');
    const timeBeforeArrow = (await panelState(page)).time;
    await page.keyboard.press('ArrowRight');
    await sleep(400);
    state = await panelState(page);
    check('arrow keys move between the study tabs', state.view === 'chapters');
    check(
        'arrow keys in the tabs do not seek the video',
        Math.abs(state.time - timeBeforeArrow) < 3,
        `${timeBeforeArrow} -> ${state.time}`,
    );
    check(
        'a video without chapters says so',
        /No chapters available/.test(state.content),
        state.content,
    );

    // Space on a focused row activates the row only
    await clickStudy(page, '#youtube-side-tab-transcript');
    await sleep(300);
    await page.evaluate(() =>
        document.querySelectorAll('.youtube-side-transcript-row')[10]?.focus(),
    );
    const pausedBeforeSpace = (await panelState(page)).paused;
    await page.keyboard.press('Space');
    await sleep(500);
    state = await panelState(page);
    check(
        'Space on a focused line seeks without toggling playback',
        state.paused === pausedBeforeSpace,
        `paused ${pausedBeforeSpace} -> ${state.paused}`,
    );

    // notes, and focus surviving layout passes
    await clickStudy(page, '#youtube-side-tab-notes');
    await sleep(300);
    await clickStudyButton(page, '+ Bookmark');
    await sleep(800);
    state = await panelState(page);
    check('a captured bookmark shows up in Notes', /Bookmarks \(1\)/.test(state.content));

    await page.focus('#youtube-side-study textarea');
    await page.keyboard.type('note for the lecture');
    await page.setViewport({ width: 1500, height: 950 });
    await sleep(600);
    check(
        'resizing the window keeps focus and typed notes',
        await page.evaluate(
            () =>
                document.activeElement?.tagName === 'TEXTAREA' &&
                document.activeElement.value === 'note for the lecture',
        ),
    );
    await page.setViewport({ width: 1600, height: 1000 });

    // turning study mode off from a study view
    await setOptions(session, { studyEnabled: false });
    await sleep(800);
    state = await panelState(page);
    check(
        'turning study mode off restores YouTube content',
        !state.study && !state.view && state.descriptionVisible,
    );
    await setOptions(session, { studyEnabled: true });
    await sleep(800);

    // player anchor in theater mode
    await setOptions(session, { layoutAnchor: 'player' });
    await page.click('#movie_player').catch(() => undefined);
    await page.keyboard.press('t');
    await sleep(1_500);
    const theater = await page.evaluate(() => ({
        theater: document.querySelector('ytd-watch-flexy')?.hasAttribute('theater'),
        player: document.querySelector('#movie_player')?.getBoundingClientRect().toJSON(),
        below: document.querySelector('#below')?.getBoundingClientRect().toJSON(),
        viewport: window.innerHeight,
    }));
    check(
        'the player anchor follows the theater player',
        theater.theater &&
            Math.abs(theater.below.top - Math.max(56, theater.player.top)) < 2 &&
            Math.abs(
                theater.below.height -
                    Math.min(theater.player.height, theater.viewport - theater.below.top),
            ) < 2,
        JSON.stringify({ player: theater.player, below: theater.below }),
    );
    await page.keyboard.press('t');
    await sleep(800);
    await setOptions(session, { layoutAnchor: 'viewport' });

    // chapters, notes, and transcript after in-page navigation
    await navigateInPage(page, CHAPTERED_VIDEO);
    await clickStudy(page, '#youtube-side-tab-chapters');
    await waitFor(
        page,
        () => document.querySelectorAll('.youtube-side-chapter-row').length || null,
        10_000,
    );
    const chapterTitles = await page.evaluate(() =>
        [...document.querySelectorAll('.youtube-side-chapter-row .youtube-side-text')].map(
            (node) => node.textContent,
        ),
    );
    check(
        'chapters load for the new video',
        chapterTitles.length >= 2 && new Set(chapterTitles).size === chapterTitles.length,
        chapterTitles.join(' | '),
    );

    await clickStudy(page, '#youtube-side-tab-notes');
    await sleep(500);
    state = await panelState(page);
    check('notes are kept per video', /Bookmarks \(0\)/.test(state.content));

    await clickStudy(page, '#youtube-side-tab-transcript');
    const outcome = await waitFor(
        page,
        () =>
            document.querySelectorAll('.youtube-side-transcript-row').length ||
            (/Couldn't load the transcript/.test(
                document.getElementById('youtube-side-study-content')?.textContent ?? '',
            )
                ? 'failed'
                : null),
        20_000,
    );
    const youtubeRendered = await page.evaluate(
        () =>
            document.querySelectorAll(
                'transcript-segment-view-model, ytd-transcript-segment-renderer',
            ).length,
    );
    // logged out, YouTube's own panel sometimes cannot load; the view must then offer a retry
    check(
        'the transcript belongs to the new video, or the view reports that YouTube could not load it',
        (typeof outcome === 'number' && outcome > 20) || (outcome === 'failed' && !youtubeRendered),
        String(outcome),
    );
    state = await panelState(page);
    check(
        "YouTube's transcript panel is closed afterwards",
        state.youtubePanel !== 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED',
        state.youtubePanel,
    );

    // miniplayer suspension
    await page.click('#movie_player').catch(() => undefined);
    await page.keyboard.press('i');
    await sleep(2_000);
    state = await panelState(page);
    const miniplayer = await page.evaluate(() =>
        document.querySelector('ytd-app')?.hasAttribute('miniplayer-is-active'),
    );
    check('the miniplayer suspends the panel', miniplayer && state.suspended === 'true');
    await page.keyboard.press('i');
    await sleep(2_500);
    state = await panelState(page);
    check('leaving the miniplayer restores the panel', state.active === 'true' && !state.suspended);

    // deactivation
    await page.click('body').catch(() => undefined);
    await pressShortcut(page, 'KeyS');
    await sleep(600);
    state = await panelState(page);
    check('Alt+S again restores the original page', !state.active && !state.view && !state.study);

    check('no content-script errors', errors.length === 0, errors.join(' | ').slice(0, 300));
} finally {
    await session.browser.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length > 0 ? 1 : 0;
