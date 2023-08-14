// #region imports
    // #region external
    import {
        defaultOptions,
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
        background: ${options.background};
    `;
}

const toggleSide = () => {
    const below = getBelow();
    if (!below) {
        return;
    }

    if (toggled) {
        below.style.cssText = '';
        toggled = false;
        return;
    }

    renderSide(defaultOptions);
    toggled = true;
}



const main = async () => {
    try {
        document.addEventListener('keydown', (event) => {
            if (event.altKey && event.code === 'KeyS') {
                toggleSide();
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
