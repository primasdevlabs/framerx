/**
 * @framer/compiler — The compiler engine.
 *
 * Orchestrates the full pipeline:
 *
 *   Design AST → optimize → generate → format → zip
 *
 * The engine is platform-agnostic: it operates purely on the shared Design AST,
 * so it can be reused by any design platform parser (Framer, Figma, Penpot…)
 * without modification. A convenience wrapper compiles Framer documents
 * end-to-end via the parser package.
 */

import type { DesignDocument, DesignNode } from '@framer/compiler-ast';
import { buildAssets, generateExportManifest, generateProject, type GeneratedProject, type VirtualFile } from '@framer/compiler-generators';
import { formatFile } from '@framer/compiler-formatter';
import { parseFramerDocument, type FramerDocument } from '@framer/compiler-parser';
import { DEFAULT_PROJECT_NAME, sha256HexOfString } from '@framer/compiler-shared';
import { createZip } from '@framer/compiler-zip';

import { collectCoverage, renderCoverageText, type CoverageReport } from './coverage';
import { computeDiagnostics, type ExportDiagnostics } from './diagnostics';
import { extractComponents, type ExtractOptions } from './extractor';
import { optimizeDocument } from './optimizer';
import { separateComponents } from './separator';
import { validateExport, type ExportValidationResult, type ValidationError, type ValidationWarning } from './validate';

export * from './coverage';
export * from './diagnostics';
export * from './extractor';
export * from './optimizer';
export * from './separator';
export * from './validate';

const COMPILER_VERSION = '0.1.0';
const EXPORT_MANIFEST_PATH = '.export-manifest.json';

/** The compiler options. */
export interface CompileOptions {
    /** The project name. Defaults to the document name. */
    projectName?: string;
    /** Whether to generate Motion animations. Defaults to true. */
    animations?: boolean;
    /** Whether to run the optimization stage. Defaults to true. */
    optimize?: boolean;
    /**
     * Whether to extract repeated subtrees into reusable components.
     * Defaults to true. Pass an object to tune the extraction thresholds.
     */
    extractComponents?: boolean | ExtractOptions;
    /** Whether to format files with Prettier. Defaults to true. */
    format?: boolean;
    /** Whether to produce a ZIP archive. Defaults to true. */
    zip?: boolean;
    /**
     * The optional Framer source document. When provided, the compiler
     * computes end-to-end Source Property Coverage (Framer SDK → AST →
     * generated code) and reports it in the diagnostics + the export
     * manifest. When omitted, coverage is computed against the AST only.
     */
    source?: FramerDocument;
}

/** The result of a compilation. */
export interface CompileResult {
    /** The sanitized project name. */
    name: string;
    /** The generated (and formatted) project files. */
    files: VirtualFile[];
    /** The ZIP archive of the project, if enabled. */
    zip?: Uint8Array;
    /** The design nodes that were compiled. */
    nodes: DesignNode[];
    /** The full generated project. */
    project: GeneratedProject;
    /** The export diagnostics (counts + validation report). */
    diagnostics: ExportDiagnostics;
}

/**
 * Thrown when validation finds errors in the generated project. The export
 * must not proceed — the plugin surfaces the structured report to the user.
 */
export class ExportValidationError extends Error {
    /** The full validation report. */
    readonly validation: ExportValidationResult;

    constructor(validation: ExportValidationResult) {
        const detail = validation.errors
            .slice(0, 5)
            .map((error) => `${error.stage}${error.path ? ` (${error.path})` : ''}: ${error.message}`)
            .join('\n');
        super(`Export failed — ${validation.errors.length} validation error${validation.errors.length === 1 ? '' : 's'}.\n${detail}`);
        this.name = 'ExportValidationError';
        this.validation = validation;
    }
}

