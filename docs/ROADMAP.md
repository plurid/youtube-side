# YouTube Side roadmap

The extension should stay focused: make YouTube's supporting information easier to use without competing with the video. The priorities below build on the options and side-layout modules rather than adding one-off DOM behavior.

## Completed

- **Adaptive Layout** — Player-anchored layout option, player mode awareness (clean suspension in fullscreen and miniplayer), contextual activation rules (live, long videos), channel rules, and viewport presets.
- **Study Mode** — Fast transcript viewer with timedtext JSON3 fetching and DOM fallback, chapter navigation, timestamped bookmark capture, notes persistence in storage, and Markdown export.
- **Study Shortcut** — `Alt/Option + T` cycling through Side, Transcript, Chapters, and Notes views.

## Next

1. **Custom shortcuts** — register commands through `chrome.commands` so users can change shortcuts in their browser settings. A small Manifest V3 worker would relay commands to the active YouTube tab.
2. **Docking layouts** — add overlay and push-content layouts; direct resize already ships through the panel's native resize handle, which writes the width and height options.
3. **Focus controls** — control recommendations, live chat, description, and comments independently from one focus section.
4. **Cross-device settings** — add `chrome.storage.sync` as a second storage adapter, with local fallback and an explicit migration.
5. **Accessible in-page control** — offer an optional keyboard-accessible handle with status announcements and reduced-motion behavior.

## Product guardrails

- Keep React and Plurid UI code inside extension pages; the YouTube content script remains dependency-free.
- Prefer user-controlled behavior over automatic page changes.
- Scope DOM observation to navigation and late target discovery; never watch the entire page indefinitely.
- Treat selectors and layout behavior as replaceable implementation details of the side-layout module.
