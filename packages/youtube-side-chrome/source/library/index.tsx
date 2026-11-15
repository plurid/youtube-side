import React from 'react';
import { createRoot } from 'react-dom/client';

import Library from './Library';

const root = document.getElementById('root');

if (!root) {
    throw new Error('The library root element is missing.');
}

createRoot(root).render(
    <React.StrictMode>
        <Library />
    </React.StrictMode>,
);
