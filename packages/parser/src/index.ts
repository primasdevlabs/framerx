/**
 * @framer/compiler-parser — Framer document → Design AST conversion.
 *
 * This is the ONLY package that touches Framer-specific APIs.
 * It converts a Framer document into the shared Design AST.
 */

import type { DesignDocument, DesignNode } from '@framer/compiler-ast';
import { DEFAULT_BREAKPOINTS } from '@framer/compiler-shared';

import { collectAssets, collectFonts } from './assets';
import { parseNode } from './node';
import type { FramerDocument, FramerNode } from './types';

export * from './types';
export * from './node';
export * from './layout';
export * from './style';
export * from './typography';
export * from './animation';
export * from './interaction';
export * from './assets';
export * from './fixtures/mock-document';
export * from './fixtures/master-document';
export * from './fixtures/fat-fixture';

/** Parse a Framer document into a Design AST. */
export function parseFramerDocument(document: FramerDocument): DesignDocument {
    // One shared master cache per document parse: every instance of a
    // component resolves to the SAME parsed master body object, so masters
    // parse exactly once and their DesignNode identity is stable.
    const sharedMasters = new Map<FramerNode, DesignNode>();
    const nodes = document.nodes.map((node) => parseNode(node, sharedMasters));

    // Breakpoints come from the source document when it defines them; only
    // then fall back to the default scale. Responsive behavior is always
    // driven by the extracted breakpoint definitions, never assumed.
    const breakpoints =
        document.breakpoints && document.breakpoints.length > 0
            ? document.breakpoints.map((bp) => ({ name: bp.name, minWidth: bp.minWidth }))
            : DEFAULT_BREAKPOINTS;

    return {
        version: '1.0.0',
        name: document.name || 'Untitled',
        nodes,
        assets: collectAssets(document.nodes),
        // Prefer font files/URLs explicitly collected from the source API.
        // The node walk remains the fallback for SDK versions that expose only
        // text style metadata, and FontRegistry will warn when it has no file.
        fonts: document.fonts ?? collectFonts(document.nodes),
        breakpoints,
        metadata: {
            source: 'framer',
            sourceId: document.id,
            sourceVersion: document.version,
            custom: {
                // Distinguish text-style inference from an explicit font
                // resource collection. The registry warns only when the
                // source actually claimed to expose font resources.
                fontSources: document.fonts ? 'source-api' : 'node-inferred',
            },
        },
    };
}