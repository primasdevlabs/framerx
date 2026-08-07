import type { PluginMode } from '../../store/plugin-store';

interface HeaderProps {
    mode: PluginMode;
}

export function Header({ mode }: HeaderProps) {
    const isDemo = mode === 'standalone';

    return (
        <header className="fx-header">
            <div className="fx-header__logo">Fx</div>
            <div className="fx-header__titles">
                <span className="fx-header__name">FramerX</span>
                <span className="fx-header__subtitle">Framer → React Compiler</span>
            </div>
            {isDemo ? (
                <span className="fx-header__badge fx-header__badge--demo">Demo</span>
            ) : (
                <span className="fx-header__badge">Framer</span>
            )}
        </header>
    );
}
