import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DEFAULT_OPTIONS, OPTIONS_KEY } from '~data/options';

import { createChromeMock } from './chrome';

jest.mock('@plurid/plurid-themes', () => ({
    dewiki: {},
}));

jest.mock('@plurid/plurid-ui-components-react', () => ({
    InputSwitch: ({
        atChange,
        checked,
        name,
    }: {
        atChange: () => void;
        checked: boolean;
        name: string;
    }) => (
        <button type="button" aria-pressed={checked} onClick={atChange}>
            {name}
        </button>
    ),
    InputLine: ({
        atChange,
        name,
        text,
        textline,
    }: {
        atChange: (event: { target: { value: string } }) => void;
        name: string;
        text: string;
        textline?: { type: string };
    }) => (
        <input aria-label={name} type={textline?.type ?? 'text'} value={text} onChange={atChange} />
    ),
    LinkButton: ({ atClick, text }: { atClick: () => void; text: string }) => (
        <button type="button" onClick={atClick}>
            {text}
        </button>
    ),
    Dropdown: ({
        atSelect,
        selectables,
        selected,
    }: {
        atSelect: (selection: string) => void;
        selectables: string[];
        selected: string;
    }) => (
        <select
            aria-label="invert text"
            value={selected}
            onChange={(event) => atSelect(event.currentTarget.value)}
        >
            {selectables.map((item) => (
                <option key={item} value={item}>
                    {item}
                </option>
            ))}
        </select>
    ),
    Slider: ({
        atChange,
        max,
        min,
        name,
        step,
        value,
    }: {
        atChange: (value: number) => void;
        max: number;
        min: number;
        name: string;
        step: number;
        value: number;
    }) => (
        <input
            aria-label={name}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => atChange(Number(event.currentTarget.value))}
        />
    ),
}));

import Popup from '~popup/components/Popup';

