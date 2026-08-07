import { usePluginStore } from '../../store/plugin-store';

export function ErrorBanner() {
    const error = usePluginStore((state) => state.error);

    if (!error) return null;

    return (
        <div className="fx-error" role="alert">
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
        </div>
    );
}
