import '@testing-library/jest-dom/jest-globals';
import { afterEach } from '@jest/globals';

afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
});
