# YouTube Side: how it works

YouTube Side is a Manifest V3 Chrome extension that lifts the YouTube watch page's details panel (description, comments, and live chat) beside the video, so it can be read without scrolling away from the picture. On top of that it adds a **study mode** (transcript, chapters, bookmarks, and notes inside the same panel) and an **adaptive layout** (player-anchored geometry, automatic suspension in fullscreen and the miniplayer, and opt-in activation rules).

YouTube stays the data source. The extension repositions and annotates YouTube's own content; it does not host or re-render it.

User-facing behavior and shortcuts are described in the [README](../README.md). This document is for working on the code.

## Design rules

These are binding for changes to the extension:

1. **The content script is dependency-free.** React, styled-components, and Plurid UI exist only in the popup. The content script is plain TypeScript and DOM APIs, held to a bundle budget.
2. **Restyle in place, never move YouTube's nodes.** The panel is YouTube's own `#below` element, changed only through `data-youtube-side-*` attributes, CSS custom properties, and one injected stylesheet. Reparenting `#below` would break YouTube's styles scoped under `ytd-watch-flexy`. Turning the panel off removes every attribute and property the panel added (hiding recommendations is a separate setting and stays as chosen).
3. **User-controlled behavior.** Nothing activates unless the user asks: automatic activation is opt-in (`never` by default), and closing the panel by hand wins for the rest of that video. Network activity happens only when the user opens the Transcript view.
4. **Selectors live in adapters.** YouTube markup is undocumented and changes. Page and player selectors belong in `contentscript/page.ts`; transcript and chapter markup belong in `study/transcript.ts` and `study/chapters.ts`. Adapters return `null` on any mismatch, and the feature shows an empty state instead of failing.
5. **Bounded observation.** Observers watch specific attributes on specific elements; the one subtree observer (late discovery of `#below` and `#related`) stops itself after 10 seconds. Timers and listeners stop with the feature that started them.
6. **Text only, never HTML.** Page- and user-controlled strings are rendered with `textContent` or text nodes. YouTube enforces Trusted Types, so `innerHTML` would also throw.
7. **Validate everything read from storage.** Options and study data are normalized on every read and write; dimensions, counts, and string lengths are clamped so a corrupted value can never break the layout or grow storage without bound.
8. **Writing style.** No em dashes in documentation or UI text, and no manual line breaks inside paragraphs in documentation.

## Repository layout

```text
README.md                         user documentation
docs/ARCHITECTURE.md              this document
about/                            logo, promo art, store listing text and screenshots
packages/youtube-side-chrome/
  source/
    manifest.json                 MV3 manifest (storage permission only)
    contentscript/
      index.ts                    entry: starts the controller
      controller.ts               lifecycle, layout pass, shortcuts, messaging, activation
      page.ts                     YouTube page adapter (selectors, player, metadata freshness)
      player.ts                   pure layout, activation, and preset resolution; context derivation
      styles.ts                   the injected stylesheet and attribute and property names
      study/
        studyPanel.ts             study UI (tabs, transcript, chapters, notes, export)
        transcript.ts             transcript sources, parsing, search, cache
        chapters.ts               chapter sources and parsing
        studyStore.ts             queued reads and writes of bookmarks and notes
    data/                         shared by the popup and the content script
      options.ts                  options schema, defaults, normalization, migrations, write queue
      study.ts                    study data schema, normalization, Markdown export
      messages.ts                 popup <-> page protocol and validators
      context.ts                  PlayerContext and related types
    popup/                        React popup (settings, side toggle, channel rule)
    common/                       logging, error boundary, active-tab helper
  test/                           Jest + jsdom tests, Chrome API mock
  scripts/                        clean, package (zip), verify-build (allowlist and budgets)
    live/                         live YouTube checks and store screenshots (real Chrome)
```

## Runtime overview

```text
 popup (React)  -- chrome.tabs.sendMessage -->  content script (one per YouTube tab)
       |                                                |
       +-------- chrome.storage.local <-----------------+
                 youtubeSideOptions (settings, shared by all tabs)
                 youtubeSideStudy   (bookmarks and notes)
```

There is no background worker. Shortcuts are handled inside each page, so a tab can only change itself; settings changes reach every tab through `chrome.storage.onChanged`.

### The layout pass

All visual state is applied in one `requestAnimationFrame`-coalesced pass, `YouTubeSideController.applyLayout`, scheduled by navigation events, window resize, player resize, page-mode attribute changes, settings changes, and (for a player-anchored panel) page scroll:

1. `watchPage()` binds observers and video listeners to whichever `ytd-watch-flexy`, `ytd-app`, `#movie_player`, and `<video>` exist now.
2. `derivePlayerContext()` reads the page into a `PlayerContext`: video id, channel key, player mode (`default`, `theater`, `fullscreen`, `miniplayer`, `pip`), video kind (`standard`, `live`, `premiere`, `unknown`), duration, and the player's rectangle.
3. `resolveOptions()` overlays the `standard`, `live`, and `theater` presets on the stored options.
4. `resolveLayout()`, a pure function, decides visibility and geometry. Fullscreen and the miniplayer suspend the panel (state is kept, so leaving restores it exactly). The viewport anchor sits under the 56 px masthead. The player anchor aligns to the player and takes its height unless the user chose a size (by dragging or in the popup). A size derived from the player is only ever written to CSS variables, never to storage.
5. The controller writes attributes and CSS variables to `#below`, then measures the rendered panel and cancels any offset its ancestors introduce (`--youtube-side-offset-x` and `-y`), so it sits flush with the chosen edge.
6. The study panel is mounted (idempotently) or unmounted.

Other pieces of the pass: the right-side panel uses `direction: rtl` so the native resize handle faces the page; the live chat container is positioned against the panel; the recommendations column can be hidden; and in **auto invert** mode a sampler draws the video region behind the panel into a 32×32 canvas every 700 ms and inverts the panel's colors above 0.6 luminance, reverting below 0.45 after two agreeing samples. Dragging the panel's resize handle is committed to the width and height options after 200 ms.

Colors come from the panel's own light and dark palettes, chosen by YouTube's `html[dark]` attribute; YouTube no longer exposes its `--yt-spec-*` color variables on the page.

### Navigation and fresh page data

YouTube navigates in-page. Measured on live pages:

- The URL and the new video's `durationchange` arrive **before** `yt-navigate-finish`.
- The channel link, chapter markers, transcript panel, and inline player response still describe the **previous** video at both `yt-navigate-finish` and `yt-page-data-updated`. They all switch about half a second later, together with `ytd-watch-flexy[video-id]`.

`isPageDataCurrent(videoId)` in `page.ts` compares that attribute with the URL. Channel rules, chapter extraction, and reading YouTube's transcript panel wait for it; the controller re-runs them when the attribute changes.

### Activation

`resolveActivation()` decides, in order of precedence:

1. a **manual override** for this video (Alt+S or the popup switch; remembered in memory for the 100 most recent videos, never stored),
2. a **channel rule** (`always` or `never`, keyed by the channel URL path),
3. the global **auto-activate** setting (`never`, `live`, `long` for videos of 20 minutes or more, `always`),
4. otherwise leave the panel as it is.

It runs on navigation, when page data becomes current, on `durationchange`, and on settings changes. While a pre-roll ad plays (`#movie_player.ad-showing`) the video's duration is treated as unknown, so an ad never counts as a long video.

### Study mode

