import { getMoviePlayer } from './page';
import { TOAST_CLASS } from './styles';

const TOAST_DURATION = 1_800;

let current: { element: HTMLElement; timer: number } | null = null;

/**
 * A short status line over the player, for actions taken by shortcut while
 * the panel may be closed (a bookmark). It lives inside the player so it
 * also shows in fullscreen, and it is announced politely to screen readers.
 */
export const showToast = (text: string): void => {
    const player = getMoviePlayer();
    if (!player) {
        return;
    }

    if (current) {
        window.clearTimeout(current.timer);
        current.element.remove();
    }

    const element = document.createElement('div');
    element.className = TOAST_CLASS;
    element.setAttribute('role', 'status');
    element.textContent = text;
    player.append(element);

    current = {
        element,
        timer: window.setTimeout(() => {
            element.remove();
            current = null;
        }, TOAST_DURATION),
    };
};
