interface RetryPanelProps {
    /** Why the load failed (store error or extraction-recorded reason). */
    reason: string | null;
    /** Whether a rescan is already in progress (disables the button). */
    isRefreshing: boolean;
    /** Rescan the Framer project (re-extract, then re-export). */
    onRetry: () => void;
}

/**
 * Prominent retry action shown when the project failed to load — the engine
 * handshake never landed or the canvas root could not be read (e.g. a
 * timed-out SDK call). The user can re-attempt right from the panel instead
 * of closing and reopening the plugin.
 */
export function RetryPanel({ reason, isRefreshing, onRetry }: RetryPanelProps) {
    return (
        <div className="fx-retry" role="alert">
            <div className="fx-retry__icon" aria-hidden="true">
                ⚠
            </div>
            <h2 className="fx-retry__title">Couldn&apos;t load the project</h2>
            {/* The reason is the whole point of this panel — never render it
                empty. When neither the store error nor an extraction record
                carries one (e.g. the error was cleared by a retry race), the
                fallback still tells the user where the real diagnostics are. */}
            <p className="fx-retry__reason">
                {reason ?? 'No failure reason was recorded — see the browser console for [framerx] diagnostics.'}
            </p>
            <p className="fx-retry__hint">
                Press Retry to rescan the project — no need to close and reopen the plugin.
            </p>
            <p className="fx-retry__meta">
                bundle {__FRAMERX_BUILD_ID__} · press F12 on the Framer tab and read the [framerx] console lines
            </p>
            <button type="button" className="fx-retry__button" onClick={onRetry} disabled={isRefreshing}>
                {isRefreshing ? 'Retrying…' : 'Retry'}
            </button>
        </div>
    );
}
