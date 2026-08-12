/**
 * Export manifest — the machine-readable summary of an export run.
 *
 * Every export ships a `.export-manifest.json` at the project root so
 * downstream tooling (CI, visual regression, debugging) can answer:
 *
 *   - what source properties the compiler saw,
 *   - which it preserved into the AST,
 *   - which it emitted into the React/CSS,
 *   - which it dropped (unsupported, lost, or undocumented),
 *   - and what files landed in the ZIP.
 *
 * The manifest is intentionally a snapshot of one run — its shape never
 * depends on the parser package so the generators package stays acyclic.
 */

import type { VirtualFile } from './types';

/** The input shape the manifest generator expects. */
export interface ExportManifestInput {
    /** The project name. */
    projectName: string;
    /** The compiler version (defaults to 0.1.0). */
    compilerVersion?: string;
    /** The Framer document name. */
    sourceName?: string;
    /** ISO timestamp of this run. When omitted, the manifest writes a
     *  deterministic derivation marker instead so the same source produces
     *  byte-identical output across CI runs. */
    exportedAt?: string;
    /** A deterministic compilation id (the SAR). When provided, it is
     *  emitted verbatim and used as the fallback `exportedAt` so identical
     *  inputs stay byte-identical. */
    derivationHash?: string;
    /** Aggregated Source Property Coverage (collected by the compiler). */
    coverage?: {
        registered: number;
        discovered: number;
        preserved: number;
        emitted: number;
        unsupported: number;
        lost: number;
        properties?: Array<{
            id: string;
            sdkAttribute: string;
            stage: 'discovered' | 'framer-preserved' | 'ast-preserved' | 'emitted' | 'unsupported' | 'lost';
            discoveredCount?: number;
        }>;
    };
    /** Asset counts. */
    assets?: { discovered: number; unique: number };
    /** Font counts. */
    fonts?: number;
    /**
     * Replica folding counts (SDK `isReplica` breakpoint/variant overrides):
     * how many were discovered, folded into their primary's responsive
     * behavior, kept as independent nodes (unresolved), and how many carried
     * override kinds the responsive model cannot represent.
     */
    replicas?: { discovered: number; folded: number; unresolved: number; unsupported: number };
    /** Component graph counts. */
    components?: { definitions: number; instances: number; fromMasters: number; fromCode: number; synthesized: number };
    /** Validation result summary. */
    validation?: { valid: boolean; warnings: number; errors: number };
}

/**
 * The default path used to write the manifest inside a generated project.
 * Lives at the project root so it is visible to CI even before `npm install`.
 */
export const EXPORT_MANIFEST_PATH = '.export-manifest.json';

/** Compute the manifest content as a stable JSON string (sorted keys, deterministic). */
export function renderExportManifest(input: ExportManifestInput): string {
    const payload: Record<string, unknown> = {
        compilerVersion: input.compilerVersion ?? '0.1.0',
        exportedAt:
            input.exportedAt ?? (input.derivationHash ? `derivation:${input.derivationHash}` : 'derivation:none'),
        projectName: sanitize(input.projectName, 'framer-export'),
        source: { name: input.sourceName ?? null },
        nodes: { discovered: input.coverage?.discovered ?? 0, preserved: input.coverage?.preserved ?? 0 },
        components: input.components ?? { definitions: 0, instances: 0, fromMasters: 0, fromCode: 0, synthesized: 0 },
        assets: input.assets ?? { discovered: 0, unique: 0 },
        fonts: input.fonts ?? 0,
        replicas: input.replicas ?? { discovered: 0, folded: 0, unresolved: 0, unsupported: 0 },
        animations: { reproduced: input.coverage?.emitted ?? 0 },
        coverage: input.coverage
            ? {
                  registered: input.coverage.registered,
                  discovered: input.coverage.discovered,
                  preserved: input.coverage.preserved,
                  emitted: input.coverage.emitted,
                  unsupported: input.coverage.unsupported,
                  lost: input.coverage.lost,
                  properties: stableCoverageArray(input.coverage.properties),
              }
            : undefined,
        validation: input.validation ?? { valid: true, warnings: 0, errors: 0 },
    };
    return JSON.stringify(payload, null, 2) + '\n';
}

/** Produce a VirtualFile for the export manifest. */
export function generateExportManifest(input: ExportManifestInput): VirtualFile {
    return {
        path: EXPORT_MANIFEST_PATH,
        content: renderExportManifest(input),
    };
}

/** Stable iteration order for the coverage property entries. */
function stableCoverageArray(
    properties:
        ReadonlyArray<{ id: string; sdkAttribute: string; stage: string; discoveredCount?: number }> | undefined,
): Array<Record<string, unknown>> {
    if (!Array.isArray(properties)) return [];
    return [...properties]
        .sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')))
        .map((entry) => {
            const result: Record<string, unknown> = {};
            result.id = entry.id;
            result.sdkAttribute = entry.sdkAttribute;
            result.stage = entry.stage;
            if (entry.discoveredCount !== undefined) result.discoveredCount = entry.discoveredCount;
            return result;
        });
}

/** Trim and bound a single string value. */
function sanitize(value: string, fallback: string): string {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    return trimmed.slice(0, 120);
}
