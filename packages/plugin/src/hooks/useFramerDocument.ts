/**
 * Loads the Framer document into the store.
 *
 * In the Framer runtime the document is read from the SDK (and refreshed when
 * the canvas changes). Outside the runtime the mock document is loaded so the
 * full export flow can be exercised.
 */

import { useEffect } from 'react';

import { extractFramerDocument } from '../parser/document';
import { loadMockDocument } from '../parser/mock';
import { getFramerApi } from '../parser/sdk';
import { usePluginStore } from '../store/plugin-store';

export function useFramerDocument(): void {
    const setMode = usePluginStore((state) => state.setMode);
    const setDocument = usePluginStore((state) => state.setDocument);
    const setError = usePluginStore((state) => state.setError);

    useEffect(() => {
        let cancelled = false;
        let unsubscribeCanvas: (() => void) | undefined;

        async function init(): Promise<void> {
            const api = await getFramerApi();

            if (cancelled) return;

            if (!api) {
                // Standalone / demo mode.
                setMode('standalone');
                const mock = await loadMockDocument();
                if (!cancelled) setDocument(mock);
                return;
            }

            setMode('framer');
            try {
                const document = await extractFramerDocument(api);
                if (!cancelled) setDocument(document);

                // Refresh the document when the canvas changes.
                unsubscribeCanvas = api.subscribeToCanvasRoot(() => {
                    void extractFramerDocument(api).then((next) => {
                        if (!cancelled) setDocument(next);
                    });
                });
            } catch (error) {
                if (!cancelled) {
                    setError(error instanceof Error ? error.message : String(error));
                }
            }
        }

        void init();

        return () => {
            cancelled = true;
            unsubscribeCanvas?.();
        };
    }, [setMode, setDocument, setError]);
}
