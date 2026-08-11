/**
 * Design document definitions for the Design AST.
 */

import type { Breakpoint, DesignToken } from '@framer/compiler-shared';

import type { Asset, FontAsset } from './asset';
import type { ComponentDefinition } from './component';
import type { DesignNode } from './nodes';

/** The design document — the single source of truth for the compiler. */
export interface DesignDocument {
    /** The version of the AST schema. */
    version: string;
    /** The name of the document. */
    name: string;
    /** The root nodes of the document. */
    nodes: DesignNode[];
    /** The assets referenced by the document. */
    assets: Asset[];
    /** The fonts used by the document. */
    fonts: FontAsset[];
    /** The design tokens extracted from the document. */
    tokens?: DesignTokens;
    /** The breakpoints defined for the document. */
    breakpoints: Breakpoint[];
    /**
     * The reusable component definitions (one implementation per definition).
     *
     * Populated by the separation pass; when absent, generation derives
     * definitions deterministically from the document's instances, so the
     * model is a single source of truth either way.
     */
    components?: ComponentDefinition[];
    /** The metadata of the document. */
    metadata?: DocumentMetadata;
}

/** The design tokens for a document. */
export interface DesignTokens {
    /** Color tokens. */
    colors?: DesignToken<string>[];
    /** Spacing tokens. */
    spacing?: DesignToken<number>[];
    /** Typography tokens. */
    typography?: DesignToken<Record<string, unknown>>[];
    /** Radius tokens. */
    radius?: DesignToken<number>[];
    /** Shadow tokens. */
    shadows?: DesignToken<string>[];
}

/** The metadata of a document. */
export interface DocumentMetadata {
    /** The source platform (e.g., 'framer'). */
    source: string;
    /** The source document ID. */
    sourceId?: string;
    /** The source document version. */
    sourceVersion?: string;
    /** The export timestamp. */
    exportedAt?: string;
    /** The compiler version. */
    compilerVersion?: string;
    /** Custom metadata. */
    custom?: Record<string, unknown>;
}