/** Compile a Design AST into a production-ready project. */
export async function compile(document: DesignDocument, options: CompileOptions = {}): Promise<CompileResult> {
    const runOptimizer = options.optimize !== false;
    const runFormatter = options.format !== false;
    const runZip = options.zip !== false;

    // Stage 3 — Optimize
    const ast = runOptimizer ? optimizeDocument(document, { extractComponents: options.extractComponents }) : document;

    // Stage 4 — Generate
    const project = generateProject(ast, {
        projectName: options.projectName ?? document.name ?? DEFAULT_PROJECT_NAME,
        animations: options.animations ?? true,
    });

    // Stage 5 — Format
    const files: VirtualFile[] = runFormatter
        ? await Promise.all(project.files.map((file) => formatFile(file)))
        : project.files;

    // Stage 6 — Validate (mandatory: never knowingly ship broken code).
    const validation = await validateExport(files, { document: ast });
    // Semantic warnings raised during generation (slot placements etc.) join
    // the validation report so nothing is reported only to be lost.
    if (project.warnings && project.warnings.length > 0) {
        validation.warnings = [...project.warnings, ...validation.warnings];
    }
    // Extraction root causes (why masters / code files were unavailable) join
    // the report so a wall of identical "synthesized" warnings is explained.
    const extraction = extractionWarnings(options.source);
    if (extraction.length > 0) {
        validation.warnings = [...extraction, ...validation.warnings];
    }
    if (!validation.valid) {
        throw new ExportValidationError(validation);
    }

    const componentSummary = summarizeComponents(ast, project.files);

    // Build the manifest first so its content can be included in the
    // coverage needle scan — the manifest is part of the emitted artifact,
    // so a property whose only emission is the manifest counter
    // (e.g. `component.master` → fromMasters) must be detectable as
    // `emitted`. We bootstrap with a pre-manifest coverage scan so the
    // manifest sees its own coverage numbers, then re-scan with the
    // manifest in place for the diagnostics that get returned.
    const derivationHash = computeDerivationHash(ast, options.source);
    const projectName = options.projectName ?? document.name ?? DEFAULT_PROJECT_NAME;
    const sourceName = options.source?.name ?? document.name;
    const preliminaryCoverage: CoverageReport = collectCoverage({
        source: options.source ?? unknownFramerSource(ast),
        ast,
        files,
    });
    const preliminaryManifestFile: VirtualFile = generateExportManifest({
        compilerVersion: COMPILER_VERSION,
        projectName,
        sourceName,
        derivationHash,
        coverage: {
            registered: preliminaryCoverage.summary.registered,
            discovered: preliminaryCoverage.summary.discovered,
            preserved: preliminaryCoverage.summary.preserved,
            emitted: preliminaryCoverage.summary.emitted,
            unsupported: preliminaryCoverage.summary.unsupported,
            lost: preliminaryCoverage.summary.lost,
            properties: preliminaryCoverage.properties.map((entry) => ({
                id: entry.id,
                sdkAttribute: entry.sdkAttribute,
                stage: entry.stage,
                discoveredCount: entry.discoveredCount,
            })),
        },
        assets: { discovered: buildAssets(ast).discoveredCount, unique: buildAssets(ast).uniqueCount },
        fonts: ast.fonts.length,
        components: componentSummary,
        validation: { valid: validation.valid, warnings: validation.warnings.length, errors: validation.errors.length },
    });
    const filesWithManifest: VirtualFile[] = [...files, preliminaryManifestFile];

    // Stage 6b — Re-scan coverage with the manifest now part of the file
    // list. This is the report that gets returned in the diagnostics and
    // printed by the demo script. A property whose needle only matches
    // manifest content (e.g. `fromMasters`) correctly flips to `emitted`.
    const coverage: CoverageReport = collectCoverage({
        source: options.source ?? unknownFramerSource(ast),
        ast,
        files: filesWithManifest,
    });

    // Stage 6c — Emit the FINAL .export-manifest.json so its coverage
    // summary reflects the post-manifest scan (single source of truth).
    const manifestFile: VirtualFile = generateExportManifest({
        compilerVersion: COMPILER_VERSION,
        projectName,
        sourceName,
        derivationHash,
        coverage: {
            registered: coverage.summary.registered,
            discovered: coverage.summary.discovered,
            preserved: coverage.summary.preserved,
            emitted: coverage.summary.emitted,
            unsupported: coverage.summary.unsupported,
            lost: coverage.summary.lost,
            properties: coverage.properties.map((entry) => ({
                id: entry.id,
                sdkAttribute: entry.sdkAttribute,
                stage: entry.stage,
                discoveredCount: entry.discoveredCount,
            })),
        },
        assets: { discovered: buildAssets(ast).discoveredCount, unique: buildAssets(ast).uniqueCount },
        fonts: ast.fonts.length,
        components: componentSummary,
        validation: { valid: validation.valid, warnings: validation.warnings.length, errors: validation.errors.length },
    });
    const finalFiles: VirtualFile[] = [...files, manifestFile];

    // Stage 7 — Zip (with the manifest included so it ships with the export).
    const zip = runZip ? await createZip(finalFiles) : undefined;

    return {
        name: project.name,
        files: finalFiles,
        zip,
        nodes: project.nodes,
        project: { ...project, files: finalFiles },
        diagnostics: computeDiagnostics({
            document: ast,
            filesCount: finalFiles.length,
            componentFiles: files.filter((file) => file.path.startsWith('src/components/')).length,
            assetsDiscovered: buildAssets(ast).discoveredCount,
            uniqueAssets: buildAssets(ast).uniqueCount,
            validation,
            coverage,
        }),
    };
}

