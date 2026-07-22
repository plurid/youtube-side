import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { YouTubeSideController } from '~contentscript/controller';
import { DEFAULT_OPTIONS, OPTIONS_KEY } from '~data';

import { type ChromeMock, createChromeMock } from './chrome';

const flushLayout = () =>
    new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
    });

const settleDebounce = () =>
    new Promise<void>((resolve) => {
        window.setTimeout(resolve, 250);
    });

const pressShortcut = (code: string, target: EventTarget = document) => {
    target.dispatchEvent(
        new KeyboardEvent('keydown', {
            altKey: true,
            code,
            bubbles: true,
        }),
    );
};

class ResizeObserverMock {
    callback: () => void;

    constructor(callback: () => void) {
        this.callback = callback;
        resizeObservers.push(this);
    }

    observe() {}
    unobserve() {}
    disconnect() {}
}

let resizeObservers: ResizeObserverMock[] = [];

describe('YouTubeSideController', () => {
    let mock: ChromeMock;

    beforeEach(() => {
        document.head.innerHTML = '';
        document.body.innerHTML = `
            <ytd-app>
                <div id="below" style="color: red"></div>
                <div id="chat-container"></div>
                <div id="related" style="display: grid"></div>
            </ytd-app>
        `;
        mock = createChromeMock({
            [OPTIONS_KEY]: {
                version: 2,
                values: DEFAULT_OPTIONS,
            },
        });
        window.requestAnimationFrame = (callback) =>
            window.setTimeout(() => callback(performance.now()), 0);
        window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
        resizeObservers = [];
        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            value: ResizeObserverMock,
        });
    });

    test('attaches and removes only extension-owned layout state', async () => {
        const controller = new YouTubeSideController();
        await controller.start();
        await controller.start();

        controller.setActive(true);
        await flushLayout();

        const below = document.getElementById('below') as HTMLElement;
        expect(below.dataset.youtubeSideActive).toBe('true');
        expect(below.dataset.youtubeSidePosition).toBe('left');
        expect(below.style.color).toBe('red');

        controller.setActive(false);
        await flushLayout();

        expect(below.dataset.youtubeSideActive).toBeUndefined();
        expect(below.style.color).toBe('red');
        controller.stop();
        controller.stop();
    });

    test('starts with defaults when storage is unavailable', async () => {
        mock.getMock.mockRejectedValueOnce(new Error('storage unavailable'));

        const controller = new YouTubeSideController();
        await controller.start();
        controller.setActive(true);
        await flushLayout();

        const below = document.getElementById('below') as HTMLElement;
        expect(below.dataset.youtubeSidePosition).toBe('left');
        controller.stop();
    });

    test('applies independent blur, opacity, and inversion settings', async () => {
        mock.data[OPTIONS_KEY] = {
            version: 2,
            values: {
                ...DEFAULT_OPTIONS,
                background: 'opaque',
                blur: 8,
                opacity: 40,
                invertText: 'on',
            },
        };

        const controller = new YouTubeSideController();
        await controller.start();
        controller.setActive(true);
        await flushLayout();

        const below = document.getElementById('below') as HTMLElement;
        expect(below.dataset.youtubeSideBackground).toBe('opaque');
        expect(below.dataset.youtubeSideInverted).toBe('true');
        expect(below.style.getPropertyValue('--youtube-side-blur')).toBe('8px');
        expect(below.style.getPropertyValue('--youtube-side-opacity')).toBe('40%');

        controller.setActive(false);
        await flushLayout();
        expect(below.dataset.youtubeSideInverted).toBeUndefined();
        expect(below.style.getPropertyValue('--youtube-side-opacity')).toBe('');
        controller.stop();
    });

    test('auto mode inverts from the brightness behind the panel', async () => {
        mock.data[OPTIONS_KEY] = {
            version: 2,
            values: {
                ...DEFAULT_OPTIONS,
                invertText: 'auto',
            },
        };

        let level = 20;
        const fakeContext = {
            canvas: { width: 0, height: 0 },
            drawImage: jest.fn(),
            getImageData: jest.fn(() => {
                const data = new Uint8ClampedArray(32 * 32 * 4);
                data.fill(level);
                return { data };
            }),
        };
        const contextSpy = jest
            .spyOn(HTMLCanvasElement.prototype, 'getContext')
            .mockReturnValue(fakeContext as unknown as RenderingContext);

        const rect = (left: number, top: number, right: number, bottom: number) =>
            ({
                left,
                top,
                right,
                bottom,
                width: right - left,
                height: bottom - top,
            }) as DOMRect;

        const video = document.createElement('video');
        Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1280 });
        Object.defineProperty(video, 'videoHeight', { configurable: true, value: 720 });
        Object.defineProperty(video, 'readyState', { configurable: true, value: 2 });
        video.getBoundingClientRect = () => rect(0, 0, 800, 450);
        document.querySelector('ytd-app')?.append(video);

        const below = document.getElementById('below') as HTMLElement;
        below.getBoundingClientRect = () => rect(24, 56, 524, 606);

        const controller = new YouTubeSideController();
        await controller.start();
        controller.setActive(true);
        await flushLayout();

        expect(below.dataset.youtubeSideInverted).toBe('false');

        const tick = () =>
            (
                controller as unknown as { samplePanelBrightness: () => void }
            ).samplePanelBrightness();

        level = 240;
        tick();
        tick();
        await flushLayout();
        expect(below.dataset.youtubeSideInverted).toBe('true');

        level = 20;
        tick();
        tick();
        await flushLayout();
        expect(below.dataset.youtubeSideInverted).toBe('false');

        fakeContext.getImageData.mockImplementation(() => {
            throw new Error('tainted');
        });
        tick();
        tick();
        await flushLayout();
        expect(below.dataset.youtubeSideInverted).toBe('false');

        controller.stop();
        contextSpy.mockRestore();
    });

    test('answers popup requests over runtime messaging', async () => {
        const controller = new YouTubeSideController();
        await controller.start();

        await expect(mock.sendMessageMock(7, { type: 'GET_STATE' })).resolves.toEqual({
            ok: true,
            status: { active: false, available: true },
        });
        await expect(
            mock.sendMessageMock(7, { type: 'SET_ACTIVE', active: true }),
        ).resolves.toEqual({
            ok: true,
            status: { active: true, available: true },
        });
        await expect(mock.sendMessageMock(7, { type: 'UNRELATED' })).resolves.toBeUndefined();

        controller.stop();
        expect(mock.messageListeners.size).toBe(0);
    });

    test('reconciles a replacement panel after YouTube navigation', async () => {
        const controller = new YouTubeSideController();
        await controller.start();
        controller.setActive(true);
        await flushLayout();

        document.getElementById('below')?.remove();
        document.dispatchEvent(new Event('yt-navigate-finish'));
        await flushLayout();

        const replacement = document.createElement('div');
        replacement.id = 'below';
        document.querySelector('ytd-app')?.append(replacement);
        await flushLayout();
        await flushLayout();

        expect(replacement.dataset.youtubeSideActive).toBe('true');
        controller.stop();
    });

    test('toggles background and side through shortcuts while active', async () => {
        const controller = new YouTubeSideController();
        await controller.start();
        await flushLayout();

        pressShortcut('KeyB');
        pressShortcut('KeyL');
        await flushLayout();
        expect(controller.getState().active).toBe(false);

        pressShortcut('KeyS');
        await flushLayout();
        expect(controller.getState().active).toBe(true);

        pressShortcut('KeyB');
        pressShortcut('KeyL');
        await flushLayout();

        const below = document.getElementById('below') as HTMLElement;
        expect(below.dataset.youtubeSideBackground).toBe('opaque');
        expect(below.dataset.youtubeSidePosition).toBe('right');
        controller.stop();
        await flushLayout();
        expect(below.dataset.youtubeSideActive).toBeUndefined();
    });

    test('persists panel drags through the options module', async () => {
        const controller = new YouTubeSideController();
        await controller.start();
        controller.setActive(true);
        await flushLayout();

        const below = document.getElementById('below') as HTMLElement;
        expect(resizeObservers.length).toBe(1);

        below.style.width = '800px';
        below.style.height = '700px';
        Object.defineProperty(below, 'offsetWidth', { configurable: true, value: 800 });
        Object.defineProperty(below, 'offsetHeight', { configurable: true, value: 700 });
        for (const observer of resizeObservers) {
            observer.callback();
        }
        await settleDebounce();

        expect(below.style.width).toBe('');
        expect(below.style.getPropertyValue('--youtube-side-width')).toBe('800px');
        expect(mock.data[OPTIONS_KEY]).toEqual({
            version: 2,
            values: {
                ...DEFAULT_OPTIONS,
                width: 800,
                height: 700,
            },
        });
        controller.stop();
    });

    test('applies recommendation settings and ignores shortcuts in inputs', async () => {
        const controller = new YouTubeSideController();
        await controller.start();

        pressShortcut('KeyR');
        await flushLayout();
        expect(document.getElementById('related')?.dataset.youtubeSideHidden).toBe('true');

        const input = document.createElement('input');
        document.body.append(input);
        pressShortcut('KeyS', input);
        await flushLayout();

        expect(controller.getState().active).toBe(false);
        controller.stop();
    });

    test('ignores unrelated keys and survives failed writes', async () => {
        const controller = new YouTubeSideController();
        await controller.start();

        pressShortcut('KeyX');
        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                altKey: true,
                ctrlKey: true,
                code: 'KeyS',
                bubbles: true,
            }),
        );
        await flushLayout();
        expect(controller.getState().active).toBe(false);

        mock.setMock.mockRejectedValueOnce(new Error('write denied'));
        pressShortcut('KeyR');
        await flushLayout();

        expect(document.getElementById('related')?.dataset.youtubeSideHidden).toBe('true');
        expect(mock.data[OPTIONS_KEY]).toEqual({
            version: 2,
            values: DEFAULT_OPTIONS,
        });
        controller.stop();
    });
});