describe('Popup', () => {
    test('hydrates from storage and saves toggled controls', async () => {
        const mock = createChromeMock({
            [OPTIONS_KEY]: {
                version: 2,
                values: {
                    ...DEFAULT_OPTIONS,
                    background: 'opaque',
                },
            },
        });

        render(<Popup />);

        const background = await screen.findByRole('button', { name: 'background [⌥ + B]' });
        expect(background).toHaveAttribute('aria-pressed', 'true');

        const blur = screen.getByLabelText('blur');
        fireEvent.change(blur, { target: { value: '8' } });

        await waitFor(() => {
            expect(mock.data[OPTIONS_KEY]).toEqual({
                version: 2,
                values: {
                    ...DEFAULT_OPTIONS,
                    background: 'opaque',
                    blur: 8,
                },
            });
        });

        const opacity = screen.getByLabelText('opacity');
        fireEvent.change(opacity, { target: { value: '40' } });

        await waitFor(() => {
            expect(mock.data[OPTIONS_KEY]).toEqual({
                version: 2,
                values: {
                    ...DEFAULT_OPTIONS,
                    background: 'opaque',
                    blur: 8,
                    opacity: 40,
                },
            });
        });

        fireEvent.change(screen.getByLabelText('invert text'), { target: { value: 'auto' } });

        await waitFor(() => {
            expect(mock.data[OPTIONS_KEY]).toEqual({
                version: 2,
                values: {
                    ...DEFAULT_OPTIONS,
                    background: 'opaque',
                    blur: 8,
                    opacity: 40,
                    invertText: 'auto',
                },
            });
        });

        fireEvent.click(background);

        await waitFor(() => {
            expect(mock.data[OPTIONS_KEY]).toEqual({
                version: 2,
                values: {
                    ...DEFAULT_OPTIONS,
                    blur: 8,
                    opacity: 40,
                    invertText: 'auto',
                },
            });
        });
        expect(screen.queryByLabelText('blur')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('opacity')).not.toBeInTheDocument();
    });

    test('toggles the side layout on the active tab', async () => {
        const mock = createChromeMock({
            [OPTIONS_KEY]: {
                version: 2,
                values: DEFAULT_OPTIONS,
            },
        });
        mock.sendMessageMock.mockResolvedValueOnce({
            ok: true,
            status: { active: false, available: true },
        });

        render(<Popup />);

        const toggle = await screen.findByRole('button', { name: 'side position [⌥ + S]' });
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(mock.sendMessageMock).toHaveBeenCalledWith(7, { type: 'GET_STATE' });

        mock.sendMessageMock.mockResolvedValueOnce({
            ok: true,
            status: { active: true, available: true },
        });
        fireEvent.click(toggle);

        await waitFor(() => {
            expect(toggle).toHaveAttribute('aria-pressed', 'true');
        });
        expect(mock.sendMessageMock).toHaveBeenLastCalledWith(7, {
            type: 'SET_ACTIVE',
            active: true,
        });
    });

    test('hides the side toggle when no YouTube tab answers', async () => {
        createChromeMock({
            [OPTIONS_KEY]: {
                version: 2,
                values: DEFAULT_OPTIONS,
            },
        });

        render(<Popup />);

        await screen.findByRole('button', { name: 'background [⌥ + B]' });
        expect(
            screen.queryByRole('button', { name: 'side position [⌥ + S]' }),
        ).not.toBeInTheDocument();
    });

    test('debounces dimension edits into one save', async () => {
        const mock = createChromeMock({
            [OPTIONS_KEY]: {
                version: 2,
                values: DEFAULT_OPTIONS,
            },
        });

        render(<Popup />);

        const width = await screen.findByLabelText('width');
        const height = await screen.findByLabelText('height');
        fireEvent.change(width, { target: { value: '600' } });
        fireEvent.change(width, { target: { value: '640' } });
        fireEvent.change(height, { target: { value: '720' } });
        fireEvent.change(height, { target: { value: 'not-a-number' } });

        await waitFor(() => {
            expect(mock.data[OPTIONS_KEY]).toEqual({
                version: 2,
                values: {
                    ...DEFAULT_OPTIONS,
                    width: 640,
                    height: 720,
                },
            });
        });
        expect(mock.setMock).toHaveBeenCalledTimes(1);
    });

    test('resets pending edits and all settings through the options module', async () => {
        const mock = createChromeMock({
            [OPTIONS_KEY]: {
                version: 2,
                values: {
                    ...DEFAULT_OPTIONS,
                    blur: 9,
                    recommendations: false,
                    width: 900,
                },
            },
        });

        render(<Popup />);

        const width = await screen.findByLabelText('width');
        fireEvent.change(width, { target: { value: '600' } });

        const reset = screen.getByRole('button', { name: 'reset' });
        fireEvent.click(reset);

        await waitFor(() => {
            expect(mock.data[OPTIONS_KEY]).toEqual({
                version: 2,
                values: DEFAULT_OPTIONS,
            });
        });
        expect(mock.setMock).toHaveBeenCalledTimes(1);
    });

    test('keeps the last stored options when writes fail', async () => {
        const mock = createChromeMock({
            [OPTIONS_KEY]: {
                version: 2,
                values: DEFAULT_OPTIONS,
            },
        });

        render(<Popup />);

        const leftSide = await screen.findByRole('button', { name: 'left side [⌥ + L]' });

        mock.setMock.mockRejectedValueOnce(new Error('write denied'));
        fireEvent.click(leftSide);

        mock.setMock.mockRejectedValueOnce(new Error('write denied'));
        fireEvent.click(screen.getByRole('button', { name: 'reset' }));

        await waitFor(() => {
            expect(mock.setMock).toHaveBeenCalledTimes(2);
        });
        expect(mock.data[OPTIONS_KEY]).toEqual({
            version: 2,
            values: DEFAULT_OPTIONS,
        });
    });

    test('cleans up pending work on unmount', async () => {
        const mock = createChromeMock({
            [OPTIONS_KEY]: {
                version: 2,
                values: DEFAULT_OPTIONS,
            },
        });

        const first = render(<Popup />);
        const width = await first.findByLabelText('width');
        fireEvent.change(width, { target: { value: '600' } });
        first.unmount();

        const second = render(<Popup />);
        second.unmount();

        await new Promise((resolve) => {
            window.setTimeout(resolve, 250);
        });

        expect(mock.setMock).not.toHaveBeenCalled();
    });
});
