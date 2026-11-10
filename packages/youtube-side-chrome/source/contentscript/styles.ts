import { HEIGHT_MIN, WIDTH_MIN } from '~data/options';

export const BELOW_ID = 'below';
export const CHAT_ID = 'chat-container';
export const RELATED_ID = 'related';

export const STYLE_ID = 'youtube-side-styles';
export const STUDY_ID = 'youtube-side-study';
export const STUDY_CONTENT_ID = 'youtube-side-study-content';
export const ACTIVE_ATTRIBUTE = 'data-youtube-side-active';
export const POSITION_ATTRIBUTE = 'data-youtube-side-position';
export const BACKGROUND_ATTRIBUTE = 'data-youtube-side-background';
export const INVERTED_ATTRIBUTE = 'data-youtube-side-inverted';
export const RELATED_HIDDEN_ATTRIBUTE = 'data-youtube-side-hidden';
export const SUSPENDED_ATTRIBUTE = 'data-youtube-side-suspended';
export const VIEW_ATTRIBUTE = 'data-youtube-side-view';

export const WIDTH_PROPERTY = '--youtube-side-width';
export const HEIGHT_PROPERTY = '--youtube-side-height';
export const BLUR_PROPERTY = '--youtube-side-blur';
export const OPACITY_PROPERTY = '--youtube-side-opacity';
export const CHAT_TOP_PROPERTY = '--youtube-side-chat-top';
export const OFFSET_X_PROPERTY = '--youtube-side-offset-x';
export const OFFSET_Y_PROPERTY = '--youtube-side-offset-y';

// the height of YouTube's masthead; the panel sits flush against it
export const MASTHEAD_HEIGHT = 56;

