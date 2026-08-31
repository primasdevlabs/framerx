import { usePluginStore } from '../../store/plugin-store';

export function LoadingState() {
    // Live progress: the extraction reports milestones (canvas, fonts,
    // components, node-walk progress) while mode is still 'loading' — a long
    // walk over a large canvas must look like progress, not like a failure.
    const phase = usePluginStore((state) => state.loadPhase);
    return (
        <div className="fx-loading">
            <div className="fx-loading__bar" />
            <span>{phase ?? 'Connecting to Framer…'}</span>
        </div>
    );
}

export function EmptyState() {
    return (
        <div className="fx-empty">
            <p>No document available.</p>
            <p style={{ fontSize: 11 }}>Open a Framer project and try again.</p>
        </div>
    );
}
