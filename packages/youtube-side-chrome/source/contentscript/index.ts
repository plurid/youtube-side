// #region module
let toggled = false;

const options = {
    background: 'transparent',
    width: 500,
    height: 550,
    left: true,
};

type Options = typeof options;


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

    renderSide(options);
    toggled = true;
}



const main = async () => {
    try {
        document.addEventListener('keydown', (event) => {
            if (event.altKey && event.code === 'KeyS') {
                toggleSide();
            }
        });
    } catch (error) {
    }
}

main();
// #endregion module



// #region exports
export {};
// #endregion exports
