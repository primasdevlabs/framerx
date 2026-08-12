/**
 * Loads the Framer document into the store.
 *
 * In the Framer runtime the document is read from the SDK (and refreshed when
 * the canvas changes). Outside the runtime the mock document is loaded so the
 * full export flow can be exercised.
 *
 * `refreshDocument` rescans the project on demand — re-extracting the document
 * from the live engine connection (reconnecting when it was lost, so refresh
 * doubles as a retry) — and returns whether a fresh document was loaded. The
 * caller then re-exports so the delivered project matches the rescan.
 */

import { useCallback, useEffect, useRef } from 'react';

import { extractFramerDocument } from '../parser/document';
import { loadMockDocument } from '../parser/mock';
import type { FramerApi } from '../parser/sdk';
import { connectToFramer, isInFramerIframe, lastFramerConnectDiagnostics } from '../parser/sdk';
import { usePluginStore } from '../store/plugin-store';

/**
 * A human-readable handshake-failure message, including the diagnostics that
 * distinguish "the engine never answered" (registration / reachability) from
 * "the engine answered but the SDK still did not come up" (protocol mismatch).
 */
function connectErrorMessage(): string {
    const diagnostics = lastFramerConnectDiagnostics();
    if (!diagnostics) {
        return 'Could not connect to the Framer engine. Press Retry to try again.';
    }
    const seconds = Math.max(1, Math.round(diagnostics.elapsedMs / 1000));
    if (diagnostics.receivedAnyResponse) {
        return `The Framer engine answered, but the connection still failed after ${diagnostics.attempts} attempts (${seconds}s). Press Retry to try again.`;
    }
    return (
        `Could not connect to the Framer engine: it did not answer the plugin-ready ` +
        `handshake after ${diagnostics.attempts} attempts (${seconds}s). ` +
        `Check that the plugin is reachable from Framer (dev server running, HTTPS, no ` +
        `ad-blocker blocking localhost), then press Retry.`
    );
}
export function useFramerDocument(): { refreshDocument: () => Promise<boolean> } {
    const setMode = usePluginStore((state) => state.setMode);
    const setApi = usePluginStore((state) => state.setApi);
    const setDocument = usePluginStore((state) => state.setDocument);
    const setError = usePluginStore((state) => state.setError);
    const setRefreshing = usePluginStore((state) => state.setRefreshing);
    const isRefreshing = usePluginStore((state) => state.isRefreshing);

    // The live engine connection, shared between the initial load and manual
    // refreshes — a refresh re-extracts without reconnecting.
    const apiRef = useRef<FramerApi | null>(null);

    useEffect(() => {
        let cancelled = false;
        let unsubscribeCanvas: (() => void) | undefined;

        async function init(): Promise<void> {
            const api = await connectToFramer();
            if (cancelled) return;
            apiRef.current = api;
            // The live connection is shared with the export runner so the SDK
            // key probe can capture the engine's actual identifiers on export.
            setApi(api);

            if (!api) {
                // Inside the Framer host but no engine answered (handshake
                // timeout): report it instead of silently showing the mock
                // document — the user asked for their project, not a demo.
                if (isInFramerIframe()) {
                    setMode('framer');
                    setError(connectErrorMessage());
                    return;
                }

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

                // Refresh the document when the canvas changes. A failed
                // re-extraction must not become an unhandled rejection — it
                // keeps the last good document and reports the error.
                unsubscribeCanvas = api.subscribeToCanvasRoot(() => {
                    void extractFramerDocument(api)
                        .then((next) => {
                            if (!cancelled) setDocument(next);
                        })
                        .catch((error: unknown) => {
                            if (!cancelled) {
                                setError(error instanceof Error ? error.message : String(error));
                            }
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
            setApi(null);
        };
    }, [setMode, setApi, setDocument, setError]);

    /**
     * Rescan the Framer project: re-extract the document from the engine and
     * replace the store's document. Returns true when a fresh document was
     * loaded (the caller should then re-export).
     */
    const refreshDocument = useCallback(async (): Promise<boolean> => {
        if (isRefreshing) return false;
        setRefreshing(true);
        setError(null);
        try {
            // Reuse the live connection; reconnect when it was lost (e.g. the
            // engine error state) so refresh doubles as a retry.
            const api = apiRef.current ?? (await connectToFramer());
            setApi(api);
            if (!api) {
                if (isInFramerIframe()) {
                    setMode('framer');
                    setError(connectErrorMessage());
                    return false;
                }
                // Standalone / demo mode: reload the mock document.
                setMode('standalone');
                const mock = await loadMockDocument();
                setDocument(mock);
                return true;
            }
            apiRef.current = api;
            setMode('framer');
            const document = await extractFramerDocument(api);
            setDocument(document);
            return true;
        } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
            return false;
        } finally {
            setRefreshing(false);
        }
    }, [isRefreshing, setApi, setDocument, setError, setMode, setRefreshing]);

    return { refreshDocument };
}
