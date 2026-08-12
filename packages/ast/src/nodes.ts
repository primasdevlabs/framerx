/**
 * Design node definitions for the Design AST.
 *
 * The DesignNode is the single source of truth for the compiler.
 * It must never contain Framer-specific types.
 */

import type { Rect } from '@framer/compiler-shared';

import type { AnimationState } from './animation';
import type { AssetRef } from './asset';
import type { Constraints } from './constraints';
import type { InteractionState } from './interaction';
import type { Layout } from './layout';
import type { VisualStyle } from './style';
import type { TextContent } from './typography';

/** The type of a design node. */
export type DesignNodeType = 'frame' | 'text' | 'image' | 'vector' | 'component' | 'slot' | 'group';

/** The base properties shared by all design nodes. */
export interface BaseDesignNode {
    /** The unique ID of the node. */
    id: string;
    /** The type of the node. */
    type: DesignNodeType;
    /** The name of the node. */
    name: string;
    /** The bounding box of the node. */
    frame: Rect;
    /** The layout of the node. */
    layout: Layout;
    /** The visual style of the node. */
    style: VisualStyle;
    /** The constraints of the node. */
    constraints: Constraints;
    /** The animations of the node. */
    animations?: AnimationState;
    /** The interactions of the node. */
    interactions?: InteractionState;
    /** The child nodes. */
    children: DesignNode[];
    /** The metadata of the node. */
    metadata?: NodeMetadata;
}

/** A frame node (a layout container). */
export interface DesignFrameNode extends BaseDesignNode {
    type: 'frame';
    /** Whether the frame is a section (page-level container). */
    isSection?: boolean;
    /** Whether the frame is a scroll container. */
    isScrollContainer?: boolean;
    /** The semantic HTML element to use. */
    semanticTag?: string;
}

/** A text node. */
export interface DesignTextNode extends BaseDesignNode {
    type: 'text';
    /** The text content. */
    text: TextContent;
}

/** An image node. */
export interface DesignImageNode extends BaseDesignNode {
    type: 'image';
    /** The asset reference. */
    asset: AssetRef;
    /** The object-fit behavior. */
    objectFit?: 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';
    /** The object-position. */
    objectPosition?: string;
}

/** A vector node (SVG shape or icon). */
export interface DesignVectorNode extends BaseDesignNode {
    type: 'vector';
    /** The SVG content. */
    svg?: string;
    /** The asset reference (if the vector is an asset). */
    asset?: AssetRef;
    /** The vector path data. */
    pathData?: string;
}

/** A component node (an instance of a reusable component). */
export interface DesignComponentNode extends BaseDesignNode {
    type: 'component';
    /** The component definition ID. */
    componentId: string;
    /** The component name. */
    componentName: string;
    /** The component props. */
    props?: Record<string, unknown>;
    /** The component slot content. */
    slots?: Record<string, DesignNode[]>;
    /**
     * The component master template (the rendered body).
     *
     * Set by the component extraction pass. Text nodes inside the template
     * that are driven by props carry `metadata.custom.prop = '<propName>'`;
     * the generator renders those as `{propName}` interpolations instead of
     * static text. When absent, the instance's own children are rendered.
     *
     * Instances share a reference to the same template — treat it as
     * immutable after extraction.
     */
    template?: DesignNode;
}

/** A slot node (a placeholder for children). */
export interface DesignSlotNode extends BaseDesignNode {
    type: 'slot';
    /** The slot name. */
    slotName: string;
}

/** A group node (a non-layout grouping of nodes). */
export interface DesignGroupNode extends BaseDesignNode {
    type: 'group';
}

/** The design node discriminated union. */
export type DesignNode =
    | DesignFrameNode
    | DesignTextNode
    | DesignImageNode
    | DesignVectorNode
    | DesignComponentNode
    | DesignSlotNode
    | DesignGroupNode;

/** The metadata for a node. */
export interface NodeMetadata {
    /** The original source ID (e.g., Framer node ID). */
    sourceId?: string;
    /** The original source type (e.g., Framer node type). */
    sourceType?: string;
    /** Whether the node was auto-generated. */
    generated?: boolean;
    /** Whether the node is a duplicate of another node. */
    duplicateOf?: string;
    /** Custom metadata. */
    custom?: Record<string, unknown>;
}

/** Type guard for frame nodes. */
export function isFrameNode(node: DesignNode): node is DesignFrameNode {
    return node.type === 'frame';
}

/** Type guard for text nodes. */
export function isTextNode(node: DesignNode): node is DesignTextNode {
    return node.type === 'text';
}

/** Type guard for image nodes. */
export function isImageNode(node: DesignNode): node is DesignImageNode {
    return node.type === 'image';
}

/** Type guard for vector nodes. */
export function isVectorNode(node: DesignNode): node is DesignVectorNode {
    return node.type === 'vector';
}

/** Type guard for component nodes. */
export function isComponentNode(node: DesignNode): node is DesignComponentNode {
    return node.type === 'component';
}

/** Type guard for slot nodes. */
export function isSlotNode(node: DesignNode): node is DesignSlotNode {
    return node.type === 'slot';
}

/** Type guard for group nodes. */
export function isGroupNode(node: DesignNode): node is DesignGroupNode {
    return node.type === 'group';
}

/** Check if a node has children. */
export function hasChildren(node: DesignNode): boolean {
    return node.children.length > 0;
}

/** Walk the node tree, visiting each node. */
export function walkNodes(
    node: DesignNode,
    visitor: (node: DesignNode, parent?: DesignNode) => void,
    parent?: DesignNode,
): void {
    visitor(node, parent);
    for (const child of node.children) {
        walkNodes(child, visitor, node);
    }
}

/** Find a node by ID. */
export function findNode(root: DesignNode, id: string): DesignNode | null {
    if (root.id === id) return root;
    for (const child of root.children) {
        const found = findNode(child, id);
        if (found) return found;
    }
    return null;
}

/** Collect all nodes of a specific type. */
export function collectNodes<T extends DesignNode>(root: DesignNode, predicate: (node: DesignNode) => node is T): T[] {
    const results: T[] = [];
    walkNodes(root, (node) => {
        if (predicate(node)) results.push(node);
    });
    return results;
}
