import type { PluginMode } from '../../store/plugin-store';

interface HeaderProps {
    mode: PluginMode;
    /** Whether a rescan is in progress (the icon spins). */
    isRefreshing?: boolean;
    /** Extra reasons to disable refresh (e.g. an export is compiling). */
    refreshDisabled?: boolean;
    /** Rescan the Framer project (and re-export). */
    onRefresh?: () => void;
}

export function Header({ mode, isRefreshing = false, refreshDisabled = false, onRefresh }: HeaderProps) {
    const isDemo = mode === 'standalone';
    const disabled = mode === 'loading' || isRefreshing || refreshDisabled;

    return (
        <header className="fx-header">
            <div className="fx-header__logo">Fx</div>
            <div className="fx-header__titles">
                <span className="fx-header__name">FramerX</span>
                <span className="fx-header__subtitle">Framer → React Compiler</span>
            </div>
            <button
                type="button"
                className={`fx-header__refresh${isRefreshing ? ' fx-header__refresh--spinning' : ''}`}
                onClick={onRefresh}
                disabled={disabled}
                title={isRefreshing ? 'Refreshing project…' : 'Rescan Framer project and re-export'}
                aria-label="Rescan Framer project"
            >
                <svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                >
                    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                    <polyline points="21 3 21 9 15 9" />
                </svg>
            </button>
            {isDemo ? (
                <span className="fx-header__badge fx-header__badge--demo">Demo</span>
            ) : (
                <span className="fx-header__badge">Framer</span>
            )}
        </header>
    );
}
