# Chrome Web Store listing

Everything the developer dashboard asks for when publishing YouTube Side 1.1.0. Paste the text blocks as they are; each paragraph is one line, and the store keeps the line breaks.

## Package

Upload `packages/youtube-side-chrome/distribution-zip/youtube-side-v1.1.0.zip`, built with `pnpm package`. The store currently has 1.0.5, so 1.1.0 is a valid update. Permissions are unchanged (`storage`, plus the YouTube content script), so existing users get the update without a new permission prompt.

## Summary

The store shows the manifest `description` as the summary (119 of 132 characters):

```text
Read YouTube descriptions, comments, and live chat beside the video, with a searchable transcript, chapters, and notes.
```

## Description

```text
YouTube Side shows a video's description, comments, and live chat beside the video instead of below it, so you can read along without scrolling away from the picture. It keeps YouTube's own content and only moves it.

Shortcuts (Alt on Windows and Linux, Option on Mac):
• Alt+S: show or hide the side panel
• Alt+B: switch between a transparent and a tinted, blurred background
• Alt+L: move the panel to the left or right edge
• Alt+R: show or hide the recommendations column
• Alt+T: switch between the Side, Transcript, Chapters, and Notes views

Study mode
• Transcript: search it, follow along as the video plays, and click any line to jump there
• Chapters: see the video's chapters with the current one highlighted, and jump to any of them
• Notes: bookmark moments with one click, add labels and notes, and export them as Markdown

Layout
• Resize the panel by dragging its corner; the size is remembered
• Anchor the panel to the edge of the window or to the video player
• Steps aside in fullscreen and the miniplayer, and comes back when you return
• Optionally opens by itself for live streams, long videos, or channels you choose
• Can invert its text automatically when the video behind a transparent panel is bright
• Follows YouTube's light and dark themes

Privacy
YouTube Side has no analytics and sends nothing to its developer. Your settings, bookmarks, and notes stay in your browser's extension storage. Transcripts come from YouTube itself, only when you open the Transcript view, and are never saved.
```

## Screenshots

Upload in this order from `about/images/store/` (1280×800 PNG, regenerate with `pnpm screenshots`):

1. `1-side-panel.png`: the description and comments beside the video
2. `2-transcript-search.png`: transcript search with highlighted matches
3. `3-chapters.png`: chapters with the current one highlighted
4. `4-notes.png`: bookmarks with labels and notes, ready to export
5. `5-theater-anchor.png`: theater mode with the panel anchored to the player
6. `6-light-right.png`: light theme, panel on the right, recommendations hidden

## Privacy practices tab

**Single purpose:**

```text
YouTube Side makes a YouTube video's supporting information easier to use while watching: it shows the description, comments, live chat, transcript, chapters, and the user's own notes in a panel beside the video.
```

**Permission justification, `storage`:**

```text
Saves the user's settings (panel size, side, background, and study options) and the bookmarks and notes they write, locally in the browser.
```

**Host permission justification (content script on `https://*.youtube.com/*`):**

```text
The extension rearranges the YouTube watch page to show the video's details beside the player and adds the study panel. It runs only on YouTube pages and reads only what YouTube shows there.
```

**Remote code:** No. All code ships in the package; the extension loads no remote scripts.

**Data usage:** the current declaration ("will not collect or use your data") stays accurate. Nothing is sent to the developer or any third party. Settings, bookmarks, and notes stay in local extension storage, and transcripts are read from YouTube's own page while the user has the Transcript view open, kept in memory for at most three videos, and never stored or transmitted. Keep the three certifications checked: not sold to third parties, not used for purposes unrelated to the item's single purpose, and not used to determine creditworthiness.

## Before submitting

Run through the signed-in release checklist in `docs/ARCHITECTURE.md` (Building, testing, and releasing).
