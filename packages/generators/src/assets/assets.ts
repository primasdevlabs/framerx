/**
 * Design AST assets → project asset files.
 *
 * This is a thin wrapper around the asset registry (registry.ts): all dedup,
 * naming, and reference-resolution logic lives there so code generation and
 * asset writing agree on every path.
 */

import type { DesignDocument } from '@framer/compiler-ast';

import type { VirtualFile } from '../types';

import { buildAssetRegistry, registryToVirtualFiles } from './registry';

export * from './registry';

/** Build the asset registry for a document. */
export function buildAssets(document: DesignDocument) {
    return buildAssetRegistry(document);
}

/** Generate asset files for the project (deprecated: use the registry). */
export function generateAssets(document: DesignDocument): VirtualFile[] {
    return registryToVirtualFiles(buildAssetRegistry(document).files);
}
