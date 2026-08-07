/**
 * @framer/compiler-parser — Framer document → Design AST conversion.
 *
 * This is the ONLY package that touches Framer-specific APIs.
 * It converts a Framer document into the shared Design AST.
 */

import type { DesignDocument } from '@framer/compiler-ast';
import { DEFAULT_BREAKPOINTS } from '@framer/compiler-shared';

import { collectAssets, collectFonts } from './assets';
import { parseNode } from './node';
import type { FramerDocument } from './types';

export * from './types';
export * from './node';
export * from './layout';
export * from './style';
export * from './typography';
export * from './animation';
export * from './assets';
export * from './fixtures/mock-document';

/** Parse a Framer document into a Design AST. */
export function parseFramerDocument(document: FramerDocument): DesignDocument {
    const nodes = document.nodes.map(parseNode);

    return {
        version: '1.0.0',
        name: document.name || 'Untitled',
        nodes,
        assets: collectAssets(document.nodes),
        fonts: collectFonts(document.nodes),
        breakpoints: DEFAULT_BREAKPOINTS,
        metadata: {
            source: 'framer',
            sourceId: document.id,
            sourceVersion: document.version,
        },
    };
}