/**
 * Generator output types.
 */

import type { DesignNode } from '@framer/compiler-ast';

import type { DesignTokens } from './tailwind/tokens';

/** A virtual file in the generated project. */
export interface VirtualFile {
    /** The relative path of the file within the project. */
    path: string;
    /** The text content of the file. */
    content: string;
    /** Whether the file is binary (for assets). */
    binary?: boolean;
    /** The binary data (for assets). */
    data?: Uint8Array;
}

/** The generated project — a virtual file tree. */
export interface GeneratedProject {
    /** The name of the project. */
    name: string;
    /** The files in the project. */
    files: VirtualFile[];
    /** The root nodes that were generated. */
    nodes: DesignNode[];
}

/** The component mapping for a generated node. */
export interface ComponentMapping {
    /** The node ID. */
    nodeId: string;
    /** The component name. */
    name: string;
    /** The relative import path. */
    importPath: string;
}

/** The generator options. */
export interface GeneratorOptions {
    /** The project name. */
    projectName: string;
    /** Whether to generate Motion animations. */
    animations?: boolean;
    /** Whether to extract reusable components. */
    extractComponents?: boolean;
    /** Whether to generate Tailwind classes. */
    tailwind?: boolean;
    /** Design tokens to prefer over arbitrary values (computed by default). */
    tokens?: DesignTokens;
}