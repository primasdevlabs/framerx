import type { ExportSummary } from '../../store/plugin-store';
import { formatBytes, groupByDirectory } from '../../utils/format';

interface ResultPanelProps {
    summary: ExportSummary;
    onDownloadAgain: () => void;
}

export function ResultPanel({ summary, onDownloadAgain }: ResultPanelProps) {
    const groups = groupByDirectory(summary.files);

    return (
        <section className="fx-card fx-result">
            <div className="fx-result__head">
                <span aria-hidden="true">✓</span> Export complete
            </div>
            <p className="fx-result__meta">
                {summary.fileCount} files · {summary.sectionCount} sections · {summary.componentCount} components ·{' '}
                {formatBytes(summary.zipBytes)} ZIP
            </p>
            <div className="fx-tree" aria-label="Generated files">
                {groups.map((group) => (
                    <div key={group.directory}>
                        <div className="fx-tree__dir">
                            {group.directory === '.' ? 'root' : group.directory}/
                        </div>
                        {group.files.map((name) => (
                            <div key={name} className="fx-tree__file">
                                {name}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
            <button type="button" className="fx-download-again" onClick={onDownloadAgain}>
                Download {summary.name}.zip again
            </button>
        </section>
    );
}
