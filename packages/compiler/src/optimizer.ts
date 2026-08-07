/**
 * @framer/compiler — AST optimization passes.
 *
 * Stage 3 of the compiler pipeline. Optimization is deterministic: it only
 * performs transformations that are provably safe for rendering fidelity.
 *
 * Current passes:
 *  - removeRedundantWrappers: drop empty container nodes that carry no style,
 *    layout, animation, or semantic meaning (they would render as empty divs).
 *  - extractComponents: group structurally identical subtrees into reusable
 *    components with text values as props (see extractor.ts).
 */

import type { DesignDocument, DesignNode } from '@framer/compiler-ast';

import { extractComponents, type ExtractOptions } from './extractor';

/** The options for the optimization stage. */
export interface OptimizeOptions {
    /**
     * Whether to extract repeated subtrees into reusable components.
     * Defaults to true. Pass an object to tune the extraction thresholds.
     */
    extractComponents?: boolean | ExtractOptions;
}

/** Optimize a design document. Returns a new document; the input is untouched. */
export function optimizeDocument(document: DesignDocument, options: OptimizeOptions = {}): DesignDocument {
    let result: DesignDocument = {
        ...document,
        nodes: document.nodes.map(optimizeNode),
    };

    if (options.extractComponents !== false) {
        result = extractComponents(result, typeof options.extractComponents === 'object' ? options.extractComponents : undefined);
    }

    return result;
}

/** Optimize a single node tree, returning a new tree. */
export function optimizeNode(node: DesignNode): DesignNode {
    return {
        ...node,
        children: node.children
            .map(optimizeNode)
            .filter((child) => !isRedundantWrapper(child)),
    };
}

/** Check whether a container node renders nothing and can be dropped. */
function isRedundantWrapper(node: DesignNode): boolean {
    if (node.type !== 'frame' && node.type !== 'group') return false;
    if (node.children.length > 0) return false;

    const style = node.style;
    const hasVisualStyle =
        (style.fills !== undefined && style.fills.length > 0) ||
        (style.strokes !== undefined && style.strokes.length > 0) ||
        (style.shadows !== undefined && style.shadows.length > 0) ||
        style.radius !== undefined ||
        style.opacity !== undefined ||
        style.visible === false ||
        style.overflow !== undefined ||
        style.transform !== undefined;

    const hasAnimations = node.animations !== undefined && node.animations.animations.length > 0;
    const hasPosition = node.layout.position.mode !== 'static';
    const isSpecial = node.type === 'frame' && (node.isSection === true || node.isScrollContainer === true);

    // A fixed/fill-sized empty container still occupies layout space (flex/grid
    // distribution), so only drop containers that render nothing (auto/hug sizing).
    const sizing = node.layout.sizing;
    const rendersNothing =
        (sizing.widthMode === 'auto' || sizing.widthMode === 'hug') &&
        (sizing.heightMode === 'auto' || sizing.heightMode === 'hug');

    return rendersNothing && !hasVisualStyle && !hasAnimations && !hasPosition && !isSpecial;
}
