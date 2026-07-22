import { jest } from '@jest/globals';

type StorageListener = Parameters<typeof chrome.storage.onChanged.addListener>[0];
type StorageGet = (key: string) => Promise<Record<string, unknown>>;
type StorageSet = (values: Record<string, unknown>) => Promise<void>;
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
    queryMock: ReturnType<typeof jest.fn<TabsQuery>>;
    sendMessageMock: ReturnType<typeof jest.fn<TabsSendMessage>>;
}

export const createChromeMock = (initialData: Record<string, unknown> = {}): ChromeMock => {
    const data = { ...initialData };
    const storageListeners = new Set<StorageListener>();
    const messageListeners = new Set<MessageListener>();

    const getMock = jest.fn<StorageGet>(async (key) => ({
        [key]: data[key],
    }));
    const setMock = jest.fn<StorageSet>(async (values) => {
        for (const [key, newValue] of Object.entries(values)) {
            const oldValue = data[key];
            data[key] = newValue;

            const changes = {
                [key]: {
                    oldValue,
                    newValue,
                },
            };
            for (const listener of storageListeners) {
                listener(changes, 'local');
            }
        }
    });

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
        },
        tabs: {
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
        queryMock,
        sendMessageMock,
    };
};
