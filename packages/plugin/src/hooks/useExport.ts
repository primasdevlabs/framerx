/**
 * Runs the compiler pipeline and delivers the ZIP.
 *
 * The actual work lives in `runProjectExport`, which reads the CURRENT
 * document/options from the store at call time — a refresh-triggered export
 * always compiles the freshly extracted document, never a stale closure.
 */

import { useCallback, useMemo } from 'react';

import { runProjectExport } from '../exporter/run-export';
import { usePluginStore } from '../store/plugin-store';

export function useExport(): {
    canExport: boolean;
    isCompiling: boolean;
    exportProject: () => Promise<void>;
    downloadAgain: () => void;
} {
    const document = usePluginStore((state) => state.document);
    const status = usePluginStore((state) => state.status);

    const isCompiling = status === 'compiling';
    const canExport = Boolean(document) && !isCompiling;

    const exportProject = useCallback(async () => {
        await runProjectExport();
    }, []);

    const downloadAgain = useCallback(() => {
        // Re-running the export compiles deterministically and re-delivers the ZIP.
        void exportProject();
    }, [exportProject]);

    return useMemo(
        () => ({ canExport, isCompiling, exportProject, downloadAgain }),
        [canExport, isCompiling, exportProject, downloadAgain],
    );
}
