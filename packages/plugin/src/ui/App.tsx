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

export function App() {
    const { refreshDocument } = useFramerDocument();

    const mode = usePluginStore((state) => state.mode);
    const document = usePluginStore((state) => state.document);
    const summary = usePluginStore((state) => state.summary);
    const isRefreshing = usePluginStore((state) => state.isRefreshing);
    const status = usePluginStore((state) => state.status);
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

                {ready && !document && <EmptyState />}

                {/* Extraction/connection errors must be visible even when no
                    document loaded — a silent empty state looks like the
                    plugin failed to detect the project. */}
                {ready && <ErrorBanner />}

                {ready && document && (
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