/** Build a synthetic Framer-source stub from an AST so coverage analysis can run when no Framer document was provided. */
function unknownFramerSource(ast: DesignDocument): FramerDocument {
    return { id: ast.metadata?.sourceId ?? 'ast-only', name: ast.name, nodes: [], version: '0.0.0' };
}

/** An instance that matched neither a master nor a code file during extraction. */
interface UnmatchedInstanceRecord {
    id: string;
    name: string;
    componentIdentifier?: string | null;
    insertURL?: string | null;
    componentName?: string | null;
}

/** The extraction status carried on `FramerDocument.metadata.extraction`. */
interface ExtractionMetadata {
    masters?: { status: string; count?: number; reason?: string };
    codeFiles?: { status: string; count?: number; reason?: string };
    modules?: { status: string; count?: number; failed?: number; reason?: string };
    fonts?: { status: string; count?: number; failed?: number; reason?: string };
    unmatchedInstances?: UnmatchedInstanceRecord[];
}

/**
 * Root-cause warnings when source-model enrichment degraded during
 * extraction. The plugin records WHY masters/code files were unavailable;
 * this turns that record into user-facing warnings so a wall of identical
 * "synthesized" component warnings is explained at the source.
 */
function extractionWarnings(source: FramerDocument | undefined): Array<{ stage: string; message: string }> {
    if (!source) return [];
    const metadata = source.metadata as { extraction?: ExtractionMetadata } | undefined;
    const extraction = metadata?.extraction;
    if (!extraction) return [];

    const warnings: Array<{ stage: string; message: string }> = [];
    const masters = extraction.masters;
    if (masters && masters.status !== 'ok') {
        warnings.push({
            stage: 'extraction',
            message: `Component masters could not be fetched (${masters.status}${masters.reason ? `: ${masters.reason}` : ''}) — component bodies will be synthesized from instance data (approximate).`,
        });
    }
    const codeFiles = extraction.codeFiles;
    // A document whose code components are all SHARED MODULES legitimately has
    // zero local code files — getCodeFiles resolving empty is the expected
    // state, not a failure. When the module fetcher recovered those components
    // (modules.status === 'ok'), the empty-codeFiles warning is stale and is
    // suppressed; degraded module extraction (partial) still warns below.
    const modulesRecovered = extraction.modules?.status === 'ok' && (extraction.modules.count ?? 0) > 0;
    if (codeFiles && codeFiles.status !== 'ok' && !(codeFiles.status === 'empty' && modulesRecovered)) {
        warnings.push({
            stage: 'extraction',
            message: `Code files could not be fetched (${codeFiles.status}${codeFiles.reason ? `: ${codeFiles.reason}` : ''}) — code components will be synthesized from instance data (approximate).`,
        });
    }
    // Shared-module bundles that failed to fetch: those instances WILL be
    // synthesized, and the report names the exact bundle URLs that could not
    // be read.
    // Project fonts could not be collected from the SDK: fonts are then
    // exported as metadata only (no @font-face files). Per-font no-download
    // cases (url: null) are NOT summarized here — the FontRegistry warns for
    // each of them individually; this fires only when the API itself is
    // missing, errored, or returned nothing.
    const fonts = extraction.fonts;
    if (fonts && fonts.status !== 'ok' && fonts.status !== 'partial') {
        warnings.push({
            stage: 'extraction',
            message: `Project fonts could not be collected from the SDK (${fonts.status}${fonts.reason ? `: ${fonts.reason}` : ''}) — fonts are exported as metadata only (no @font-face files).`,
        });
    }
    const modules = extraction.modules;
    if (modules && modules.status !== 'ok' && modules.status !== 'unavailable') {
        warnings.push({
            stage: 'extraction',
            message: `Shared module components could not be fully fetched (${modules.status}: ${modules.reason ?? 'unknown'}) — ${modules.failed ?? 0} component bundle(s) will be synthesized from instance data (approximate).`,
        });
    }
    // Instances that matched NEITHER enrichment, with the exact keys they
    // carried. This is the difference between "the API is down" and "the
    // instance carries identifiers nothing matches" — the actionable datum.
    const unmatched = extraction.unmatchedInstances ?? [];
    if (unmatched.length > 0) {
        const unique = Array.from(new Map(unmatched.map((instance) => [instance.id, instance])).values());
        const sample = unique.slice(0, 8).map((instance) => {
            const keys = [
                instance.componentIdentifier ? `componentIdentifier: ${instance.componentIdentifier}` : null,
                instance.insertURL ? `insertURL: ${instance.insertURL}` : null,
                instance.componentName ? `componentName: ${instance.componentName}` : null,
            ].filter(Boolean);
            return `${instance.name} [${keys.join(', ') || 'no identifying keys'}]`;
        });
        const rest = unique.length > sample.length ? ` (${unique.length - sample.length} more)` : '';
        warnings.push({
            stage: 'extraction',
            message: `${unique.length} component instance(s) matched neither a component master nor a code file — ${sample.join('; ')}${rest}. These will be synthesized from instance data (approximate); check the identifiers the source exposed.`,
        });
    }
    return warnings;
}

