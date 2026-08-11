/**
 * @framer/compiler — Export validation.
 *
 * The exporter must NEVER knowingly ship broken code. Before the ZIP is
 * produced, every generated project is validated:
 *
 *   Generate files
 *        ↓
 *   Syntax parse (TS/JSX/CSS/JSON/… via the formatter's parsers)
 *        ↓
 *   Duplicate output paths
 *        ↓
 *   Duplicate imports per file
 *        ↓
 *   Missing relative import targets
 *        ↓
 *   Asset reference resolution (every referenced file exists)
 *        ↓
 *   package.json validity
 *        ↓
 *   Structured report (errors, warnings, statistics)
 */

import type { DesignDocument, DesignNode } from '@framer/compiler-ast';
import { validateFilesSyntax } from '@framer/compiler-formatter';
import type { VirtualFile } from '@framer/compiler-generators';

/** A validation error — the export MUST NOT proceed when any exist. */
export interface ValidationError {
    /** The pipeline stage that produced the issue. */
    stage: string;
    /** The project file path (when applicable). */
    path?: string;
    /** The source node id (when applicable). */
    nodeId?: string;
    /** A human-readable description. */
    message: string;
}

/** A validation warning — the export proceeds, but fidelity is reduced. */
export interface ValidationWarning {
    stage: string;
    path?: string;
    nodeId?: string;
    message: string;
}

/** The structured validation report. */
export interface ExportValidationResult {
    /** Whether the project is safe to export (no errors). */
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    statistics: {
        components: number;
        nodes: number;
        assets: number;
        files: number;
    };
}

/** The options for validation. */
export interface ValidateOptions {
    /** The design document that produced the files (for statistics). */
    document?: DesignDocument;
}

/**
 * Explain why an asset file is unreferenced, when the source explains it.
 *
 * The most common legitimate case: the asset is passed as a prop to a CODE
 * component (arbitrary source that cannot be rewritten to import the file).
 * The asset is still preserved in the ZIP. When no explanation exists, the
 * orphan is a real fidelity gap and the plain warning stands.
 */
function orphanCause(assetPath: string, document: DesignDocument | undefined): string {
    if (!document) return '';
    const fileName = assetPath.slice(assetPath.lastIndexOf('/') + 1);
    const codeComponentProps: string[] = [];

    const visit = (node: DesignNode): void => {
        if (node.type === 'component') {
            const component = node;
            if (component.metadata?.custom?.code) {
                for (const value of Object.values(component.props ?? {})) {
                    if (typeof value === 'string' && value.includes(fileName)) {
                        const name = component.componentName ?? component.name;
                        if (!codeComponentProps.includes(name)) codeComponentProps.push(name);
                    }
                }
            }
            if (component.slots) {
                for (const slotNodes of Object.values(component.slots)) {
                    for (const slotNode of slotNodes) visit(slotNode);
                }
            }
            if (component.template) visit(component.template);
        }
        for (const child of node.children) visit(child);
    };
    for (const root of document.nodes) visit(root);

    if (codeComponentProps.length > 0) {
        return ` — referenced only by a code component (${codeComponentProps.join(', ')}), whose arbitrary source cannot be rewritten; the file is preserved in the ZIP`;
    }
    return '';
}

/** The project file paths, keyed for resolution. */
function pathSet(files: VirtualFile[]): Set<string> {
    return new Set(files.map((file) => file.path));
}

/** Resolve a relative import specifier to a concrete project path. */
function resolveRelativeImport(fromPath: string, specifier: string, existing: Set<string>): string | undefined {
    if (!specifier.startsWith('.')) return undefined;
    const fromDir = fromPath.slice(0, fromPath.lastIndexOf('/') + 1);
    const base = normalizePath(`${fromDir}${specifier}`);
    const candidates = [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, `${base}/index.tsx`, `${base}/index.ts`];
    for (const candidate of candidates) {
        if (existing.has(candidate)) return candidate;
    }
    return undefined;
}

