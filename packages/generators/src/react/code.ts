/**
 * Code-component file generation.
 *
 * A code component's definition is its real source, fetched through the SDK
 * (`getCodeFiles`) or — for shared components — a published module bundle on
 * Framer's CDN (the instance's insertURL IS the bundle). The generator emits
 * that source verbatim as the implementation — the true component instead of
 * a synthesized approximation.
 *
 * Two adaptations:
 *   - Project code files: Framer's `addPropertyControls` machinery is
 *     stripped (a legacy API that does not exist outside the Framer runtime).
 *   - Shared module bundles: `from 'framer'` is rewritten to a local runtime
 *     shim (`./framer`) that provides the members the bundles call at runtime
 *     (`RenderTarget.current()` etc.); the shim file is emitted alongside.
 *
 * Everything else stays byte-for-byte the author's code, and the transitive
 * relative-import closure is emitted alongside so every module resolves
 * inside the generated project.
 */

import type { ComponentDefinition } from '@framer/compiler-ast';

import type { VirtualFile } from '../types';

/** The project-relative path a code file is emitted at (preserving its imports). */
export function codeFilePath(code: NonNullable<ComponentDefinition['code']>): string {
    const path = code.path.replace(/^\/+/, '');
    return `src/${path}`;
}

/**
 * Generate the virtual file for a code component's definition.
 *
 * Project code files are stripped of Framer's addPropertyControls machinery;
 * shared module bundles are adapted instead (their `framer` import rewrites
 * to the local shim — the bundles call RenderTarget etc. at runtime, so the
 * machinery must NOT be stripped).
 */
export function generateCodeFile(definition: ComponentDefinition): VirtualFile {
    const code = definition.code;
    if (!code) throw new Error(`Definition ${definition.name} has no code source`);
    return {
        path: codeFilePath(code),
        content: code.isModule ? adaptModuleSource(code.source) : stripFramerRuntime(code.source),
    };
}

/**
 * Adapt a shared-module bundle source for the generated project.
 *
 * The only change: `from 'framer'` (and side-effect `import 'framer'`) become
 * `from './framer'` — the local runtime shim emitted at `src/code/framer.js`.
 * Module files always land flat in `src/code/`, so `./framer` is correct for
 * the entry and every dependency. Everything else is left byte-for-byte.
 */
