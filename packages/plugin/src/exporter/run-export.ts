/**
 * Store-driven export runner.
 *
 * The single export entry point used by both the export button and the manual
 * refresh flow. It reads the CURRENT document/options from the store at call
 * time — never from a captured closure — so a refresh-triggered export always
 * compiles the freshly extracted document.
 */

import { captureSdkKeys } from '../parser/probe';
import { usePluginStore, type ExportSummary } from '../store/plugin-store';

import { compileProject, triggerDownload } from './exporter';

/**
 * Compile the store's current document into a project, update the store
 * (status/summary/error), and deliver the ZIP. Returns the summary on success
 * or null when there is nothing to export (no document, or an export is
 * already running).
 */
export async function runProjectExport(): Promise<ExportSummary | null> {
    const state = usePluginStore.getState();
    const document = state.document;
    if (!document || state.status === 'compiling') return null;

    state.setStatus('compiling');
    state.setError(null);

    try {
        const result = await compileProject(document, {
            projectName: state.options.projectName,
            animations: state.options.animations,
            format: state.options.format,
        });

        const diagnostics = result.diagnostics;
        // One-shot SDK key probe: capture the exact identifiers the live
        // engine exposed on masters/instances/code files during THIS export.
        // Never throws — a failed probe records error statuses in the dump.
        const sdkProbe = state.api ? await captureSdkKeys(state.api) : undefined;
        const summary: ExportSummary = {
            name: result.name,
            fileCount: result.files.length,
            sectionCount: result.files.filter((file) => file.path.startsWith('src/sections/')).length,
            componentCount: result.files.filter((file) => file.path.startsWith('src/components/')).length,
            zipBytes: result.zip?.byteLength ?? 0,
            files: result.files,
            diagnostics: {
                nodes: diagnostics.nodesDiscovered,
                components: diagnostics.uniqueComponents,
                componentsFromMasters: diagnostics.componentsFromMasters,
                componentsFromCode: diagnostics.componentsFromCode,
                componentsSynthesized: diagnostics.componentsSynthesized,
                instances: diagnostics.componentInstances,
                assetsDiscovered: diagnostics.assetsDiscovered,
                uniqueAssets: diagnostics.uniqueAssets,
                warnings: diagnostics.validation.warnings,
                errors: diagnostics.validation.errors,
            },
            sdkProbe,
        };
        state.setSummary(summary);

        if (result.zip) {
            triggerDownload(result.zip, `${result.name}.zip`);
        }
        state.setStatus('ready');
        return summary;
    } catch (error) {
        state.setError(error instanceof Error ? error.message : String(error));
        state.setStatus('error');
        return null;
    }
}
