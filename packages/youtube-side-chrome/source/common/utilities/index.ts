export const log = (...message: unknown[]): void => {
    if (process.env.NODE_ENV !== 'production') {
        console.log('youtube-side ::', ...message);
    }
};

export const getActiveTab = async (): Promise<chrome.tabs.Tab> => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || tab.id === undefined) {
        throw new Error('No active browser tab is available');
    }
    return tab;
};
