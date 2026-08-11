import { usePluginStore } from '../../store/plugin-store';

interface ExportButtonProps {
    canExport: boolean;
    onExport: () => void;
}

export function ExportButton({ canExport, onExport }: ExportButtonProps) {
    const status = usePluginStore((state) => state.status);
    const isCompiling = status === 'compiling';
    const isReady = status === 'ready';

    const label = isCompiling ? 'Compiling…' : isReady ? 'Export again' : 'Export Project';
    const className = `fx-export${isReady ? ' fx-export--success' : ''}`;

    return (
        <button
            type="button"
            className={className}
            disabled={!canExport}
            onClick={onExport}
            style={{
                backgroundColor: '#ffffff',
                color: '#000000',
                border: '1px solid #ffffff',
                opacity: !canExport ? 0.45 : 1,
            }}
        >
            {isCompiling && <span className="fx-spinner" aria-hidden="true" />}
            {isReady && <span aria-hidden="true">✓</span>}
            {label}
        </button>
    );
}
