// #region imports
    // #region external
    import {
        OPTIONS_KEY,
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

const getOptions = async () => {
    const options = await chrome.storage.local.get(OPTIONS_KEY);
    if (!options || !options[OPTIONS_KEY]) {
        return;
    }

    return options[OPTIONS_KEY] as Options;
}

const getThemeType = () => {
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
}

const renderSide = (
    options: Options,
) => {
    const below = getBelow();
    if (!below) {
        return;
    }

    const themeType = getThemeType();

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
        background: ${
            options.background === 'transparent'
                ? 'transparent'
                : themeType === 'light'
                    ? 'white'
                    : 'black'
        };
    `;
}

const toggleSide = async () => {
    const below = getBelow();
    if (!below) {
        return;
    }

    if (toggled) {
        below.style.cssText = '';
        toggled = false;
        return;
    }

    const options = await getOptions();
    if (!options) {
        return;
    }

    renderSide(options);
    toggled = true;
}

const toggleBackground = async () => {
    if (!toggled) {
        return;
    }

    const options = await getOptions();
    if (!options) {
        return;
    }

    const updatedOptions: Options = {
        ...options,
        background: options.background === 'transparent'
            ? 'opaque'
            : 'transparent',
    };

    await chrome.storage.local.set({
        [OPTIONS_KEY]: updatedOptions,
    });

    renderSide(updatedOptions);
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
            } catch (error) {
                return;
            }
        });

        chrome.storage.onChanged.addListener((changes) => {
            try {
                if (!toggled) {
                    return;
                }

                const options = changes[OPTIONS_KEY].newValue;
                renderSide(options);
            } catch (error) {
                return;
            }
        });
    } catch (error) {
        return;
    }
}

main();
// #endregion module
