/**
 * Design AST assets → project asset files.
 */

import type { Asset, DesignDocument } from '@framer/compiler-ast';
import { sanitizeFileName } from '@framer/compiler-shared';

import type { VirtualFile } from '../types';

/** Generate asset files for the project. */
export function generateAssets(document: DesignDocument): VirtualFile[] {
    const files: VirtualFile[] = [];
    const seen = new Set<string>();

    for (const asset of document.assets) {
        const path = getAssetPath(asset);
        if (seen.has(path)) continue;
        seen.add(path);

        if (asset.data) {
            files.push({
                path,
                content: '',
                binary: true,
                data: asset.data,
            });
        } else if (asset.text) {
            files.push({
                path,
                content: asset.text,
            });
        } else {
            // For remote assets, generate a placeholder reference note.
            files.push({
                path,
                content: `// Remote asset placeholder: ${asset.src}\n// Replace this file with the actual asset from the source.\n`,
            });
        }
    }

    return files;
}

/** Get the output path for an asset. */
function getAssetPath(asset: Asset): string {
    const dir = getAssetDirectory(asset.type);
    const baseName = sanitizeFileName(asset.fileName);
    return `${dir}/${baseName}.${asset.extension}`;
}

/** Get the output directory for an asset type. */
function getAssetDirectory(type: Asset['type']): string {
    switch (type) {
        case 'image':
            return 'src/assets/images';
        case 'svg':
            return 'src/assets/images';
        case 'icon':
            return 'src/assets/icons';
        case 'font':
            return 'public/fonts';
        case 'video':
            return 'src/assets/videos';
        default:
            return 'src/assets';
    }
}