/**
 * @framer/compiler — Export diagnostics.
 *
 * A structured, human-readable summary of what the compiler discovered and
 * produced. Used by the plugin UI (debug mode) and by the validator to make
 * the pipeline observable:
 *
 *   Nodes discovered: 183
 *   Nodes normalized: 183
 *   Unique components: 27
 *   Components from masters: 22
 *   Components synthesized: 5
 *   Component instances: 91
 *   Assets discovered: 42
 *   Unique assets: 35
 *   Generated files: 61
 *   Warnings: 2
 *   Errors: 0
 */

import type { DesignDocument, DesignNode } from '@framer/compiler-ast';

import type { CoverageReport } from './coverage';
import type { ExportValidationResult } from './validate';

/** The diagnostic summary of a compilation. */
export interface ExportDiagnostics {
    /** The number of design nodes discovered (including templates and slots). */
    nodesDiscovered: number;
    /** The number of nodes after normalization (parity with discovered). */
    nodesNormalized: number;
    /** The number of unique component implementations emitted. */
    uniqueComponents: number;
    /** The number of definitions backed by a real master body (true fidelity). */
    componentsFromMasters: number;
    /** The number of definitions backed by their real code source (code components). */
    componentsFromCode: number;
    /**
     * The number of definitions with a synthesized body (no master/template
     * exposed — slot positions/content are approximate, reported as warnings).
     */
    componentsSynthesized: number;
    /** The number of component instance nodes in the document. */
    componentInstances: number;
    /** The number of assets discovered in the source document. */
    assetsDiscovered: number;
    /** The number of unique assets written after content dedup. */
    uniqueAssets: number;
    /** The number of generated project files. */
    generatedFiles: number;
    /** The number of validation warnings. */
    warnings: number;
    /** The number of validation errors. */
    errors: number;
    /** The full validation report. */
    validation: ExportValidationResult;
    /** The Source Property Coverage report (keystone fidelity metric). */
    coverage?: CoverageReport;
}

/** Compute diagnostics for a compilation. */
export function computeDiagnostics(options: {
    document: DesignDocument;
    filesCount: number;
    componentFiles: number;
    assetsDiscovered: number;
    uniqueAssets: number;
    validation: ExportValidationResult;
    coverage?: CoverageReport;
}): ExportDiagnostics {
    const nodes = countNodes(options.document.nodes);
    const components = options.document.components ?? [];
    let componentsFromMasters = 0;
    let componentsFromCode = 0;
    let componentsSynthesized = 0;
    for (const definition of components) {
        if (definition.bodySource === 'master') componentsFromMasters += 1;
        else if (definition.bodySource === 'code') componentsFromCode += 1;
        else if (definition.bodySource === 'synthesized') componentsSynthesized += 1;
    }
    return {
        nodesDiscovered: nodes,
        nodesNormalized: nodes,
        uniqueComponents: options.componentFiles,
        componentsFromMasters,
        componentsFromCode,
        componentsSynthesized,
        componentInstances: countComponents(options.document.nodes),
        assetsDiscovered: options.assetsDiscovered,
        uniqueAssets: options.uniqueAssets,
        generatedFiles: options.filesCount,
        warnings: options.validation.warnings.length,
        errors: options.validation.errors.length,
        validation: options.validation,
        coverage: options.coverage,
    };
}

/** Count every node in a document tree (templates and slots included). */
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
