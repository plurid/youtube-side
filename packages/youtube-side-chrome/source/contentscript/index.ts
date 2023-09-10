// #region imports
    // #region external
    import {
        OPTIONS_KEY,
        defaultOptions,
    } from '~data/constants';

    import {
        Options,
    } from '~data/interfaces';
    // #endregion external
// #endregion imports



// #region module
let toggled = false;



const BELOW_ID = 'below';
const getBelow = () => document.getElementById(BELOW_ID);

const CHAT_ID = 'chat-container';
const getChat = () => document.getElementById(CHAT_ID);

const getOptions = async (): Promise<Options> => {
    try {
        const options = await chrome.storage.local.get(OPTIONS_KEY)
            .catch(() => {});
        if (!options || !options[OPTIONS_KEY]) {
            return defaultOptions;
        }

        return options[OPTIONS_KEY] as Options;
    } catch (error) {
        return defaultOptions;
    }
}

const getThemeType = () => {
    try {
        const value = getComputedStyle(document.documentElement)
            .getPropertyValue('--yt-spec-base-background');

        if (value === '#fff'
            || value === 'white'
            || value === '#ffffff'
            || value === 'rgb(255, 255, 255)'
        ) {
            return 'light';
        }

        return 'dark';
    } catch (error) {
        return 'dark';
    }
}

const resolveBackground = (
    backgroundColor: 'transparent' | 'opaque',
    blurred: boolean,
) => {
    if (backgroundColor === 'transparent') {
        return 'transparent';
    }

    if (blurred) {
        return 'rgba(0, 0, 0, 0.2)';
    }

    const themeType = getThemeType();
    if (themeType === 'light') {
        return 'white';
    }

    return 'black';
}

const renderSide = (
    options: Options,
) => {
    const below = getBelow();
    if (!below) {
        return;
    }

    below.style.cssText = `
        position: absolute;
        top: 56px;
        z-index: 2019;
        overflow: auto;
        padding: 1rem;
        left: ${options.left ? '25px' : 'auto'};
        right: ${options.left ? 'auto' : '25px'};
        width: ${options.width}px;
        height: ${options.height}px;
        background: ${resolveBackground(options.background, options.blurred)};
        backdrop-filter: ${options.blurred ? 'blur(5px)' : 'initial'};
    `;
}

const renderChat = (
    options: Options,
) => {
    if (toggled) {
        return;
    }

    const chat = getChat();
    if (!chat) {
        return;
    }

    const rect = chat.getBoundingClientRect();
    const positionRelativeToTop = rect.top + window.scrollY;
    const top = positionRelativeToTop - 56;

    chat.style.cssText = `
        position: absolute;
        top: -${top}px;
        width: 400px;
    `;
}

const toggleSide = async () => {
    const below = getBelow();
    const chat = getChat();

    if (toggled) {
        if (below) {
            below.style.cssText = '';
        }
        if (chat) {
            chat.style.cssText = '';
        }
        toggled = false;
        return;
    }

    const options = await getOptions();
    renderSide(options);
    renderChat(options);

    toggled = true;
}

const toggleBackground = async () => {
    if (!toggled) {
        return;
    }

    const options = await getOptions();
    const updatedOptions: Options = {
        ...options,
        background: options.background === 'transparent'
            ? 'opaque'
            : 'transparent',
    };

    try {
        await chrome.storage.local.set({
            [OPTIONS_KEY]: updatedOptions,
        });

        renderSide(updatedOptions);
        renderChat(updatedOptions);
    } catch (error) {
        return;
    }
}

const toggleLeft = async () => {
    if (!toggled) {
        return;
    }

    const options = await getOptions();
    const updatedOptions: Options = {
        ...options,
        left: !options.left,
    };

    try {
        await chrome.storage.local.set({
            [OPTIONS_KEY]: updatedOptions,
        });

        renderSide(updatedOptions);
        renderChat(updatedOptions);
    } catch (error) {
        return;
    }
}



const main = async () => {
    try {
        document.addEventListener('keydown', (event) => {
            try {
                if (event.altKey && event.code === 'KeyS') {
                    toggleSide();
                    return;
                }

                if (event.altKey && event.code === 'KeyB') {
                    toggleBackground();
                    return;
                }

                if (event.altKey && event.code === 'KeyL') {
                    toggleLeft();
                    return;
                }
            } catch (error) {
                return;
            }
        });

        chrome.storage.onChanged.addListener((changes) => {
            try {
                if (!toggled) {
                    return;
                }

                const options = changes[OPTIONS_KEY].newValue as Options;
                if (!options) {
                    return;
                }
                renderSide(options);
            } catch (error) {
                return;
            }
        });
    } catch (error) {
        return;
    }
}

main().catch(() => {});
// #endregion module
