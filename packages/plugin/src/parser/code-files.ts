/**
 * Code-file extraction — code components have no canvas master; their
 * definition is the real source fetched through the SDK (`getCodeFiles`).
 *
 * This module owns the code-file model and the instance→file matching, so the
 * document walk (document.ts) and the node mapper (node.ts) share it without
 * a circular import.
 */

import type { ExtractionStatus, FramerApi, FramerCodeFile, FramerCodeFileExport } from './sdk';
import { withTimeout } from './sdk';

/** A component export matched to its code file. */
export interface CodeFileSource {
    /** The code file containing the component. */
    file: FramerCodeFile;
    /** The matched component export inside the file. */
    export: FramerCodeFileExport;
}

/**
 * The code-file lookup index for one extraction.
 *
 * A canvas instance of a code component carries `componentIdentifier`,
 * `insertURL`, and `componentName`; a code file export carries `componentId`,
 * `insertURL`, and `name`. The index maps every surface so the instance can
 * be matched regardless of which field the engine populates.
 */
export interface CodeFileIndex {
    /** Export componentId → code file source. */
    byComponentId: Map<string, CodeFileSource>;
    /** Export insertURL → code file source. */
    byInsertURL: Map<string, CodeFileSource>;
    /** Export name → code file source. */
    byExportName: Map<string, CodeFileSource>;
    /** Code file path (normalized) → file (for relative-import resolution). */
    byPath: Map<string, FramerCodeFile>;
}

/** A code file referenced by a matched component through a relative import. */
export interface CodeDependency {
    /** The dependency's project path (e.g. `code/Icon.tsx`). */
    path: string;
    /** The dependency's full source. */
    source: string;
}

/** Normalize a code file path (strip leading slashes, keep the project-relative form). */
export function normalizeCodePath(path: string): string {
    return path.replace(/^\/+/, '');
}

/** The outcome of the code-file fetch. */
export interface CodeFileFetchResult {
    index: CodeFileIndex;
    /** Why the fetch resolved the way it did — never silently degraded. */
    status: ExtractionStatus;
}

/**
 * Fetch every code file in the project, keyed for instance matching and
 * relative-import resolution. Fetched ONCE per extraction — soft-failing when
 * the SDK surface does not expose it (instances then fall back to the
 * synthesized body, never a broken export), and always reporting WHY so the
 * export diagnostics can explain the fallback.
 */
export async function fetchCodeFiles(api: FramerApi, callTimeout: number): Promise<CodeFileFetchResult> {
    const index: CodeFileIndex = {
        byComponentId: new Map(),
        byInsertURL: new Map(),
        byExportName: new Map(),
        byPath: new Map(),
    };
    if (typeof api.getCodeFiles !== 'function') {
        return {
            index,
            status: {
                status: 'unavailable',
                reason: 'The SDK does not expose getCodeFiles; code components cannot be read.',
            },
        };
    }
    try {
        const files = await withTimeout(api.getCodeFiles(), callTimeout, 'getCodeFiles');
        let count = 0;
        let usableFiles = 0;
        for (const file of files) {
            index.byPath.set(normalizeCodePath(file.path), file);
            let fileUsable = false;
            for (const entry of file.exports) {
                if (entry.type && entry.type !== 'component') continue;
                const source: CodeFileSource = { file, export: entry };
                if (entry.componentId) {
                    if (!index.byComponentId.has(entry.componentId)) count += 1;
                    index.byComponentId.set(entry.componentId, source);
                    fileUsable = true;
                }
                if (entry.insertURL) {
                    index.byInsertURL.set(entry.insertURL, source);
                    fileUsable = true;
                }
                if (entry.name) {
                    index.byExportName.set(entry.name, source);
                    fileUsable = true;
                }
            }
            if (fileUsable) usableFiles += 1;
        }
        // 'empty' means the fetch genuinely returned nothing matchable — a
        // file whose exports carry only an insertURL or a name still indexes
        // (matchCodeFile falls back to those keys), so it is NOT empty.
        if (usableFiles === 0) {
            return {
                index,
                status: { status: 'empty', reason: 'getCodeFiles resolved but returned no component code files.' },
            };
        }
        return { index, status: { status: 'ok', count } };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const reason = /permission|allowed|not allowed|denied/i.test(message)
            ? `getCodeFiles threw a permission error: ${message.slice(0, 120)}`
            : `getCodeFiles threw: ${message.slice(0, 120)}`;
        return {
            index,
            status: {
                status: /permission|allowed|not allowed|denied/i.test(message) ? 'denied' : 'error',
                reason,
            },
        };
    }
}

/**
 * Match a component instance to its code file export.
 *
 * Every surface is tried (componentIdentifier → insertURL → export name) so
 * the match works regardless of which field the engine populates.
 */
export function matchCodeFile(
    component: { id: string; name: string; insertURL?: string | null },
    codeFiles?: CodeFileIndex,
): CodeFileSource | undefined {
    if (!codeFiles) return undefined;
    return (
        codeFiles.byComponentId.get(component.id) ??
        (component.insertURL ? codeFiles.byInsertURL.get(component.insertURL) : undefined) ??
        codeFiles.byExportName.get(component.name)
    );
}

/**
 * Resolve the transitive closure of code files a component depends on through
 * relative imports, so every emitted module resolves inside the project.
 */
export function resolveCodeClosure(file: FramerCodeFile, index: CodeFileIndex): CodeDependency[] {
    const seen = new Set<string>([normalizeCodePath(file.path)]);
    const dependencies: CodeDependency[] = [];
    const visit = (current: FramerCodeFile): void => {
        for (const spec of extractRelativeImports(current.content)) {
            const resolved = resolveRelativeCandidates(current.path, spec).find((candidate) =>
                index.byPath.has(candidate),
            );
            const target = resolved ? index.byPath.get(resolved) : undefined;
            if (!target || seen.has(normalizeCodePath(target.path))) continue;
            seen.add(normalizeCodePath(target.path));
            dependencies.push({ path: normalizeCodePath(target.path), source: target.content });
            visit(target);
        }
    };
    visit(file);
    return dependencies;
}

/** Extract relative import specifiers from a module's source. */
function extractRelativeImports(source: string): string[] {
    const specs: string[] = [];
    const pattern = /(?:from\s+|import\s+)(['"])(\.[^'"]+)\1/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
        specs.push(match[2]);
    }
    return specs;
}

/**
 * The candidate project paths a relative import specifier can resolve to
 * (extension-tolerant: Framer imports usually omit the extension).
 */
function resolveRelativeCandidates(filePath: string, spec: string): string[] {
    const parts = normalizeCodePath(filePath).split('/');
    parts.pop(); // drop the file name → the file's directory
    for (const segment of spec.split('/')) {
        if (segment === '' || segment === '.') continue;
        if (segment === '..') {
            if (parts.length > 0) parts.pop();
        } else {
            parts.push(segment);
        }
    }
    if (parts.length === 0) return [];
    const base = parts.join('/');
    const candidates = [base, ...['.tsx', '.ts', '.jsx', '.js'].flatMap((ext) => [base + ext, `${base}/index${ext}`])];
    return candidates;
}
