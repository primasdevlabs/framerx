import '@framer/plugin/framer.css';

import { createRoot } from 'react-dom/client';
import React from 'react';

import { App } from './ui/App';
import './ui/styles.css';
import { connectToFramer } from './parser/sdk';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

// Open the plugin panel when running inside the Framer runtime. connectToFramer
// waits (with retry) for the engine handshake, so a slow cold start still opens
// the panel; outside Framer it resolves null and nothing happens.
void connectToFramer().then((api) => {
    if (api) {
        void api.showUI({
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