/**
 * Compute a deterministic, content-derived id for a compilation run.
 *
 * Used as the manifest's derivation marker so identical inputs produce
 * byte-identical output across CI runs (the live `Date` is intentionally
 * NOT allowed into the manifest).
 */
function computeDerivationHash(ast: DesignDocument, source?: FramerDocument): string {
    const sourceString = source
        ? `${source.id}|${source.name}|${source.version ?? ''}|${JSON.stringify((source.nodes ?? []).map(nodeDigest))}`
        : `${ast.version}|${ast.name}|${JSON.stringify(ast.nodes.map(nodeDigest))}`;
    return sha256HexOfString(sourceString).slice(0, 16);
}

/** Deterministic digest of a single node for the compilation hash. */
function nodeDigest(node: DesignNode | { id?: string; type?: string; name?: string; frame?: unknown; children?: unknown[] }): Record<string, unknown> {
    return {
        id: node.id,
        type: node.type,
        name: node.name,
        children: Array.isArray(node.children) ? node.children.length : 0,
    };
}

/** Summarize component definitions + instances for the manifest. */
function summarizeComponents(ast: DesignDocument, files: VirtualFile[]): {
    definitions: number;
    instances: number;
    fromMasters: number;
    fromCode: number;
    synthesized: number;
} {
    const definitions = ast.components?.length ?? 0;
    let fromMasters = 0;
    let fromCode = 0;
    let synthesized = 0;
    for (const definition of ast.components ?? []) {
        if (definition.bodySource === 'master') fromMasters += 1;
        else if (definition.bodySource === 'code') fromCode += 1;
        else if (definition.bodySource === 'synthesized') synthesized += 1;
    }
    let instances = 0;
    const visit = (node: DesignNode): void => {
        if (node.type === 'component') instances += 1;
        for (const child of node.children) visit(child);
        if (node.type === 'component' && node.template) visit(node.template);
        if (node.type === 'component' && node.slots) {
            for (const slotNodes of Object.values(node.slots)) {
                for (const slotNode of slotNodes) visit(slotNode);
            }
        }
    };
    for (const root of ast.nodes) visit(root);
    // `files` is here so a future enhancement can cross-check vs emitted
    // component file count (definitions ↔ generated files); unused today.
    void files;
    return { definitions, instances, fromMasters, fromCode, synthesized };
}

/** Re-export validation types for convenience. */
export type { ValidationError, ValidationWarning };

/**
 * Compile a Design AST without running the validator (used by golden tests
 * that deliberately exercise broken documents).
 */
