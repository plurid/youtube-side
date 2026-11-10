import { HEIGHT_MIN, WIDTH_MIN } from '~data/options';

export const BELOW_ID = 'below';
export const CHAT_ID = 'chat-container';
export const RELATED_ID = 'related';

export const STYLE_ID = 'youtube-side-styles';
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

export const STYLES = `
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
        var(--yt-spec-base-background, #0f0f0f) var(${OPACITY_PROPERTY}, 100%),
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

/* Study mode container */
#youtube-side-study {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 16px;
    font-family: Roboto, Arial, sans-serif;
    color: var(--yt-spec-text-primary, #f1f1f1);
}

#youtube-side-study[hidden] {
    display: none !important;
}

#youtube-side-study-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border-bottom: 1px solid var(--yt-spec-10-percent-layer, rgba(255, 255, 255, 0.1));
    padding-bottom: 8px;
}

.youtube-side-tablist {
    display: flex;
    gap: 4px;
}

.youtube-side-tab {
    background: transparent;
    border: none;
    color: var(--yt-spec-text-secondary, #aaa);
    padding: 6px 12px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background 0.15s, color 0.15s;
}

.youtube-side-tab:hover {
    background: var(--yt-spec-10-percent-layer, rgba(255, 255, 255, 0.1));
    color: var(--yt-spec-text-primary, #fff);
}

.youtube-side-tab[aria-selected="true"] {
    background: var(--yt-spec-badge-chip-background, rgba(255, 255, 255, 0.2));
    color: var(--yt-spec-text-primary, #fff);
}

.youtube-side-study-actions {
    display: flex;
    align-items: center;
    gap: 6px;
}

.youtube-side-button {
    background: var(--yt-spec-10-percent-layer, rgba(255, 255, 255, 0.1));
    color: var(--yt-spec-text-primary, #fff);
    border: none;
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
}

.youtube-side-button:hover {
    background: var(--yt-spec-badge-chip-background, rgba(255, 255, 255, 0.2));
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

/* Hide native children in non-Side views */
#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${VIEW_ATTRIBUTE}="transcript"] > :not(#youtube-side-study),
#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${VIEW_ATTRIBUTE}="chapters"] > :not(#youtube-side-study),
#${BELOW_ID}[${ACTIVE_ATTRIBUTE}="true"][${VIEW_ATTRIBUTE}="notes"] > :not(#youtube-side-study) {
    display: none !important;
}
`;
