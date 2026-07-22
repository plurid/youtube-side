# YouTube Side

YouTube Side is a Chrome extension that shows the YouTube video description, comments, and live chat beside the video instead of below it, so the supporting information can be read without scrolling away from the picture.

<p align="center">
    <img src="https://raw.githubusercontent.com/plurid/youtube-side/master/about/images/ss-1.png" height="500px">
</p>

The extension is available for [Chrome](https://chrome.google.com/webstore/detail/youtube-side/ehjnomdbkamcdhadcaghaflklcfhgonl).

## How it works

Press **Alt/Option + S** on a YouTube page to lift the details panel beside the video; press it again to restore the original layout. The panel keeps YouTube's own content — the extension only repositions it.

- **Alt/Option + S** toggles the side panel.
- **Alt/Option + B** switches between a transparent and a themed background; the themed background's blur and opacity are independently adjustable from the popup.
- **Alt/Option + L** moves the panel to the left or right edge.
- **Alt/Option + R** shows or hides the recommendations column.
- The popup's **side position** switch toggles the layout for the current tab, same as Alt/Option + S; the popup talks to the YouTube page over extension messaging, so no extra permission is needed.
- The popup's **invert text** control inverts the panel's text and background colors while keeping avatars and thumbnails intact - useful when a transparent panel sits over a bright video. In **auto** mode the extension samples the video region behind the panel about once a second and inverts only while that area is bright, with hysteresis so scene cuts do not cause flicker. Frames never leave the page.

The panel can be resized directly by dragging its bottom corner (always the corner facing the page content) - the size is remembered. The popup configures the background, blur strength, background opacity, side, exact width and height, and recommendations. Preferences are shared through extension storage and are validated on every read: dimensions are clamped to sensible bounds (width 320–1200, height 240–1200), so a corrupted value can never break the layout. The layout is applied through a scoped stylesheet and data attributes, never by overwriting YouTube's own inline styles, and it survives YouTube's in-page navigation.

## Scope and permissions

The content script runs only on YouTube. The manifest requests only the `storage` permission; it has no background service, remote code, analytics, or network permission. The shortcuts are handled inside each YouTube page, so one tab cannot toggle another, and they are ignored while typing in the search box, comments, or any other text field.

## Development

Requirements:

- Node.js 24 or newer
- pnpm 11.15.1

```sh
cd packages/youtube-side-chrome
pnpm install --frozen-lockfile
pnpm check
```

The TypeScript target is ES2024. `pnpm check` validates peer dependencies, formatting/linting, strict types, coverage thresholds, the production Webpack build, the manifest/package file allowlist, bundle budgets, and the Chrome Web Store archive.

Useful commands:

```sh
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm package
```

The unpacked extension is written to `distribution/`; the versioned store archive is written to `distribution-zip/`.

To test locally, run `pnpm build`, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `packages/youtube-side-chrome/distribution`.

See the [roadmap](docs/ROADMAP.md) for proposed follow-up features.