export async function compileWithoutValidation(document: DesignDocument, options: CompileOptions = {}): Promise<Omit<CompileResult, 'diagnostics'> & { validation: ExportValidationResult }> {
    const runOptimizer = options.optimize !== false;
    const runFormatter = options.format !== false;

    const ast = runOptimizer ? optimizeDocument(document, { extractComponents: options.extractComponents }) : document;
    const project = generateProject(ast, {
        projectName: options.projectName ?? document.name ?? DEFAULT_PROJECT_NAME,
        animations: options.animations ?? true,
    });
    const files: VirtualFile[] = runFormatter
        ? await Promise.all(project.files.map((file) => formatFile(file)))
        : project.files;
    const validation = await validateExport(files, { document: ast });
    if (project.warnings && project.warnings.length > 0) {
        validation.warnings = [...project.warnings, ...validation.warnings];
    }

    // Mirror `compile()`: emit .export-manifest.json with the same shape
    // so consumers can rely on the file appearing in unvalidated runs too.
    const componentSummary = summarizeComponents(ast, files);
    const derivationHash = computeDerivationHash(ast, options.source);
    const projectName = options.projectName ?? document.name ?? DEFAULT_PROJECT_NAME;
    const sourceName = options.source?.name ?? document.name;
    // Two-pass: bootstrap coverage, build a manifest, re-scan coverage with
    // the manifest in place so its content can satisfy emission-needles
    // (e.g. `fromMasters`), then emit the final manifest. Same logic as
    // `compile()` so the two paths always agree.
    const preliminaryCoverage: CoverageReport = collectCoverage({ source: options.source ?? unknownFramerSource(ast), ast, files });
    const preliminaryManifestFile: VirtualFile = generateExportManifest({
        compilerVersion: COMPILER_VERSION,
        projectName,
        sourceName,
        derivationHash,
        coverage: {
            registered: preliminaryCoverage.summary.registered,
            discovered: preliminaryCoverage.summary.discovered,
            preserved: preliminaryCoverage.summary.preserved,
            emitted: preliminaryCoverage.summary.emitted,
            unsupported: preliminaryCoverage.summary.unsupported,
            lost: preliminaryCoverage.summary.lost,
            properties: preliminaryCoverage.properties.map((entry) => ({
                id: entry.id,
                sdkAttribute: entry.sdkAttribute,
                stage: entry.stage,
                discoveredCount: entry.discoveredCount,
            })),
        },
        assets: { discovered: buildAssets(ast).discoveredCount, unique: buildAssets(ast).uniqueCount },
        fonts: ast.fonts.length,
        components: componentSummary,
        validation: { valid: validation.valid, warnings: validation.warnings.length, errors: validation.errors.length },
    });
    const filesWithPreliminaryManifest: VirtualFile[] = [...files, preliminaryManifestFile];
    const coverage: CoverageReport = collectCoverage({ source: options.source ?? unknownFramerSource(ast), ast, files: filesWithPreliminaryManifest });
    const manifestFile = generateExportManifest({
        compilerVersion: COMPILER_VERSION,
        projectName,
        sourceName,
        derivationHash,
        coverage: {
            registered: coverage.summary.registered,
            discovered: coverage.summary.discovered,
            preserved: coverage.summary.preserved,
            emitted: coverage.summary.emitted,
            unsupported: coverage.summary.unsupported,
            lost: coverage.summary.lost,
            properties: coverage.properties.map((entry) => ({
                id: entry.id,
                sdkAttribute: entry.sdkAttribute,
                stage: entry.stage,
                discoveredCount: entry.discoveredCount,
            })),
        },
        assets: { discovered: buildAssets(ast).discoveredCount, unique: buildAssets(ast).uniqueCount },
        fonts: ast.fonts.length,
        components: componentSummary,
        validation: { valid: validation.valid, warnings: validation.warnings.length, errors: validation.errors.length },
    });

    return {
        name: project.name,
        files: [...files, manifestFile],
        nodes: project.nodes,
        project: { ...project, files: [...files, manifestFile] },
        validation,
    };
}

/** Compile a Framer document end-to-end (parser + compiler). */
export async function compileFramerDocument(document: FramerDocument, options: CompileOptions = {}): Promise<CompileResult> {
    return compile(parseFramerDocument(document), { ...options, source: document });
}

/**
 * Render the Source Property Coverage report as plain text (for the plugin
 * diagnostic panel and the demo script). Stable, does not depend on locale.
 */
export function formatCoverage(report: CoverageReport): string {
    return renderCoverageText(report);
}