/** Normalize a project path (resolve `.` and `..` segments without touching the fs). */
function normalizePath(path: string): string {
    const segments = path.split('/');
    const stack: string[] = [];
    for (const segment of segments) {
        if (segment === '' || segment === '.') continue;
        if (segment === '..') {
            stack.pop();
            continue;
        }
        stack.push(segment);
    }
    return stack.join('/');
}

/** Match a single import declaration line (`import … from '…';` / `import '…';`). */
const IMPORT_RE = /^import\s+(?:type\s+)?(?:\{([^}]*)\}|\*\s+as\s+\w+|\w+)\s*(?:,\s*\{([^}]*)\})?\s+from\s+['"]([^'"]+)['"];?$/;
const SIDE_EFFECT_IMPORT_RE = /^import\s+['"]([^'"]+)['"];?$/;

/** Extract import specifiers from a single code line. */
function importSpecifiers(line: string): { module: string; names: string[]; sideEffectOnly?: boolean } | undefined {
    const sideEffect = SIDE_EFFECT_IMPORT_RE.exec(line);
    if (sideEffect) return { module: sideEffect[1], names: [], sideEffectOnly: true };

    const match = IMPORT_RE.exec(line);
    if (!match) return undefined;
    const [, first, second] = match;
    const names = [first ?? '', second ?? '']
        .join(',')
        .split(',')
        .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
    return { module: match[3], names };
}

/** Collect per-file import facts (module specifiers + imported names). */
function collectImports(content: string): Array<{ module: string; names: string[] }> {
    const imports: Array<{ module: string; names: string[] }> = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('import ')) continue;
        const parsed = importSpecifiers(trimmed);
        if (parsed) imports.push({ module: parsed.module, names: parsed.names });
    }
    return imports;
}

/** Collect every `assets/…` / `public/…` path referenced inside code files. */
function collectAssetReferences(content: string): string[] {
    const refs: string[] = [];
    // Imports: from '../assets/images/hero.png' / '../../public/fonts/x.woff2'
    const importRe = /from\s+['"]((?:\.\.?\/)+(?:src\/)?(?:assets|public)\/[^'"]+)['"]/g;
    // url() references inside inline styles.
    const urlRe = /url\(\s*['"]((?:\.\.?\/)+(?:src\/)?(?:assets|public)\/[^'"]+)['"]\s*\)/g;
    // Direct src attributes pointing into the project.
    const srcRe = /src=["']((?:\.\.?\/)+(?:src\/)?(?:assets|public)\/[^'"]+)["']/g;
    for (const re of [importRe, urlRe, srcRe]) {
        let match: RegExpExecArray | null;
        while ((match = re.exec(content)) !== null) {
            refs.push(match[1]);
        }
    }
    return refs;
}

/** Collect remote (http/https/data/blob) URL references inside code files. */
function collectRemoteReferences(content: string): string[] {
    const refs: string[] = [];
    const re = /(?:src|href)=["']((?:https?:|data:|blob:)\/\/[^'"]+)["']|url\(\s*['"]((?:https?:|data:|blob:)\/\/[^'"]+)['"]\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
        const ref = match[1] ?? match[2];
        if (ref) refs.push(ref);
    }
    return refs;
}

/** Whether a string looks like a remote (non-local) URL. */
const REMOTE_URL_RE = /^(https?:|data:|blob:)/i;

/**
 * Validate a generated project before it is zipped.
 *
 * Returns a structured report. `valid` is false when any error exists; the
 * compiler refuses to produce a ZIP for invalid projects.
 */
