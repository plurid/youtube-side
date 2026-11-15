import { jest } from '@jest/globals';

type StorageListener = Parameters<typeof chrome.storage.onChanged.addListener>[0];
type StorageGet = (keys?: string | string[] | null) => Promise<Record<string, unknown>>;
type StorageSet = (values: Record<string, unknown>) => Promise<void>;
type StorageRemove = (keys: string | string[]) => Promise<void>;
type MessageListener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
) => boolean | undefined;
type TabsQuery = (query: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
type TabsSendMessage = (tabId: number, message: unknown) => Promise<unknown>;

export interface ChromeMock {
    chrome: typeof chrome;
    data: Record<string, unknown>;
    storageListeners: Set<StorageListener>;
    messageListeners: Set<MessageListener>;
    getMock: ReturnType<typeof jest.fn<StorageGet>>;
    setMock: ReturnType<typeof jest.fn<StorageSet>>;
    removeMock: ReturnType<typeof jest.fn<StorageRemove>>;
    createTabMock: ReturnType<
        typeof jest.fn<(properties: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>>
    >;
    queryMock: ReturnType<typeof jest.fn<TabsQuery>>;
    sendMessageMock: ReturnType<typeof jest.fn<TabsSendMessage>>;
}

export const createChromeMock = (initialData: Record<string, unknown> = {}): ChromeMock => {
    const data = { ...initialData };
    const storageListeners = new Set<StorageListener>();
    const messageListeners = new Set<MessageListener>();

    // like chrome.storage, values are copied on the way in and out
    const copy = <T>(value: T): T =>
        value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

    const getMock = jest.fn<StorageGet>(async (keys) => {
        if (keys === null || keys === undefined) {
            return copy({ ...data });
        }

        const result: Record<string, unknown> = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) {
            if (key in data) {
                result[key] = copy(data[key]);
            }
        }
        return result;
    });

    const notify = (changes: Record<string, chrome.storage.StorageChange>) => {
        for (const listener of storageListeners) {
            listener(changes, 'local');
        }
    };

    const setMock = jest.fn<StorageSet>(async (values) => {
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const [key, newValue] of Object.entries(values)) {
            changes[key] = { oldValue: data[key], newValue: copy(newValue) };
            data[key] = copy(newValue);
        }
        notify(changes);
    });

    const removeMock = jest.fn<StorageRemove>(async (keys) => {
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) {
            if (key in data) {
                changes[key] = { oldValue: data[key] };
                delete data[key];
            }
        }
        if (Object.keys(changes).length > 0) {
            notify(changes);
        }
    });

    const createTabMock = jest.fn(
        async (properties: chrome.tabs.CreateProperties) =>
            ({ id: 8, ...properties }) as chrome.tabs.Tab,
    );

    const queryMock = jest.fn<TabsQuery>(async () => [{ id: 7 } as chrome.tabs.Tab]);
    const sendMessageMock = jest.fn<TabsSendMessage>(async (_tabId, message) => {
        let response: unknown;
        for (const listener of messageListeners) {
            listener(message, {} as chrome.runtime.MessageSender, (value) => {
                response = value;
            });
        }
        return response;
    });

    const chromeMock = {
        storage: {
            local: {
                get: getMock,
                set: setMock,
                remove: removeMock,
            },
            onChanged: {
                addListener: jest.fn((listener: StorageListener) => {
                    storageListeners.add(listener);
                }),
                removeListener: jest.fn((listener: StorageListener) => {
                    storageListeners.delete(listener);
                }),
                hasListener: jest.fn((listener: StorageListener) => storageListeners.has(listener)),
                hasListeners: jest.fn(() => storageListeners.size > 0),
                addRules: jest.fn(),
                getRules: jest.fn(),
                removeRules: jest.fn(),
            },
        },
        runtime: {
            onMessage: {
                addListener: jest.fn((listener: MessageListener) => {
                    messageListeners.add(listener);
                }),
                removeListener: jest.fn((listener: MessageListener) => {
                    messageListeners.delete(listener);
                }),
                hasListener: jest.fn((listener: MessageListener) => messageListeners.has(listener)),
                hasListeners: jest.fn(() => messageListeners.size > 0),
            },
            getURL: jest.fn((path: string) => `chrome-extension://test/${path}`),
        },
        tabs: {
            create: createTabMock,
            query: queryMock,
            sendMessage: sendMessageMock,
        },
    } as unknown as typeof chrome;

    Object.defineProperty(globalThis, 'chrome', {
        configurable: true,
        value: chromeMock,
    });

    return {
        chrome: chromeMock,
        data,
        storageListeners,
        messageListeners,
        getMock,
        setMock,
        removeMock,
        createTabMock,
        queryMock,
        sendMessageMock,
    };
};
