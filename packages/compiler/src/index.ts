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
import { generateProject, type GeneratedProject, type VirtualFile } from '@framer/compiler-generators';
import { formatFile } from '@framer/compiler-formatter';
import { parseFramerDocument, type FramerDocument } from '@framer/compiler-parser';
import { DEFAULT_PROJECT_NAME } from '@framer/compiler-shared';
import { createZip } from '@framer/compiler-zip';

import { extractComponents, type ExtractOptions } from './extractor';
import { optimizeDocument } from './optimizer';

export * from './extractor';
export * from './optimizer';

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

    // Stage 6 — Zip
    const zip = runZip ? await createZip(files) : undefined;

    return {
        name: project.name,
        files,
        zip,
        nodes: project.nodes,
        project: { ...project, files },
    };
}

/** Compile a Framer document end-to-end (parser + compiler). */
export async function compileFramerDocument(document: FramerDocument, options: CompileOptions = {}): Promise<CompileResult> {
    return compile(parseFramerDocument(document), options);
}