export async function validateExport(files: VirtualFile[], options: ValidateOptions = {}): Promise<ExportValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const existing = pathSet(files);

    // ── Duplicate output paths ─────────────────────────────────────────────
    const pathCounts = new Map<string, number>();
    for (const file of files) {
        pathCounts.set(file.path, (pathCounts.get(file.path) ?? 0) + 1);
    }
    for (const [path, count] of pathCounts) {
        if (count > 1) {
            errors.push({ stage: 'assembly', path, message: `Duplicate output file: ${path} is generated ${count} times.` });
        }
    }

    // ── Syntax + imports + asset references per text file ──────────────────
    const syntaxByPath = await validateFilesSyntax(files);
    for (const [path, issues] of syntaxByPath) {
        for (const issue of issues) {
            errors.push({ stage: 'codegen', path, message: `Syntax error in ${path} (${issue.parser}): ${issue.message.split('\n')[0]}` });
        }
    }

    for (const file of files) {
        if (file.binary || file.data) continue;

        // Duplicate imports within a single file.
        const seen = new Map<string, Set<string>>();
        const duplicateImports: string[] = [];
        for (const { module, names } of collectImports(file.content)) {
            const existingNames = seen.get(module) ?? new Set<string>();
            for (const name of names) {
                if (existingNames.has(name) && name) duplicateImports.push(`${name} from '${module}'`);
                existingNames.add(name);
            }
            seen.set(module, existingNames);
        }
        if (duplicateImports.length > 0) {
            errors.push({ stage: 'codegen', path: file.path, message: `Duplicate import${duplicateImports.length > 1 ? 's' : ''}: ${duplicateImports.join(', ')}.` });
        }

        // Relative imports must resolve to a real project file.
        for (const { module, names } of collectImports(file.content)) {
            if (!module.startsWith('.')) continue;
            const resolved = resolveRelativeImport(file.path, module, existing);
            if (!resolved && names.length > 0) {
                errors.push({ stage: 'codegen', path: file.path, message: `Import '${module}' from ${file.path} does not resolve to any generated file.` });
            }
        }

        // Asset references must point at files that exist in the project.
        for (const ref of collectAssetReferences(file.content)) {
            const resolved = normalizePath(`${file.path.slice(0, file.path.lastIndexOf('/') + 1)}${ref}`);
            if (!existing.has(resolved)) {
                errors.push({ stage: 'assets', path: file.path, message: `Asset reference '${ref}' (→ ${resolved}) does not exist in the exported project.` });
            }
        }

        // Remote URL references are reported (the project is not self-contained).
        const remoteImports = collectImports(file.content).filter(({ module }) => REMOTE_URL_RE.test(module));
        for (const { module } of remoteImports) {
            warnings.push({ stage: 'assets', path: file.path, message: `Remote reference '${module}' — the export depends on an external URL.` });
        }
        for (const ref of collectRemoteReferences(file.content)) {
            if (ref.startsWith('data:')) continue;
            warnings.push({ stage: 'assets', path: file.path, message: `Remote reference '${ref}' — the export depends on an external URL; local bytes were not available from the Framer Plugin API.` });
        }
    }

    // ── Every responsive class used in code must exist in responsive.css ────
    const responsiveCss = files.find((file) => file.path === 'src/styles/responsive.css');
    const responsiveSelectors = new Set<string>();
    if (responsiveCss) {
        const selectorRe = /\.(fx-rsp-[a-z0-9]+)/g;
        let match: RegExpExecArray | null;
        while ((match = selectorRe.exec(responsiveCss.content)) !== null) {
            responsiveSelectors.add(match[1]);
        }
    }
    const usedResponsiveClasses = new Set<string>();
    for (const file of files) {
        if (file.binary || file.data || !file.path.endsWith('.tsx')) continue;
        const classRe = /fx-rsp-[a-z0-9]+/g;
        let match: RegExpExecArray | null;
        while ((match = classRe.exec(file.content)) !== null) {
            usedResponsiveClasses.add(match[0]);
        }
    }
    if (usedResponsiveClasses.size > 0 && !responsiveCss) {
        errors.push({ stage: 'responsive', message: `${usedResponsiveClasses.size} responsive class(es) referenced but src/styles/responsive.css was not generated.` });
    }
    for (const className of usedResponsiveClasses) {
        if (!responsiveSelectors.has(className)) {
            errors.push({ stage: 'responsive', path: 'src/styles/responsive.css', message: `Responsive class '${className}' is used in generated code but has no rule in responsive.css.` });
        }
    }

    // ── package.json must be valid JSON ────────────────────────────────────
    const packageFile = files.find((file) => file.path === 'package.json');
    if (packageFile) {
        try {
            const parsed = JSON.parse(packageFile.content) as Record<string, unknown>;
            if (typeof parsed.name !== 'string') {
                errors.push({ stage: 'assembly', path: 'package.json', message: 'package.json is missing a name field.' });
            }
        } catch (error) {
            errors.push({ stage: 'assembly', path: 'package.json', message: `package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}` });
        }
    } else {
        errors.push({ stage: 'assembly', message: 'The project is missing package.json.' });
    }

    // ── Orphaned asset files (written but never referenced) ────────────────
    const codeContents = files
        .filter((file) => !file.binary && !file.data && !file.path.endsWith('.placeholder.txt'))
        .map((file) => ({ path: file.path, content: file.content }));
    const referencedAssets = new Set<string>();
    for (const { path, content } of codeContents) {
        for (const ref of collectAssetReferences(content)) {
            const resolved = normalizePath(`${path.slice(0, path.lastIndexOf('/') + 1)}${ref}`);
            referencedAssets.add(resolved);
        }
        // Imported asset modules are also references.
        for (const { module } of collectImports(content)) {
            if (module.startsWith('.')) {
                const resolved = resolveRelativeImport(path, module, existing);
                if (resolved && (resolved.startsWith('src/assets/') || resolved.startsWith('public/'))) {
                    referencedAssets.add(resolved);
                }
            }
        }
    }
    for (const file of files) {
        const isAsset = file.path.startsWith('src/assets/') || file.path.startsWith('public/');
        // Placeholder notes are intentionally informational — skip them.
        const isPlaceholder = file.path.endsWith('.placeholder.txt');
        if (isAsset && !isPlaceholder && !referencedAssets.has(file.path)) {
            // Triage: an asset that only appears as a CODE component prop is
            // expected to be unreferenced — the component's arbitrary source
            // cannot be rewritten to import it, but the file is preserved in
            // the ZIP for the component's runtime use. Real canvas assets
            // should always be referenced; an orphan there is a fidelity gap.
            const cause = orphanCause(file.path, options.document);
            warnings.push({
                stage: 'assets',
                path: file.path,
                message: `Asset file ${file.path} is written but never referenced by generated code${cause}.`,
            });
        }
    }

    // ── Statistics ─────────────────────────────────────────────────────────
    const document = options.document;
    const nodes = document ? countNodes(document.nodes) : 0;
    const components = document ? countComponents(document.nodes) : files.filter((file) => file.path.startsWith('src/components/')).length;

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        statistics: {
            components,
            nodes,
            assets: document?.assets.length ?? 0,
            files: files.length,
        },
    };
}

/** Count every node in a document tree. */
function countNodes(nodes: DesignNode[]): number {
    let count = 0;
    const visit = (node: DesignNode): void => {
        count += 1;
        for (const child of node.children) visit(child);
        if (node.type === 'component' && node.template) visit(node.template);
        if (node.type === 'component' && node.slots) {
            for (const slotNodes of Object.values(node.slots)) {
                for (const slotNode of slotNodes) visit(slotNode);
            }
        }
    };
    for (const node of nodes) visit(node);
    return count;
}

/** Count every component instance node in a document tree. */
function countComponents(nodes: DesignNode[]): number {
    let count = 0;
    const visit = (node: DesignNode): void => {
        if (node.type === 'component') count += 1;
        for (const child of node.children) visit(child);
        if (node.type === 'component' && node.template) visit(node.template);
        if (node.type === 'component' && node.slots) {
            for (const slotNodes of Object.values(node.slots)) {
                for (const slotNode of slotNodes) visit(slotNode);
            }
        }
    };
    for (const node of nodes) visit(node);
    return count;
}
