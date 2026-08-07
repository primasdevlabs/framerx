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
    useFramerDocument();

    const mode = usePluginStore((state) => state.mode);
    const document = usePluginStore((state) => state.document);
    const summary = usePluginStore((state) => state.summary);
    const { canExport, exportProject, downloadAgain } = useExport();

    const ready = mode !== 'loading';

    return (
        <div className="plugin">
            <Header mode={mode} />

            <main className="fx-body">
                {!ready && <LoadingState />}

                {ready && !document && <EmptyState />}

                {ready && document && (
                    <>
                        <DocumentCard document={document} />
                        <OptionsForm />
                        <ErrorBanner />
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