export function adaptModuleSource(source: string): string {
    return source.replace(/((?:from|import)\s*)(["'])framer\2/g, '$1"./framer"');
}

/** The project path of the Framer runtime shim for module bundles. */
export const FRAMER_SHIM_PATH = 'src/code/framer.js';

/**
 * The Framer runtime shim.
 *
 * Published module bundles import `{ addPropertyControls, ControlType,
 * RenderTarget } from 'framer'` — a module that only exists inside the Framer
 * runtime. `RenderTarget.current()` is called at runtime to decide between
 * canvas and web rendering; the shim reports `'web'` so the exported
 * component runs its real browser path. `addPropertyControls`/`ControlType`
 * are no-ops (legacy property-controls metadata, irrelevant outside Framer).
 */
export function generateFramerShim(): VirtualFile {
    return {
        path: FRAMER_SHIM_PATH,
        content: `/**
 * Runtime shim for Framer's \`framer\` module.
 *
 * Published module bundles (framerusercontent.com/modules/...) import
 * \`{ addPropertyControls, ControlType, RenderTarget } from 'framer'\` — a
 * module that only exists inside the Framer runtime. The generator rewrites
 * those imports to './framer'; this file provides browser-compatible
 * stand-ins so the exported components run outside Framer.
 */

export const RenderTarget = {
    canvas: 'canvas',
    export: 'export',
    // Never the canvas/export targets: the exported page always runs the web
    // rendering path of the component.
    current: () => 'web',
};

// Legacy property-controls API — metadata only, a no-op outside Framer.
export function addPropertyControls() {}

export const ControlType = {
    String: 'string',
    Number: 'number',
    Boolean: 'boolean',
    Enum: 'enum',
    SegmentedEnum: 'segmentedEnum',
    Color: 'color',
    File: 'file',
    Image: 'image',
    BooleanEnum: 'booleanEnum',
    Object: 'object',
};
`, // keep prettier formatting stable
    };
}

/**
 * Generate the type declaration for a shared-module entry.
 *
 * The generated project's tsconfig compiles only TS/TSX (`allowJs` is off),
 * so TypeScript cannot resolve `import Ticker from '../code/Ticker'` to the
 * emitted `Ticker.js`. A sibling `Ticker.d.ts` makes the import type-check
 * (declarations are always resolvable) while Vite still bundles the real
 * `.js` implementation.
 */
export function generateModuleDeclaration(definition: ComponentDefinition): VirtualFile | undefined {
    const code = definition.code;
    if (!code?.isModule) return undefined;
    const path = codeFilePath(code).replace(/\.js$/, '.d.ts');
    const declaration = code.isDefaultExport
        ? `declare const ${definition.name}: (props: Record<string, unknown>) => import('react').ReactElement;\nexport default ${definition.name};\n`
        : `export declare function ${definition.name}(props: Record<string, unknown>): import('react').ReactElement;\n`;
    return { path, content: declaration };
}

/**
 * Remove Framer's `addPropertyControls` machinery from a component source.
 *
 * Old-style Framer code components declare property controls with
 * `addPropertyControls(Component, {...})` imported from the `framer` runtime,
 * which does not exist in the generated project. The import and the call are
 * stripped; anything else from `framer` is left in place (the validator warns
 * about the unresolvable import so nothing is silently broken).
 */
export function stripFramerRuntime(source: string): string {
    let out = source;
    // import { addPropertyControls, ControlType, ... } from "framer"
    out = out.replace(/import\s*\{[^}]*addPropertyControls[^}]*\}\s*from\s*["']framer["']\s*;?/g, '');
    // import { ControlType, ... } from "framer" (when addPropertyControls was not listed)
    out = out.replace(/import\s*\{[^}]*ControlType[^}]*\}\s*from\s*["']framer["']\s*;?/g, '');
    // addPropertyControls(Name, {...}) calls — matched with balanced parens so
    // object literals containing strings or nested parens are fully removed.
    const pattern = /\baddPropertyControls\s*\(/g;
    let match: RegExpExecArray | null;
    const chunks: string[] = [];
    let cursor = 0;
    while ((match = pattern.exec(out)) !== null) {
        chunks.push(out.slice(cursor, match.index));
        const open = out.indexOf('(', match.index);
        const end = matchBalancedParens(out, open);
        if (end < 0) {
            chunks.push(out.slice(cursor));
            cursor = out.length;
            break;
        }
        cursor = end;
        pattern.lastIndex = end;
    }
    chunks.push(out.slice(cursor));
    const cleaned = chunks.join('').replace(/\n{3,}/g, '\n\n').trim();
    return `${cleaned}\n`;
}

/** Find the index just past the paren matching the one at `open`. */
function matchBalancedParens(source: string, open: number): number {
    let depth = 0;
    let inString: '"' | "'" | '`' | null = null;
    for (let i = open; i < source.length; i += 1) {
        const char = source[i];
        if (inString) {
            if (char === '\\') {
                i += 1;
            } else if (char === inString) {
                inString = null;
            }
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            inString = char;
        } else if (char === '(') {
            depth += 1;
        } else if (char === ')') {
            depth -= 1;
            if (depth === 0) return i + 1;
        }
    }
    return -1;
}

/**
 * Collect the bare (non-relative) import specifiers across every code source
 * in the project — the dependencies the generated package.json must declare.
 */
export function collectCodeBareImports(sources: Array<{ source: string }>): string[] {
    const specifiers = new Set<string>();
    for (const { source } of sources) {
        for (const spec of extractBareImports(source)) {
            specifiers.add(spec);
        }
    }
    return [...specifiers].sort();
}

/** Extract bare (non-relative, non-absolute) import specifiers from source. */
export function extractBareImports(source: string): string[] {
    const specs: string[] = [];
    // `\s*` after from/import (not `\s+`) so minified bundle imports like
    // `import{x}from"framer-motion"` are still recognized — published module
    // bundles are never prettier-formatted.
    const pattern = /(?:from|import)\s*\(?\s*(['"])([^'".]+)\1/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
        const spec = match[2];
        if (spec.startsWith('.') || spec.startsWith('/')) continue;
        specs.push(spec);
    }
    return specs;
}

/** The dependency mapping for known bare imports (pinned conservatively). */
export function resolveBareImportVersion(spec: string): string | undefined {
    // Scoped packages: the scope (`@motionone`) is the first path segment, so
    // the FULL spec must be matched, not the split base.
    if (spec === '@motionone/dom') {
        // Published module bundles (e.g. Ticker) animate through motionone.
        return '^10.18.0';
    }
    const base = spec.split('/')[0];
    switch (base) {
        case 'framer-motion':
            return '^12.0.0';
        case 'motion':
        case 'react':
        case 'react-dom':
            return undefined; // already declared by the generated project
        default:
            return undefined; // unknown — reported as a warning, added as '*'
    }
}

/** Whether a bare import is already declared by the generated project. */
export function isBuiltinImport(spec: string): boolean {
    const base = spec.split('/')[0];
    return base === 'react' || base === 'react-dom' || base === 'motion';
}
