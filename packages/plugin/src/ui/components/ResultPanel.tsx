import { triggerDownload } from '../../exporter/exporter';
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
            {summary.diagnostics && (
                <div className="fx-diagnostics">
                    <p className="fx-diagnostics__counts">
                        {summary.diagnostics.nodes} nodes · {summary.diagnostics.components} components ·{' '}
                        {summary.diagnostics.componentsFromMasters} master-backed ·{' '}
                        {summary.diagnostics.componentsFromCode} code · {summary.diagnostics.componentsSynthesized}{' '}
                        synthesized · {summary.diagnostics.instances} instances · {summary.diagnostics.assetsDiscovered}{' '}
                        assets discovered · {summary.diagnostics.uniqueAssets} unique assets
                    </p>
                    {summary.diagnostics.warnings.length > 0 && (
                        <ul className="fx-diagnostics__warnings">
                            {summary.diagnostics.warnings.map((warning, index) => (
                                <li key={`w-${index}`}>
                                    ⚠ {warning.path ? `${warning.path}: ` : ''}
                                    {warning.message}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
            {summary.sdkProbe && (
                <details className="fx-debug">
                    <summary>
                        SDK keys (debug) — {summary.sdkProbe.masters.length} masters ·{' '}
                        {summary.sdkProbe.instances.length} instances · {summary.sdkProbe.codeFiles.length} code files ·{' '}
                        {summary.sdkProbe.matching.masterMatched} master-matched ·{' '}
                        {summary.sdkProbe.matching.masterUnmatched.length} unmatched
                    </summary>
                    <p className="fx-debug__hint">
                        The exact componentIdentifier / insertURL / componentName keys the live engine exposed during
                        this export. Instances that matched neither a master nor a code file are listed under
                        "matching".
                    </p>
                    <pre className="fx-debug__json">{JSON.stringify(summary.sdkProbe, null, 2)}</pre>
                    <button
                        type="button"
                        className="fx-download-again"
                        onClick={() =>
                            triggerDownload(
                                new TextEncoder().encode(JSON.stringify(summary.sdkProbe, null, 2)),
                                'sdk-keys.json',
                                'application/json',
                            )
                        }
                        style={{ backgroundColor: '#ffffff', color: '#000000', border: '1px solid #ffffff' }}
                    >
                        Download sdk-keys.json
                    </button>
                </details>
            )}
            <div className="fx-tree" aria-label="Generated files">
                {groups.map((group) => (
                    <div key={group.directory}>
                        <div className="fx-tree__dir">{group.directory === '.' ? 'root' : group.directory}/</div>
                        {group.files.map((name) => (
                            <div key={name} className="fx-tree__file">
                                {name}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
            <button
                type="button"
                className="fx-download-again"
                onClick={onDownloadAgain}
                style={{
                    backgroundColor: '#ffffff',
                    color: '#000000',
                    border: '1px solid #ffffff',
                }}
            >
                Download {summary.name}.zip again
            </button>
        </section>
    );
}
