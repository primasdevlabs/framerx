import { usePluginStore } from '../../store/plugin-store';

interface ToggleRowProps {
    label: string;
    hint: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}

function ToggleRow({ label, hint, checked, onChange }: ToggleRowProps) {
    return (
        <div className="fx-toggle-row">
            <div>
                <div className="fx-toggle__label">{label}</div>
                <div className="fx-toggle__hint">{hint}</div>
            </div>
            <button
                type="button"
                className="fx-switch"
                role="switch"
                aria-checked={checked}
                data-on={checked}
                onClick={() => onChange(!checked)}
            >
                <span className="fx-switch__thumb" />
            </button>
        </div>
    );
}

export function OptionsForm() {
    const options = usePluginStore((state) => state.options);
    const setOptions = usePluginStore((state) => state.setOptions);

    return (
        <section className="fx-card">
            <h2 className="fx-card__title">Export Options</h2>

            <div className="fx-field">
                <label className="fx-field__label" htmlFor="project-name">
                    Project name
                </label>
                <input
                    id="project-name"
                    className="fx-input"
                    type="text"
                    placeholder="framer-export"
                    value={options.projectName ?? ''}
                    onChange={(event) => setOptions({ projectName: event.target.value })}
                />
            </div>

            <ToggleRow
                label="Animations"
                hint="Convert interactions to Motion"
                checked={options.animations ?? true}
                onChange={(animations) => setOptions({ animations })}
            />
            <ToggleRow
                label="Format code"
                hint="Pretty-print with Prettier"
                checked={options.format ?? true}
                onChange={(format) => setOptions({ format })}
            />
        </section>
    );
}
