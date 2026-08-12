import { useCallback } from 'react';

import { useExport } from '../hooks/useExport';
import { useFramerDocument } from '../hooks/useFramerDocument';
import { usePluginStore } from '../store/plugin-store';
import { DocumentCard } from './components/DocumentCard';
import { ErrorBanner } from './components/ErrorBanner';
import { ExportButton } from './components/ExportButton';
import { Header } from './components/Header';
import { EmptyState, LoadingState } from './components/LoadingState';
import { OptionsForm } from './components/OptionsForm';
import { ResultPanel } from './components/ResultPanel';
import { RetryPanel } from './components/RetryPanel';
import { extractionFailureReason, isRetryableExtractionFailure } from './retry';

export function App() {
    const { refreshDocument } = useFramerDocument();

    const mode = usePluginStore((state) => state.mode);
    const document = usePluginStore((state) => state.document);
    const summary = usePluginStore((state) => state.summary);
    const isRefreshing = usePluginStore((state) => state.isRefreshing);
    const error = usePluginStore((state) => state.error);
    const status = usePluginStore((state) => state.status);

    // A failed load (engine handshake never landed, or extraction degraded
    // because the canvas root could not be read) gets a prominent retry action
    // — rescanning reconnects, so the user never has to close and reopen.
    const needsRetry = isRetryableExtractionFailure(document, mode);
    const retryReason = extractionFailureReason(document, error);
    const { canExport, exportProject, downloadAgain } = useExport();

    // Refresh = rescan the Framer project, then re-export it with the fresh
    // document (the export reads the current store state at call time).
    const handleRefresh = useCallback(async () => {
        const refreshed = await refreshDocument();
        if (refreshed) await exportProject();
    }, [refreshDocument, exportProject]);

    const ready = mode !== 'loading';

    return (
        <div className="plugin">
            <Header
                mode={mode}
                isRefreshing={isRefreshing}
                refreshDisabled={status === 'compiling'}
                onRefresh={() => void handleRefresh()}
            />

            <main className="fx-body">
                {!ready && <LoadingState />}

                {/* A failed load gets a prominent retry action — the degraded
                    empty document must NOT masquerade as a real 0-section
                    document, and the handshake failure must not tell the user
                    to close and reopen the plugin. */}
                {ready && needsRetry && (
                    <RetryPanel reason={retryReason} isRefreshing={isRefreshing} onRetry={() => void handleRefresh()} />
                )}

                {ready && !document && !needsRetry && <EmptyState />}

                {/* Extraction/connection errors must be visible even when no
                    document loaded — a silent empty state looks like the
                    plugin failed to detect the project. */}
                {ready && !needsRetry && <ErrorBanner />}

                {ready && document && !needsRetry && (
                    <>
                        <DocumentCard document={document} />
                        <OptionsForm />
                        {summary && <ResultPanel summary={summary} onDownloadAgain={downloadAgain} />}
                    </>
                )}
            </main>

            <footer className="fx-footer">
                <ExportButton canExport={canExport} onExport={() => void exportProject()} />
            </footer>
        </div>
    );
}
