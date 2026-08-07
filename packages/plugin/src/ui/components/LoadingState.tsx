export function LoadingState() {
    return (
        <div className="fx-loading">
            <div className="fx-loading__bar" />
            <span>Connecting to Framer…</span>
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
