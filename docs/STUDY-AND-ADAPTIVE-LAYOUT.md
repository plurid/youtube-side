# YouTube Side — Study mode (A) and Adaptive layout (C) plan

Status: proposal, not implemented. Nothing in this document changes current behavior.
Scope: two feature directions on top of the shipped side panel (v1.0.6):

- **A — Study mode:** transcript, chapters, bookmarks, and notes inside the side panel.
- **C — Adaptive layout:** player-anchored geometry, player-mode awareness
  (default / theater / fullscreen / miniplayer / picture-in-picture),
  automatic activation rules, and per-context layout presets.

This plan is written so an implementer can execute it phase by phase without
inventing scope, interfaces, or verification. Each phase is independently
shippable and independently reversible.

## 0. Facts this plan is built on

Verified against the current tree (`packages/youtube-side-chrome`):

| Fact | Where |
|---|---|
| The panel is YouTube's own `#below` element, restyled in place via `data-youtube-side-*` attributes and CSS variables; it is never reparented | `source/contentscript/controller.ts` (`STYLES`, `applyLayout`) |
| Content script is dependency-free vanilla TypeScript; React 19 + Plurid UI exist only in the popup | `source/popup/*`, ROADMAP guardrails |
| Options live in `chrome.storage.local` under `youtubeSideOptions` as `{version: 2, values}`; every read/write is re-validated by `normalizeOptions`, writes are serialized through a promise queue | `source/data/options.ts` |
| Popup ↔ page protocol is two validated messages (`GET_STATE`, `SET_ACTIVE`) | `source/data/messages.ts` |
| The panel already measures itself (`correctPanelOffset`, `getBoundingClientRect`) and already samples the `<video>` element for auto-inversion | `controller.ts` |
| Shortcuts: `Alt+S/B/L/R`, ignored in editable targets; layout re-applied on `yt-navigate-finish` / `yt-page-data-updated`; target discovery uses a `MutationObserver` that self-terminates after 10s | `controller.ts` |
| Bundle budgets are enforced: content script ≤ 25 KB raw / 8 KB gzip, popup ≤ 450 KB / 140 KB gzip; `scripts/verify-build.mjs` fails the build over budget | `scripts/verify-build.mjs`, `webpack.config.js` |
| Manifest is MV3, `storage` permission only, no background worker, no network permission, content script matches `https://*.youtube.com/*` at `document_idle` | `source/manifest.json` |
| Test gate: Jest + jsdom, 85% global coverage thresholds, Biome lint, strict `tsc` (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | `jest.config.js`, `tsconfig.json`, `package.json` (`check`) |

Product guardrails carried over from `docs/ROADMAP.md`, treated as binding:

1. Keep React and Plurid UI inside extension pages; the content script stays dependency-free.
2. Prefer user-controlled behavior over automatic page changes.
3. Scope DOM observation to navigation and late target discovery; never watch the whole page indefinitely.
4. Treat selectors and layout behavior as replaceable implementation details of one layout module.
5. YouTube stays the data source; the extension repositions and annotates, it does not host content.

## 1. Goals and non-goals

### Goals

- A lecture viewer can follow a searchable, seekable transcript and chapter
  list in the panel, keep bookmarks and notes per video, and export them —
  without leaving the video and without any data leaving the browser.
- The panel geometry follows the player and the viewing context instead of
  being one fixed rectangle: it anchors to the player when asked, suspends
  cleanly where it cannot render (fullscreen, miniplayer), and can activate
  itself only under explicit, user-authored rules.
- Both features degrade to today's behavior when YouTube markup, captions, or
  metadata are missing. No new hard failure modes on ordinary videos.

### Non-goals (v1 of A and C)

- No AI summarization, no transcription of our own, no external services.
- No background service worker. (Custom-shortcut relay is a separate roadmap
  item and must not be smuggled into these phases.)
- No `chrome.storage.sync`, no accounts, no cross-device anything.
- No persisting transcript text. Transcripts are fetched on demand, held in
  memory for the current video, and dropped on navigation (see §3.4).
- No reparenting `#below` (or any YouTube node) into `document.body`. The
  flush-edge fix proved the panel depends on YouTube's scoped styles under
  `ytd-watch-flexy`; moving the node would break them.
- No changes to how comments/description render. Study mode adds a view;
  it does not replace YouTube's rendering of its own content.

## 2. Shared architecture decisions

These decisions apply to both A and C and are settled before either starts.

### D1 — The controller becomes an orchestrator; logic moves into modules

`YouTubeSideController` is already 645 lines and owns styles, geometry,
resize commit, brightness sampling, messaging, and shortcuts. A and C must
not grow it into a god object. Target module layout (content script stays
dependency-free; path aliases already exist):

```text
source/contentscript/
  index.ts                 entry, unchanged in shape
  controller.ts            lifecycle, wiring, message/keyboard dispatch only
  styles.ts                STYLES template + attribute/property name constants
  player.ts                PlayerContext detection, PlayerMode, geometry engine
  study/
    studyPanel.ts          extension-owned study UI (vanilla DOM)
    transcript.ts          TranscriptSource chain + timedtext parsing
    chapters.ts            ChapterSource chain + timestamp parsing
    studyStore.ts          bookmarks/notes persistence (wraps data/study.ts)
source/data/
  options.ts               Options v3 (see D3)
  messages.ts              protocol v2 (see D4)
  study.ts                 pure normalize/validate for bookmarks & notes
```

Rejected alternative: one `features.ts` grab-bag. Rejected because transcript
parsing, geometry resolution, and storage normalization have different test
seams and different failure modes; mixing them recreates the god object.

### D2 — Every YouTube-derived fact goes through an adapter with a fallback chain

Selectors and page-data shapes are the most volatile part of this codebase
(ROADMAP guardrail 4). Each external fact gets one adapter interface whose
implementations are tried in order, each returning `null` on any mismatch,
with all parsing in pure functions over `unknown`:

- `TranscriptSource` (§3.2), `ChapterSource` (§3.5), `PlayerContextSource` (§4.2).
- Adapters never throw across their boundary; they log once via `~common/utilities.log`
  and the feature renders its empty state.
- No selector string may appear outside its adapter module. Tests pin the
  parsers against saved fixtures, not against live YouTube.

### D3 — Options version 3, additive migration, one validation gate

`OPTIONS_VERSION` becomes `3`. `normalizeOptions` keeps doing what it does
today (any unknown input → valid `Options`) and learns the new fields with
the same pattern: enum fields fall back to defaults on unknown values,
numbers through `boundedInteger`, string maps through a bounded record
validator. Version 1 → 2 migrations stay untouched; 2 → 3 is pure addition
of fields with defaults, so no existing stored blob can change meaning.

New fields (final list in §3.7 and §4.6; all additive):

- A: `studyEnabled`, `studyFollow`, `studyAutoOpen`.
- C: `layoutAnchor`, `autoActivate`, `presets`, `channelRules`.

Rejected alternative: separate storage keys per feature. Rejected because the
popup and controller already subscribe to one validated options stream, and
splitting it invites divergent write races that the single write queue in
`options.ts` currently prevents.

### D4 — Message protocol v2, backward-compatible validators

`SideStatus` gains a `context` field (video id, channel key, player mode,
suspension reason) and an `effectiveVisible` field (§4.6). `SideRequest`
gains `APPLY_CHANNEL_RULE`. Both validators
keep accepting today's shapes so a new popup against an old content script
(or vice versa, mid-update in another tab) fails soft: unknown fields are
ignored, missing `context` renders as "unknown", and `isSideResponse` is
extended, not replaced. This mirrors how `isSideRequest` already discriminates
on `type` with strict per-variant field checks.

### D5 — Budgets are raised deliberately, not drifted into

Study mode will not fit in 25 KB raw / 8 KB gzip. Phase 0 must measure the
real content-script size with the study modules included and set new explicit
limits in `scripts/verify-build.mjs` with a comment recording why (same style
as the existing manifest-version comment there). Hard ceiling for this plan:
60 KB raw / 20 KB gzip for `contentscript.js`; if the spike exceeds it, the
transcript UI must be trimmed (no virtualization library exists to cut — the
cost driver would be our own rendering code, so the lever is scope, e.g.
deferring notes export formatting). The popup budget is unchanged.

### D6 — No timers or observers outlive their feature

Existing precedent: the brightness sampler stops when its mode is off, the
target observer self-terminates in 10s. New rule, enforced in review:

- Follow-sync runs only while the panel is active, a study view is visible,
  and follow is on; it uses `timeupdate` on the `<video>` element plus a
  250 ms interval only as a stall fallback, and removes both on view change,
  deactivation, navigation, and `stop()`.
- Player-mode observation is attribute-scoped to `ytd-watch-flexy`
  (`attributeFilter: ['theater', 'fullscreen', 'miniplayer']`-style), never
  `subtree: true` on the page, and disconnects on `stop()`.
- Geometry observation is a `ResizeObserver` on the player container only.

### D7 — All extension-rendered text uses `textContent`, never `innerHTML`

Transcript segments, chapter titles, note text, and channel names are
page- or user-controlled strings. Rendering must build nodes with
`document.createElement` + `textContent`; search highlighting wraps matches
in `<mark>` elements assembled from text nodes. This is a hard requirement,
tested by a fixture containing `<img onerror>` strings (see §6).

### D8 — Seek and playback go through the `<video>` element

The watch page's player is not an IFrame-API embed, so the IFrame Player API
is not available to us; the stable surface is `HTMLMediaElement`
(`currentTime`, `paused`, `play()`, `duration`, `timeupdate`). Seeking sets
`video.currentTime` only and never forces a play-state change: a playing
video keeps playing after the seek, a paused video stays paused. There is
no seek-plays option in v1.
Rejected alternative: synthesizing clicks on YouTube's progress bar or
calling undocumented player element methods. Both break silently on player
updates; `HTMLMediaElement` is a web standard.

## 3. Direction A — Study mode

### 3.1 User-visible behavior

When the panel is active and study mode is enabled, `#below` gains an
extension-owned container (`#youtube-side-study`, inserted as its first
child) holding the header and the active study view body, with four views:

| View | Content | Data source |
|---|---|---|
| **Side** (default) | Exactly today's panel: description, comments, live chat, untouched | YouTube |
| **Transcript** | Seekable, searchable, optionally following transcript | §3.2 |
| **Chapters** | Chapter list with current-chapter highlight | §3.5 |
| **Notes** | This video's bookmarks + free-text note, export | §3.6 |

Switching views sets `data-youtube-side-view` on `#below`; CSS shows the
study container and hides YouTube's own children in non-Side views (and
never hides them in Side view — the default must be visually identical to
today). Header controls: view tabs, follow toggle (Transcript view),
bookmark button (all views; captures current playback time), and a study
close affordance that returns to Side view. Turning study mode off in the
popup removes the header entirely.

