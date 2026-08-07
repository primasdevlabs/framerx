import '@framer/plugin/framer.css';

import { createRoot } from 'react-dom/client';
import React from 'react';

import { App } from './ui/App';
import './ui/styles.css';
import { loadFramerSdk } from './parser/sdk';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

// Open the plugin panel when running inside the Framer runtime. The SDK module
// resolves to null in standalone mode, so nothing happens outside Framer.
void loadFramerSdk().then((sdk) => {
    if (sdk) {
        void sdk.framer.showUI({
            title: 'FramerX Compiler',
            width: 340,
            height: 560,
            position: 'top right',
            resizable: true,
            minWidth: 320,
            minHeight: 460,
        });
    }
});

createRoot(root).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