// YouTube no longer exposes its --yt-spec-* color tokens; its theme is only
// visible as html[dark], so the panel carries its own palette for each theme
export const STYLES = `
#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"] {
    --youtube-side-surface: #0f0f0f;
    --youtube-side-text: #f1f1f1;
    --youtube-side-muted: #aaa;
    --youtube-side-layer: rgba(255, 255, 255, 0.1);
    --youtube-side-chip: rgba(255, 255, 255, 0.2);
    --youtube-side-accent: #3ea6ff;
    --youtube-side-error: #ff8a80;
}

html:not([dark]) #${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"] {
    --youtube-side-surface: #fff;
    --youtube-side-text: #0f0f0f;
    --youtube-side-muted: #606060;
    --youtube-side-layer: rgba(0, 0, 0, 0.05);
    --youtube-side-chip: rgba(0, 0, 0, 0.1);
    --youtube-side-accent: #065fd4;
    --youtube-side-error: #c00;
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"] {
    box-sizing: border-box !important;
    position: fixed !important;
    margin: 0 !important;
    top: calc(${MASTHEAD_HEIGHT}px + var(${OFFSET_Y_PROPERTY}, 0px)) !important;
    z-index: 2019 !important;
    overflow: auto !important;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    padding: 16px !important;
    width: var(${WIDTH_PROPERTY});
    height: var(${HEIGHT_PROPERTY});
    min-width: ${WIDTH_MIN}px !important;
    min-height: ${HEIGHT_MIN}px !important;
    max-width: 100vw !important;
    max-height: calc(100vh - ${MASTHEAD_HEIGHT}px) !important;
    resize: both;
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${SUSPENDED_ATTRIBUTE}="true"] {
    display: none !important;
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${POSITION_ATTRIBUTE}="left"] {
    left: var(${OFFSET_X_PROPERTY}, 0px) !important;
    right: auto !important;
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${POSITION_ATTRIBUTE}="right"] {
    right: var(${OFFSET_X_PROPERTY}, 0px) !important;
    left: auto !important;
    direction: rtl;
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${POSITION_ATTRIBUTE}="right"] > * {
    direction: ltr;
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${BACKGROUND_ATTRIBUTE}="transparent"] {
    background: transparent !important;
    backdrop-filter: none !important;
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${BACKGROUND_ATTRIBUTE}="opaque"] {
    background: color-mix(
        in srgb,
        var(--youtube-side-surface) var(${OPACITY_PROPERTY}, 100%),
        transparent
    ) !important;
    backdrop-filter: blur(var(${BLUR_PROPERTY}, 0px)) !important;
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${INVERTED_ATTRIBUTE}="true"] > * {
    filter: invert(1) hue-rotate(180deg);
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${INVERTED_ATTRIBUTE}="true"] :is(img, video, canvas) {
    filter: invert(1) hue-rotate(180deg);
}

#${CHAT_ID}[${ACTIVE_ATTRIBUTE}="true"] {
    box-sizing: border-box !important;
    position: absolute !important;
    top: var(${CHAT_TOP_PROPERTY}) !important;
    width: min(400px, calc(100vw - 48px)) !important;
}

#${RELATED_ID}[${RELATED_HIDDEN_ATTRIBUTE}="true"] {
    display: none !important;
}

/* study mode lives inside the panel; it only takes the panel over in its own views */
#${STUDY_ID} {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 16px;
    font-family: Roboto, Arial, sans-serif;
    font-size: 13px;
    color: var(--youtube-side-text);
}

#${STUDY_ID} [hidden],
#${BELOW_ID}:not([${ACTIVE_ATTRIBUTE}="true"]) > #${STUDY_ID} {
    display: none !important;
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${VIEW_ATTRIBUTE}] > #${STUDY_ID} {
    height: 100%;
    margin-bottom: 0;
}

#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${VIEW_ATTRIBUTE}] > :not(#${STUDY_ID}) {
    display: none !important;
}

.youtube-side-study-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--youtube-side-layer);
}

.youtube-side-tablist,
.youtube-side-study-actions,
.youtube-side-toolbar,
.youtube-side-export {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
}

.youtube-side-tab,
.youtube-side-button,
.youtube-side-row {
    border: 0;
    font: inherit;
    cursor: pointer;
}

.youtube-side-tab {
    padding: 6px 12px;
    border-radius: 8px;
    background: transparent;
    color: var(--youtube-side-muted);
    font-weight: 500;
    transition: background 0.15s, color 0.15s;
}

.youtube-side-tab:hover,
.youtube-side-tab[aria-selected="true"] {
    background: var(--youtube-side-chip);
    color: inherit;
}

.youtube-side-button {
    padding: 4px 10px;
    border-radius: 6px;
    background: var(--youtube-side-layer);
    color: inherit;
    font-size: 12px;
}

.youtube-side-button:hover,
.youtube-side-button[aria-pressed="true"] {
    background: var(--youtube-side-chip);
}

.youtube-side-tab:focus-visible,
.youtube-side-button:focus-visible,
.youtube-side-row:focus-visible,
.youtube-side-input:focus-visible {
    outline: 2px solid var(--youtube-side-accent);
    outline-offset: 1px;
}

#${STUDY_CONTENT_ID} {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
}

.youtube-side-message,
.youtube-side-meta {
    color: var(--youtube-side-muted);
}

.youtube-side-message {
    padding: 16px 0 4px;
}

.youtube-side-meta {
    font-size: 12px;
}

.youtube-side-notice {
    color: var(--youtube-side-error);
    font-size: 12px;
}

.youtube-side-input {
    box-sizing: border-box;
    flex: 1 1 160px;
    min-width: 0;
    padding: 6px 10px;
    border: 1px solid var(--youtube-side-layer);
    border-radius: 6px;
    background: var(--youtube-side-layer);
    color: inherit;
    font: inherit;
}

.youtube-side-textarea {
    flex: none;
    width: 100%;
    min-height: 120px;
    resize: vertical;
}

.youtube-side-list {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 2px;
    min-height: 120px;
    overflow-y: auto;
    overscroll-behavior: contain;
}

.youtube-side-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    width: 100%;
    padding: 4px 6px;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    text-align: start;
}

.youtube-side-chapter-row {
    padding: 8px 10px;
}

.youtube-side-row:hover {
    background: var(--youtube-side-layer);
}

.youtube-side-row.is-current {
    background: var(--youtube-side-chip);
}

.youtube-side-time {
    flex-shrink: 0;
    color: var(--youtube-side-accent);
    font-family: monospace;
    font-size: 12px;
}

.youtube-side-text {
    line-height: 1.4;
}

.youtube-side-text mark {
    border-radius: 2px;
    background: #ffd54f;
    color: #000;
}

.youtube-side-pill {
    align-self: center;
    border-radius: 999px;
}

.youtube-side-heading {
    margin: 4px 0 0;
    font-size: 14px;
    font-weight: 500;
}

.youtube-side-bookmark {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    border-radius: 6px;
    background: var(--youtube-side-layer);
}

.youtube-side-bookmark-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.youtube-side-field {
    padding: 2px 0;
    border: 0;
    border-bottom: 1px solid var(--youtube-side-layer);
    background: transparent;
    color: inherit;
    font: inherit;
}

.youtube-side-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
}

@media (prefers-reduced-motion: reduce) {
    .youtube-side-tab {
        transition: none;
    }
}
`;