Precise behaviors:

- **Seek:** clicking a transcript segment or chapter sets
  `video.currentTime` (D8). The clicked row gets a brief pressed state; no
  other playback change.
- **Follow:** while on, the current segment/chapter is highlighted and
  scrolled into view (`block: 'nearest'`, instant under
  `prefers-reduced-motion`, smooth otherwise). Any manual scroll of the
  panel (wheel, touch, keyboard, scrollbar drag) pauses following and
  reveals a "Follow" resume pill; following never fights the user.
- **Search (Transcript):** local, case-insensitive, diacritic-insensitive
  (`normalize('NFD')` on both sides), debounced 150 ms. Match count,
  previous/next controls; Enter seeks to the selected match. Highlights are
  `<mark>` nodes (D7). Clearing search restores the plain list.
- **Empty states are first-class:** no captions ("No transcript available
  for this video"), captions still loading, live stream without DVR,
  chapters absent. Each is a rendered state, not an error; nothing throws,
  nothing retries in a loop (one retry on explicit user click only).

### 3.2 Transcript acquisition — the riskiest seam, spiked first

`TranscriptSource` returns `Promise<Transcript | null>`:

```ts
interface TranscriptSegment { startMs: number; durationMs: number; text: string }
interface Transcript { language: string; kind: 'manual' | 'asr' | 'unknown'; segments: TranscriptSegment[] }
```

Fallback chain, in order:

1. **Timedtext via page player response.** Parse caption tracks from the
   watch page's player response JSON (embedded in the document) and fetch
   the chosen track's URL with `&fmt=json3`; parse `events[].segs[].utf8`
   with `tStartMs` / `dDurationMs`. Track choice: manual tracks before ASR,
   then track whose language matches `document.documentElement.lang` /
   `navigator.language`, then first track. Because content scripts run in
   an isolated world, page JavaScript variables are not directly readable;
   the adapter reads the serialized response from document markup, never
   injects a page-world script, and adds no `webRequest`/host permissions.
   This is the plan's one new network behavior: a same-origin fetch to a
   YouTube URL that YouTube itself uses, issued only when the user first
   opens the Transcript view for a video (see §3.4).
2. **Transcript engagement panel DOM.** If YouTube's own transcript panel
   is present in the DOM, scrape its segment renderers (time + text) as a
   read-only snapshot. Never programmatically open, move, or clone that
   panel in v1 — its lifecycle is YouTube's.
3. **`null`** → empty state. No further fallback is attempted.

Phase 0 (§5) exists to prove or kill source 1 on real pages. If it fails
(CORS, signed-URL expiry mid-session, shape churn), v1 ships with source 2
only plus chapters, and the transcript view ships when a source proves out.
The interface does not change either way — that is the point of the adapter.

Parsing rules (pinned by fixtures in tests):

- Drop segments whose joined text is empty or whitespace; join `segs` with
  `''`, collapse internal whitespace runs to one space, trim.
- Clamp negative `tStartMs` to 0; drop events with non-finite times; sort by
  `startMs`; if the source is unsorted, sorting is the parser's job, not
  the renderer's.
- Cap at 10,000 segments (covers multi-hour lectures with headroom); beyond
  the cap, keep the first 10,000 and mark the transcript truncated in the UI.

### 3.3 Transcript rendering and sync

- Render into a `DocumentFragment`, one row per segment: timestamp button
  (`m:ss` or `h:mm:ss` past one hour) + text span. For very long
  transcripts, render all rows but keep rows cheap (no per-row listeners —
  one delegated click listener on the list container).
- Current-segment lookup is a binary search over `startMs` against
  `video.currentTime * 1000`; the previous current row's highlight is
  removed before the new one is set (at most one `[data-current]` row).
- Follow scrolling uses `scrollIntoView` on the current row only when the
  row is outside the panel's visible region, to avoid jitter.
- Rendering reuses rows across searches where practical; a full re-render
  on search change is acceptable up to the 10k cap if profiling on the
  manual checklist (§6) shows no visible stall on a 2-hour lecture.

### 3.4 Transcript caching, lifetime, and privacy

- Cache key: `videoId + language`. Value: parsed `Transcript`. In-memory
  `Map` in the study controller only; nothing about transcripts is written
  to `chrome.storage` (bookmarks/notes are the only new persisted study
  data, and they are user-authored).
- A monotonically increasing generation counter identifies the current
  video; every async load captures it and discards its result if the
  generation moved on (navigation, video replacement). This prevents a
  slow fetch for video N rendering into video N+1.
- Cache is cleared on `yt-navigate-finish` for a different `videoId`, on
  controller `stop()`, and is capped at 3 transcripts (LRU) to bound memory
  on playlist autoplay sessions.

### 3.5 Chapters

`ChapterSource` returns `Chapter[] | null`:

```ts
interface Chapter { startMs: number; title: string }
```

Fallback chain:

1. **Macro markers DOM:** YouTube's chapter renderers in the description /
   chapters panel (title + timestamp text), parsed read-only.
2. **Description timestamps:** lines in the expanded description matching
   `^\s*(?:(\d+):)?([0-5]?\d):([0-5]\d)\s+(.+)$` (and the same with `-` /
   `•` separators), requiring at least 2 matches and strictly increasing
   times; single random timestamps (e.g. one pinned moment) are not a
   chapter list. Links YouTube itself rendered as timestamp anchors are
   accepted as pre-parsed equivalents.
3. **`null`** → the Chapters view shows "No chapters for this video" and
   suggests the Transcript view.

Rendering, highlight, and seek share the transcript list machinery
(same row shape, same binary search, same follow rules, separate list).
Chapters are re-derived on navigation and when the description expands;
no polling — re-derivation triggers are the existing navigation events
plus a scoped observer on the description container while study mode is
open, disconnected when it closes.

### 3.6 Bookmarks and notes

Data model (new key `youtubeSideStudy`, module `source/data/study.ts`):

```ts
interface Bookmark { timeMs: number; label: string; note: string; createdAt: number }
interface VideoStudy { bookmarks: Bookmark[]; note: string; updatedAt: number }
interface StudyData { version: 1; videos: Record<string, VideoStudy> }
```

- `normalizeStudyData(unknown): StudyData` follows the options pattern:
  unknown anything → `{version: 1, videos: {}}`; per-video validation drops
  malformed bookmarks rather than failing the record.
- Bounds (validated on every read and write): ≤ 200 bookmarks per video,
  label ≤ 200 chars, per-bookmark note ≤ 2,000 chars, video note ≤ 10,000
  chars, ≤ 50 videos retained, LRU-evicted by `updatedAt`. Bounds exist so
  a corrupted or hostile stored value can never grow storage unboundedly —
  same rationale as today's width/height clamps.
- Writes reuse the serialized promise-queue pattern from `options.ts`
  (extract it into the study store; do not fork a second queue semantic).
- UI: bookmark button captures `video.currentTime`; label defaults to the
  current chapter title if chapters are loaded, else the formatted time;
  label/note editable inline in the Notes view; delete per bookmark;
  clicking a bookmark seeks. Video note is a plain `<textarea>`-equivalent
  (extension-owned element), saved debounced 500 ms.
- Export: "Copy as Markdown" and "Download .md" producing

  ```markdown
  # <video title> — <url>
  ## Bookmarks
  - [12:34](<url>&t=754s) label — note
  ## Notes
  <text>
  ```

  Download uses a `Blob` + object URL created and revoked in the page;
  clipboard uses `navigator.clipboard.writeText` with a textarea fallback.
  Export contains only user-authored data (never transcript text).

### 3.7 Options and popup changes (A)

Options v3 additions for A (defaults chosen conservative):

| Field | Type | Default | Meaning |
|---|---|---|---|
| `studyEnabled` | boolean | `true` | Study header available when panel is active. Fetching still only happens on first opening Transcript (§3.2), so default-on costs nothing when unused. |
| `studyFollow` | boolean | `true` | Initial follow state per video; runtime follow toggles are in-memory only. |
| `studyAutoOpen` | `'off' \| 'transcript' \| 'chapters'` | `'off'` | Opens that study view automatically when auto-activation (§4.4) opens the panel. Never opens on manual `Alt+S` alone. |

Popup: a "study" section with the enable switch, follow switch, and the
auto-open dropdown, implemented with the existing Plurid `InputSwitch` /
`Dropdown` components and the existing debounced `changeOption` plumbing —
no new popup state machinery. Popup never talks to YouTube for study data;
bookmarks/notes are edited in-page only (popup editing is a non-goal).

### 3.8 Keyboard and accessibility (A)

- `Alt+T` cycles Side → Transcript → Chapters → Notes while the panel is
  active (same editable-target and modifier guards as existing shortcuts;
  handled in the existing `handleKeyDown` switch).
- Tabs are real `<button role="tab">` in a `role="tablist"`, arrow-key
  navigation, `aria-selected` kept in sync with `data-youtube-side-view`.
- Current chapter/segment changes are not live-announced (that would spam
  screen readers every few seconds); view switches and bookmark creation
  are announced via a visually hidden `aria-live="polite"` node owned by
  the study header.
- All study UI respects the existing panel inversion attribute (it lives
  inside `#below`, so the shipped invert filter applies; avatars/thumbnails
  exception does not apply to study rows — they are text only).

### 3.9 Study-mode failure matrix

| Condition | Required behavior |
|---|---|
| No caption tracks | Transcript empty state; Chapters and Notes unaffected |
| Timedtext fetch rejects / non-200 / unparsable | Fall to source 2, then empty state; one log line; no retry loop |
| Video replaced mid-fetch | Result discarded by generation check (§3.4) |
| Live stream, no captions yet | Empty state with "live" wording; Notes/bookmarks work |
| `chrome.storage` write fails (quota/denied) | Bookmarks UI keeps in-memory state, shows "couldn't save" once; layout keeps working (precedent: today's failed-write shortcut test) |
| YouTube renames segment/chapter renderers | Adapter returns `null`; Side view (core product) unaffected |

## 4. Direction C — Adaptive layout

### 4.1 User-visible behavior

Four additions, each independently opt-in, composing in this order:
**context detection → activation decision → preset resolution → geometry**.

1. **Player anchor (opt-in).** The panel can anchor to the player instead of
   the viewport: its top aligns with the player top, its side edge aligns
   with the player edge on the chosen side, and its height defaults to the
   player height (still user-resizable; resize still commits width/height
   to options as today). Viewport anchor remains the default and is
   byte-for-byte today's geometry, including the ancestor-offset correction.
2. **Player-mode awareness (always on once C ships, behavior-preserving by
   default).** The controller knows the current player mode. In fullscreen
   and miniplayer the panel suspends (hidden, state preserved) and restores
   on exit — because in fullscreen only the fullscreen element's subtree is
   rendered, so a viewport-fixed panel outside it cannot be visible anyway;
   pretending otherwise would strand user state. In theater, the geometry
   engine recomputes against the theater player rect; nothing else changes
   unless a theater preset exists (§4.5).
3. **Automatic activation (opt-in, default never).** On navigation, a rule
   engine may activate the panel. A manual `Alt+S` toggle during a video
   always wins for that video and is remembered for the session.
4. **Presets (opt-in).** Named partial layouts keyed by context
   (`standard`, `live`, `theater`) resolved over the base options.

### 4.2 Player context — one adapter, pure derivation

`player.ts` exports a pure derivation, `derivePlayerContext(snapshot)`,
over a DOM snapshot plus the live element lookups the controller already
performs:

```ts
type PlayerMode = 'default' | 'theater' | 'fullscreen' | 'miniplayer' | 'pip';
type VideoKind = 'standard' | 'live' | 'premiere' | 'unknown';

interface PlayerContext {
    videoId: string | null;
    channelKey: string | null;   // canonical channel id/handle, normalized
    mode: PlayerMode;
    kind: VideoKind;
    durationSeconds: number | null;  // null for live/unknown
    playerRect: Rect | null;         // #player container rect, CSS px
}
```

Derivation rules (each independently falsifiable in tests):

- `videoId`: `v` query parameter of the watch URL; null off watch pages.
- `mode`: `fullscreen` if `document.fullscreenElement` is set, else
  `pip` if the video is `document.pictureInPictureElement`, else
  `miniplayer` / `theater` from `ytd-watch-flexy` attributes, else
  `default`. Order matters: fullscreen outranks theater when both hold.
- `kind`: `live` when the player reports an unbounded/live duration or the
  watch element marks the broadcast live; `premiere` when a premiere
  affordance is present; else `standard` when a finite duration exists;
  else `unknown`. Adapters return `unknown` rather than guessing.
- `channelKey`: from the watch page's channel link canonical URL,
  lowercased, trailing slash stripped; null when absent. This string is
  the only key channel rules (§4.4) may use — display names are never keys
  (they change and collide).
- `playerRect`: `getBoundingClientRect()` of the player container element,
  re-measured on demand, never cached across a mode change.

Change signals (all removed in `stop()`, per D6): `fullscreenchange`,
`enterpictureinpicture` / `leavepictureinpicture` on the video element,
attribute-scoped `MutationObserver` on `ytd-watch-flexy`, `ResizeObserver`
on the player container, window `resize` (via the existing rAF scheduler),
and the existing navigation events.

### 4.3 Geometry engine — pure function, controller applies

All geometry decisions move into one pure function so they are testable
without a DOM:

```ts
interface LayoutRequest {
    anchor: 'viewport' | 'player';
    side: 'left' | 'right';
    width: number; height: number;          // from resolved options
    explicitSize: boolean;                   // size came from user, not geometry
    mode: PlayerMode;
    playerRect: Rect | null;
    viewport: { width: number; height: number };
}
interface LayoutDecision {
    visible: boolean;
    suspendReason: 'fullscreen' | 'miniplayer' | null;
    top: number; sideOffset: number;        // CSS px before ancestor correction
    width: number; height: number;          // clamped result
}
```

Rules, in order:

1. `fullscreen` or `miniplayer` → `visible: false` with the suspend reason.
   (`pip` does not suspend: the panel remains useful beside the page.)
2. Base rect: viewport anchor → top = masthead height (56), side offset 0,
   width/height from options — exactly today's decision, including
   `min-width/min-height` and viewport clamps. Player anchor with a
   non-null `playerRect` → top = `playerRect.top`, side offset =
   `playerRect.left` (left side) or `viewport.width - playerRect.right`
   (right side), height defaults to `playerRect.height` unless the user
   has explicitly resized (explicit size always wins; see below).
3. Player anchor with `playerRect: null` falls back to the viewport rect.
   Anchoring must never hide the panel because a measurement failed.
4. Clamp width/height to the existing min bounds and to the viewport;
   then the controller applies today's measured ancestor-shift correction
   on top of the decision (the correction stays a controller concern,
   because only the controller can measure the rendered panel).
5. Explicit user size (popup width/height fields or a committed drag)
   always beats preset and player-derived sizes. The engine therefore
   takes an `explicitSize` flag: player height is only a default when the
   current size still equals the last non-explicit size. Implementation:
   the controller tracks whether the last size write came from a drag or
   popup (explicit) vs. geometry (derived); derived sizes are written to
   CSS variables only, never persisted to options. Persisting derived
   sizes would poison the user's saved rectangle — this is the single
   easiest bug to introduce in C, and the tests must pin it (§6).

`applyLayout` keeps its current shape (attributes + CSS variables on
`#below`); it just receives numbers from the engine instead of computing
inline. The right-side `direction: rtl` scrollbar trick, chat positioning,
and recommendations hiding are untouched.

### 4.4 Automatic activation — rules engine

Pure function, evaluated on navigation and on context change:

```ts
type ActivationDecision = 'activate' | 'stay' | 'deactivate';
resolveActivation(input: {
    manualOverride: boolean | null;  // session, per videoId
    channelRule: 'always' | 'never' | null;
    autoActivate: AutoActivate;      // global option
    context: PlayerContext;
}): ActivationDecision
```

Precedence, highest first (pin in tests):

1. **Manual override** for this `videoId` (set by `Alt+S` / popup toggle;
   session-memory `Map<videoId, boolean>`, capped at 100 entries, never
   persisted — a fresh page load must not inherit a stale "off" the user
   set for a video they have left).
2. **Channel rule** for `channelKey` (`always` / `never`).
3. **Global rule** `autoActivate`: `'never'` (default) | `'live'` |
   `'long'` (duration ≥ 20 min, kind `standard`) | `'always'`.
4. Default: `stay` (do not change current active state).

`'deactivate'` is returned only when a `never` channel rule or a manual
off applies while the panel is active from a previous automatic activation
on the *same* video. Context changes to a *different* video re-evaluate
from inactive. Auto-activation never fires on non-watch pages, never
fires while the user is typing (it is not a keystroke path, but the
navigation evaluation must not steal focus), and never re-activates a
panel the user closed during the same video (that is what rule 1 is for).

Setting a channel rule is a user action, available (a) in the popup when
the active tab reports a channel context (protocol v2, D4), as
"Always / Never open panel for this channel," and (b) — later, optional —
in the study header menu. Rules are stored in options as
`channelRules: Record<string, 'always' | 'never'>`, validated and capped
at 100 entries (LRU by insertion, eviction pinned in tests).

### 4.5 Presets

A preset is a partial options overlay applied by context:

```ts
interface LayoutPreset {
    background?: Options['background']; blur?: number; opacity?: number;
    invertText?: Options['invertText'];
    width?: number; height?: number; left?: boolean; recommendations?: boolean;
    layoutAnchor?: 'viewport' | 'player';
}
type PresetKey = 'standard' | 'live' | 'theater';
```

- Storage: `presets: Partial<Record<PresetKey, LayoutPreset>>` in Options
  v3; each field re-validated through the same clamps as base options
  (a preset can never smuggle an out-of-range width).
- Resolution: `resolveOptions(base, context) → effective Options` —
  start from base, overlay the `live` preset when kind is `live`, the
  `theater` preset when mode is `theater`, both (theater last) when a
  live theater context occurs. Pure, tested by table.
- Editing: the popup gains a preset selector (Base / Standard / Live /
  Theater) that scopes the existing controls to the chosen record;
  "Save current look as …" is just editing the preset record through the
  same `changeOption` path with a preset target. No second editor.
- Presets never include `studyAutoOpen` or activation rules — appearance
  and activation stay separate concerns (mixing them made precedence
  unexplainable in §4.4).

### 4.6 Options and popup changes (C)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `layoutAnchor` | `'viewport' \| 'player'` | `'viewport'` | §4.1 anchor choice |
| `autoActivate` | `'never' \| 'live' \| 'long' \| 'always'` | `'never'` | Global activation rule (§4.4) |
| `presets` | `Partial<Record<PresetKey, LayoutPreset>>` | `{}` | Per-context overlays (§4.5) |
| `channelRules` | `Record<string, 'always' \| 'never'>` | `{}` | Per-channel activation (§4.4) |

Popup: an "adaptive layout" section — anchor dropdown, auto-activate
dropdown, preset selector editing (§4.5), and the channel-rule control
(enabled only when the active tab reports a channel). The popup's existing
`GET_STATE` hydration is extended to read `context` from the v2 status;
when the content script is absent (non-YouTube tab), the section renders
disabled exactly as the side-position switch already hides itself today.

Protocol v2 `context` also lets the popup show *why* the panel is hidden
("Suspended in fullscreen") instead of a bare inactive switch — the
`SideStatus.active` semantics stay "user intent," and a new
`SideStatus.effectiveVisible` reports rendered state. Keeping intent and
rendered state separate is what makes fullscreen suspend/restore lossless.

### 4.7 Adaptive-layout failure matrix

| Condition | Required behavior |
|---|---|
| Player rect unmeasurable | Viewport-anchor fallback (§4.3 rule 3); panel still opens |
| Fullscreen entered while panel open | Panel suspends; exiting fullscreen restores prior active state and geometry |
| Miniplayer starts | Panel suspends; closing miniplayer restores |
| Theater toggled rapidly | Mode observer + rAF scheduler coalesce; final mode wins, no geometry thrash (assert via decision-function tests, manual check §6) |
| Channel key unavailable | Channel rules silently inert; global rule still applies |
| Corrupt `presets` / `channelRules` in storage | Normalizer drops invalid entries, keeps valid ones; layout uses base options |
| Auto-activation on a video the user already closed | Manual override (session) prevents re-activation (§4.4 rule 1) |
| YouTube renames watch attributes | Mode degrades to `default`; viewport layout (today's behavior) continues |

## 5. Sequencing — phases, gates, and rollback

Phases are ordered so the riskiest unknowns are retired before UI is built
on them, and so C's foundation lands before A needs a stable geometry.
Each phase ends with the full existing gate (typecheck, lint, coverage,
production package + verify) and its own checks in §6.

| Phase | Ships | Gate to start next phase |
|---|---|---|
| **0 — Spikes (no user-visible change)** | (a) Transcript source 1 proof: on real watch pages (manual captions, ASR-only, no captions, live), confirm player-response extraction + timedtext `json3` fetch works from the isolated content-script world, or record exactly why not. (b) Fullscreen proof: confirm panel visibility behavior in fullscreen and miniplayer. (c) Measure content-script size with stub study modules; set the D5 budget numbers in `verify-build.mjs`. | Written spike notes appended to this doc's §8; source-1 verdict (ship / DOM-only / defer transcript); budget numbers committed |
| **1 — C foundation (behavior-preserving)** | Extract `styles.ts` + `player.ts` context detection; geometry engine (§4.3) reproducing today's viewport decisions exactly; `SideStatus` intent vs. effective-visible split (protocol v2, backward-compatible). No new options, no popup changes. | Existing test suite unmodified and green; new pure-function tests for context derivation and geometry decisions |
| **2 — C behavior** | Fullscreen/miniplayer suspend + restore; player anchor; `layoutAnchor`, `autoActivate`, `channelRules`, `presets` (Options v3 migration); activation + preset resolution; popup adaptive section. | §6 C-checklist on real pages; Options v2 blobs migrate losslessly (fixture test) |
| **3 — A foundation (no network)** | Study header + view switching; chapters via both chapter sources; bookmarks/notes store, UI, export; `studyEnabled` popup section; `Alt+T`. | §6 A-checklist items that need no transcript; Side view visually identical to pre-A build |
| **4 — A transcript** | Transcript source chain (per Phase-0 verdict), rendering, search, follow, seek; `studyFollow`, `studyAutoOpen`; transcript caching/generation rules. | §6 transcript checklist incl. 2-hour lecture performance and stale-fetch race test |
| **5 — Hardening** | Accessibility pass (§3.8, keyboard/focus/reduced-motion), performance pass on long videos, bundle-budget final numbers, README + ROADMAP updates, store-listing notes for the one new network behavior (§3.2) if source 1 shipped. | §6 full regression; manual checklist signed off in the PR description |

Rollback per phase: every user-facing behavior is behind an Options v3
flag defaulting to today's behavior (`layoutAnchor: 'viewport'`,
`autoActivate: 'never'`, `presets: {}`, study header removable via
`studyEnabled`), so any phase can be neutralized by flipping a default in
one release without a data migration rollback. Downgrading the extension
across the v3 boundary is lossy: the v2 normalizer does not recognize a
version-3 blob and falls back to defaults for everything, so a downgrade
resets all settings (it cannot corrupt layout — the panel simply returns
to defaults). This must be stated in the release notes for Phase 2.

Interleaving rule: A phases must not start until Phase 1 lands (study UI
inherits geometry decisions), but Phase 3 does not depend on Phase 2 —
if C behavior slips, A foundation can ship on viewport geometry alone.

## 6. Validation plan

All commands run from `packages/youtube-side-chrome`. (Run them with the
project's package runner; in this workspace use its `check` script, which
is peers + Biome + strict `tsc` + coverage + production package/verify.)

### Automated (committed tests, by phase)

- **Parsers (A):** timedtext `json3` fixtures — empty events, unsorted
  events, negative starts, multi-`segs` lines, 10k cap; description-chapter
  fixtures — `h:mm:ss` and `m:ss`, separator variants, single-timestamp
  rejection, non-increasing rejection; HTML-string fixtures proving D7
  (`<img onerror>` in a segment renders as text, zero child elements).
- **Stores (A):** `normalizeStudyData` on garbage, per-field bounds,
  50-video LRU eviction, failed-write keeps in-memory state.
- **Sync (A):** binary-search current-segment table; generation counter
  discards a fetch resolved after navigation; follow pauses on manual
  scroll and resumes via pill (jsdom event simulation).
- **Geometry (C):** `resolveLayout` decision table — every `PlayerMode` ×
  anchor × rect-null combination; derived size is never persisted
  (assert options store unchanged after a player-anchor apply with a
  drag-explicit size present).
- **Activation/presets (C):** precedence table for §4.4 (manual > channel >
  global > stay, same-video vs. different-video re-evaluation);
  `resolveOptions` overlay order including live+theater stacking;
  v2 → v3 migration fixture (stored v2 blob → identical layout fields,
  new fields defaulted).
- **Protocol:** v2 validators accept v1 shapes and reject malformed v2
  (existing messages test style); popup renders context-disabled state
  with no content script.
- **Regression:** the entire current suite passes unmodified through
  Phase 1; coverage thresholds (85%) hold in every phase (new modules are
  added to `collectCoverageFrom` in `jest.config.js` as they land).

### Manual (real YouTube, cannot be automated here — record results in PR)

- Lecture ≥ 1 h with manual captions: transcript loads, search finds a
  known phrase, seek lands within 1 s of the spoken line, follow tracks
  for 5 minutes without scroll fighting, no visible jank.
- ASR-only video, no-caption video, live stream, premiere: correct empty
  states; bookmarks still work on all four.
- Theater on/off ×10 rapidly; fullscreen enter/exit with panel open
  (suspend → restore with same rectangle); miniplayer start/stop;
  player-anchor panel tracks theater resize; PiP keeps panel usable.
- Auto-activation: `live` opens on a live stream, `long` opens on a
  25-minute video but not a 3-minute one, channel `never` beats global
  `always`, manual close is respected for the rest of that video.
- Dual-extension check: published store build disabled, local build
  enabled (the configuration that masked the flush fix during its
  verification) — confirm only one panel exists.
- Screen reader pass (VoiceOver/NVDA): tab through study tabs, create a
  bookmark, hear the announcement; keyboard-only seek through chapters.

Highest-risk validation: Phase 0 transcript spike. Everything in
Direction A except transcript itself (chapters, notes, shell) is
independent of it, by design.

## 7. Risks and open questions

| # | Risk / question | Mitigation / default chosen |
|---|---|---|
| R1 | Timedtext source breaks (signed URLs, shape churn, store-policy reading of the fetch) | Adapter isolation (D2); Phase-0 gate; DOM-source fallback; feature ships chapters/notes regardless |
| R2 | Content-script bundle exceeds even the raised budget | Phase-0 measurement; 60 KB / 20 KB ceiling (D5); scope lever is study UI, not correctness code |
| R3 | Derived geometry gets persisted and corrupts the user's saved rectangle | Explicit-vs-derived size tracking (§4.3 rule 5) + pinned test |
| R4 | Auto-activation annoys (opens uninvited) | Default `never`; manual override precedence; per-channel `never`; no focus stealing |
| R5 | Fullscreen suspend surprises users who expected the panel inside fullscreen | Popup shows suspension reason (§4.6); restore is lossless; in-fullscreen panel is explicitly out of scope for v1 (would require rendering inside YouTube's fullscreen subtree) |
| R6 | Long-lecture rendering/search stalls | 10k segment cap, delegated listeners, manual perf checklist before Phase 4 ships |
| Q1 | Should transcript text be exportable with notes? | **Default: no** (privacy + YouTube-as-source guardrail). Revisit only as explicit per-export opt-in |
| Q2 | Should `studyEnabled` default on? | **Default: on** as availability only — no fetch, no visual change until the user opens a study view or activates with `studyAutoOpen` |
| Q3 | Live-chat in study views? | Out of scope: chat stays in Side view; study views hide it with YouTube's other children. A chat-study merge is a later proposal, not a phase |
| Q4 | Multiple monitors / window moves for player anchor | Geometry re-derives on window resize + player `ResizeObserver`; no persisted cross-window state |

## 8. Spike notes

_(Phase 0 fills this in: transcript-source verdict with the exact pages
and caption kinds tested, fullscreen/miniplayer observations, and the
measured bundle size that sets the D5 budget. No phase beyond 0 starts
without this section completed.)_

## Sources

Platform facts relied on above, inspected during planning:

- [YouTube IFrame Player API reference](https://developers.google.com/youtube/iframe_api_reference) — considered and rejected for seek/control: the watch-page player is not an IFrame-API embed (D8).
- [MDN: HTMLMediaElement](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement) — `currentTime` / `timeupdate` / playback surface used for seek and follow-sync.
- [MDN: Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API) — `fullscreenElement` / `fullscreenchange`; only the fullscreen subtree renders, motivating suspend (§4.1).
- [MDN: Picture-in-Picture API](https://developer.mozilla.org/en-US/docs/Web/API/Picture-in-Picture_API) — `pictureInPictureElement` and enter/leave events used in mode detection (§4.2).

YouTube watch-page DOM shapes (caption tracks, transcript/chapter
renderers, `ytd-watch-flexy` mode attributes) have no official public
documentation; they are treated throughout as unverified, replaceable
adapter details (D2) and must be confirmed by the Phase-0 spike on real
pages before any code depends on them.