The study UI is an extension-owned `#youtube-side-study` element prepended to `#below`. Its header has four tabs, **Side** (YouTube's own content, unchanged), **Transcript**, **Chapters**, and **Notes**, plus a bookmark button. Selecting a study view sets `data-youtube-side-view` on `#below`, and the stylesheet hides YouTube's children while it is set. Mounting is idempotent, so layout passes never rebuild the UI or disturb focus, scroll, or typed text; unmounting removes the container and the view attribute.

**Transcript.** Tried in order, only after the user opens the Transcript view:

1. the in-memory cache (three most recently used videos; nothing is stored),
2. a caption file from the player response embedded in the page, but only for tracks that belong to this video and are not bound to a proof-of-origin token (`exp=xpe`, which YouTube answers with an empty body),
3. YouTube's transcript panel, if it is already open for this video,
4. opening YouTube's transcript panel ("Show transcript"), waiting up to 10 seconds for its rows to stop changing, reading them, and closing the panel again if the extension opened it.

If none works the view says so; if YouTube's own panel failed, it offers a retry. Search is case- and accent-insensitive, with highlight ranges mapped back to the original text. Following highlights the current line and scrolls only the list; wheel, touch, scrollbar, or keyboard scrolling pauses it until the user resumes. While the panel is open with study mode on, clicking YouTube's own "Show transcript" button routes that transcript into the view (the extension ignores its own programmatic clicks on that button).

**Chapters** come from YouTube's chapter markers, preferring the chapters panel copy and de-duplicating by start time, with timestamped description lines (at least two, strictly increasing) as a fallback.

**Bookmarks and notes** are stored per video under `youtubeSideStudy` through a serialized write queue. A bookmark's `createdAt` is its id. The video note saves 500 ms after typing stops, bound to the video it was typed on. Exports flush pending edits first and contain only user-authored data. A rejected storage write shows a notice in the panel.

**Keyboard.** Tabs follow the ARIA tabs pattern (arrow keys, Home, End, roving `tabindex`). YouTube's player shortcuts listen on the page, so the panel keeps Space, Enter, the arrow keys, Page Up and Page Down, Home, and End from leaving its focused buttons; Alt shortcuts and other keys pass through. Changes are announced through a polite live region.

### Popup and messaging

The popup reads and writes options directly through `data/options.ts` (debounced for sliders and dimension fields) and talks to the active tab with three validated messages:

| Request | Effect |
| --- | --- |
| `GET_STATE` | returns the tab's status |
| `SET_ACTIVE { active }` | toggles the panel as a manual override |
| `APPLY_CHANNEL_RULE { channelKey, rule }` | stores the rule and re-evaluates the open video |

The status is `{ active, available, effectiveVisible, suspendReason, context }`. `active` is the user's intent and `effectiveVisible` is what is rendered, so the popup can explain a suspension. When no YouTube tab answers, the popup hides the tab-specific controls; if the tab stops answering after the popup opened, the popup stores a channel rule itself.

### Storage formats

**`youtubeSideOptions`**, stored as `{ version: 3, values }`:

| Field | Default | Bounds and values |
| --- | --- | --- |
| `background` | `opaque` | `transparent`, `opaque` |
| `blur` | 10 | 0 to 20 px |
| `opacity` | 50 | 0 to 100 % |
| `invertText` | `off` | `off`, `auto`, `on` |
| `width`, `height` | 500, 550 | 320 to 1200, 240 to 1200 px |
| `left` | `true` | panel side |
| `recommendations` | `true` | show the recommendations column |
| `layoutAnchor` | `viewport` | `viewport`, `player` |
| `autoActivate` | `never` | `never`, `live`, `long`, `always` |
| `presets` | `{}` | `standard`, `live`, `theater` partial overlays, clamped like the base values |
| `channelRules` | `{}` | channel path to `always` or `never`, at most 100 |
| `studyEnabled` | `true` | show the study header |
| `studyFollow` | `true` | follow the transcript by default |
| `studyAutoOpen` | `off` | `off`, `transcript`, `chapters` when auto-activation opens the panel |

Older shapes are migrated on read: unversioned values and version 1 (boolean `blurred` becomes blur 5 or 0, boolean `invertText` becomes `on`), and version 2 (all version 3 fields are additions with defaults). Downgrading to a build that predates version 3 resets settings to defaults.

**`youtubeSideStudy`**, stored as `{ version: 1, videos: { [videoId]: { bookmarks, note, updatedAt } } }`: at most 50 videos (least recently updated evicted), 200 bookmarks per video, labels up to 200 characters, bookmark notes up to 2,000, video notes up to 10,000.

## YouTube facts the code relies on

Verified on live watch pages on 2026-11-10. When something breaks after a YouTube update, check these first; each lives in one adapter. `pnpm test:live` exercises most of them.

| Fact | Used for | Where |
| --- | --- | --- |
| `#below`, `#chat-container`, `#related` | the panel, live chat, recommendations | `styles.ts` |
| `ytd-watch-flexy[video-id]` flips when metadata switches to the new video | fresh-data gate | `page.ts` |
| `ytd-watch-flexy[theater]`; the player moves to `#full-bleed-container` and `#player` measures 0×0 | theater mode, player geometry (measure `#movie_player`) | `page.ts` |
| `ytd-app[miniplayer-is-active]` (the flexy gets `hidden`) | miniplayer suspension | `page.ts` |
| `#movie_player.ad-showing`; ads play in the main `<video>` | ignore ad durations, block seek and bookmark | `page.ts` |
| `#movie_player .ytp-live` | live detection (sidebar badges must be ignored) | `page.ts` |
| `ytd-watch-metadata ytd-video-owner-renderer a[href]` | channel key | `page.ts` |
| caption `baseUrl`s carry `exp=xpe` and need a player-minted `pot` token | skip token-bound caption files | `transcript.ts` |
| `ytd-video-description-transcript-section-renderer button` opens the transcript | transcript source 4 | `transcript.ts` |
| `transcript-segment-view-model` rows with `.ytwTranscriptSegmentViewModelTimestamp` and `.ytAttributedStringHost` (legacy `ytd-transcript-segment-renderer` still read) | reading the transcript panel | `transcript.ts` |
| transcript panels: `target-id` contains `transcript`; close with `#visibility-button button` | panel state and restore | `transcript.ts` |
| `ytd-macro-markers-list-item-renderer` with `#time` and `h3.macro-markers[title]`, rendered up to three times | chapters | `chapters.ts` |
| YouTube's player shortcuts listen on the page, not only on the player | keeping panel keys local | `studyPanel.ts` |
| the theme is `html[dark]`; YouTube's `--yt-spec-*` color variables no longer exist on the page | the panel's own light and dark palettes | `styles.ts` |
| Trusted Types are enforced | text-only rendering | everywhere |

## Building, testing, and releasing

```sh
cd packages/youtube-side-chrome
pnpm install --frozen-lockfile
pnpm check        # peers, Biome, strict tsc, Jest with coverage, production package and verification
pnpm test:live    # builds, then runs the extension in installed Chrome against live YouTube
pnpm screenshots  # builds, then writes 1280x800 store screenshots to about/images/store
```

- **Unit tests** run in Jest + jsdom with a Chrome API mock (`test/chrome.ts`). Global coverage must stay at or above 85 % for statements, branches, functions, and lines. Parsers are tested against markup recorded from live pages, not against YouTube itself.
- **Live checks** (`scripts/live/`) load the built extension into the installed Google Chrome with Puppeteer and walk through activation, transcript, search, keyboard handling, notes, theater, chapters after navigation, the miniplayer, and deactivation on real watch pages. They need network access, depend on YouTube's current markup and on which ads play, and are not part of `pnpm check`. Set `CHROME_PATH` to use another Chrome binary, `HEADFUL=1` to watch the run, and `LIVE_LECTURE_VIDEO` or `LIVE_CHAPTERED_VIDEO` to test other videos.
- **Store screenshots** (`pnpm screenshots`) render six 1280×800 scenes from the built extension. Each attempt uses a fresh profile; a scene is retried when an ad or player error shows, when the frame is not at the requested moment, or when YouTube serves its experimental layout. Ads, sponsored cards, the merch shelf, and off-topic recommendations are hidden. `SCREENSHOTS_ONLY=2,4` regenerates only the named scenes.
- **Budgets** (`scripts/verify-build.mjs`): `contentscript.js` at most 60 KB raw and 20 KB gzip, `popup.js` at most 450 KB and 140 KB, archive at most 220 KB. The content script is about 56 KB and 16 KB; the stylesheet text is the first place to trim if a change needs room.
- **Versions:** the manifest `version` is the Chrome Web Store lineage and must strictly increase on every upload; it is independent of the npm package version.
- **Local testing:** `pnpm build`, then load `distribution/` with **Load unpacked** in `chrome://extensions`.
- **Store listing:** the description, permission justifications, and privacy answers live in `about/store-listing.md`; upload `distribution-zip/youtube-side-v<version>.zip`.

Release checklist on real YouTube, signed in, in a normal Chrome profile (the automated checks cannot cover these):

- a lecture over an hour: transcript loads, search, follow for a few minutes without visible jank, and clicking lines far ahead and behind while the video plays (playback must continue from the clicked line);
- a chaptered video's transcript (in a logged-out automated browser YouTube's own panel failed to load for one), an ASR-only video, a video without captions, a live stream, and a premiere;
- theater on and off repeatedly, fullscreen and the miniplayer with the panel open, picture-in-picture;
- auto-activation rules and a channel `never` rule over a global `always`;
- a screen-reader pass through the study tabs and bookmarks;
- the store build and a local build installed together.

