// #region imports
// #region libraries
import React from 'react';

import { createRoot } from 'react-dom/client';
// #endregion libraries

// #region internal
import App from './App';

// #endregion internal
// #endregion imports

// #region module
const application = document.getElementById('root');

if (!application) {
    throw new Error('The popup root element is missing.');
}

createRoot(application).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
// #endregion module
