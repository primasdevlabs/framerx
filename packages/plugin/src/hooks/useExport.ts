/**
 * Runs the compiler pipeline and delivers the ZIP.
 */

import { useCallback, useMemo } from 'react';

import { compileProject, triggerDownload } from '../exporter/exporter';
import { usePluginStore, type ExportSummary } from '../store/plugin-store';

export function useExport(): {
    canExport: boolean;
    isCompiling: boolean;
    exportProject: () => Promise<void>;
    downloadAgain: () => void;
} {
    const document = usePluginStore((state) => state.document);
    const options = usePluginStore((state) => state.options);
    const status = usePluginStore((state) => state.status);
    const summary = usePluginStore((state) => state.summary);
    const setStatus = usePluginStore((state) => state.setStatus);
    const setError = usePluginStore((state) => state.setError);
    const setSummary = usePluginStore((state) => state.setSummary);

    const isCompiling = status === 'compiling';
    const canExport = Boolean(document) && !isCompiling;

    const exportProject = useCallback(async () => {
        if (!document || isCompiling) return;

        setStatus('compiling');
        setError(null);

        try {
            const result = await compileProject(document, {
                projectName: options.projectName,
                animations: options.animations,
                format: options.format,
            });

            const nextSummary: ExportSummary = {
                name: result.name,
                fileCount: result.files.length,
                sectionCount: result.files.filter((file) => file.path.startsWith('src/sections/')).length,
                componentCount: result.files.filter((file) => file.path.startsWith('src/components/')).length,
                zipBytes: result.zip?.byteLength ?? 0,
                files: result.files,
            };
            setSummary(nextSummary);

            if (result.zip) {
                triggerDownload(result.zip, `${result.name}.zip`);
            }
            setStatus('ready');
        } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
            setStatus('error');
        }
    }, [document, isCompiling, options.animations, options.format, options.projectName, setError, setStatus, setSummary]);

    const downloadAgain = useCallback(() => {
        // Re-running the export compiles deterministically and re-delivers the ZIP.
        void exportProject();
    }, [exportProject]);

    return useMemo(
        () => ({ canExport, isCompiling, exportProject, downloadAgain }),
        [canExport, isCompiling, exportProject, downloadAgain],
    );
}