## Known limitations

- Transcripts depend on YouTube: most caption files need a token only the player can create, so the transcript usually comes from YouTube's own panel, which opens briefly while it is read. If YouTube cannot load it, the Transcript view offers a retry.
- Chapters exist only where YouTube shows chapter markers or the description lists timestamps.
- YouTube is testing a watch layout (seen in some fresh visitor sessions in November 2026) that moves the description and comments out of `#below` into its own panel beside the video, with Description and Comments buttons in a rail on the right. There the Side view shows only the title block, and a right-side panel covers YouTube's comments panel; the study views work as usual. If that layout becomes the default, the Side view needs a new approach.
- In automated, logged-out browsers YouTube does not stream ranges past the initial buffer, so seeking far ahead stalls there for YouTube's own controls and the extension alike; the live checks avoid long seeks, and the release checklist covers seeking during real playback.
- The panel cannot appear inside fullscreen: only the fullscreen element's subtree is rendered, so the panel suspends instead.

## Possible next steps

Not implemented; listed so the ideas are not lost.

1. **Custom shortcuts** through `chrome.commands`, with a small worker relaying commands to the active YouTube tab.
2. **Docking layouts:** overlay and push-content layouts next to today's floating panel.
3. **Focus controls:** show or hide recommendations, live chat, description, and comments independently.
4. **Cross-device settings:** `chrome.storage.sync` as a second storage adapter, with local fallback and an explicit migration.
5. **Accessible in-page control:** an optional keyboard-accessible handle with status announcements and reduced-motion behavior.
