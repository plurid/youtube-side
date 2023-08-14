// #region module
export const IN_PRODUCTION = process.env.NODE_ENV === 'production';


export const defaultOptions = {
    background: 'transparent',
    width: 500,
    height: 550,
    left: true,
} as const;


export const OPTIONS_KEY = 'youtubeSideOptions';
// #endregion module
