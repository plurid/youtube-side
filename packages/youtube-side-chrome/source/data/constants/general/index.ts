// #region imports
    // #region external
    import {
        Options,
    } from '~data/interfaces';
    // #endregion external
// #endregion imports



// #region module
export const IN_PRODUCTION = process.env.NODE_ENV === 'production';


export const defaultOptions: Options = {
    background: 'transparent',
    blurred: false,
    width: 500,
    height: 550,
    left: true,
    recommendations: true,
};


export const OPTIONS_KEY = 'youtubeSideOptions';
// #endregion module
