/**
 * Framer asset collection.
 */

import type { Asset, AssetType, FontAsset } from '@framer/compiler-ast';
import { generateId, sanitizeFileName, stableId } from '@framer/compiler-shared';

import type { FramerNode } from './types';

/** Collect all assets from a Framer node tree. */
export function collectAssets(nodes: FramerNode[]): Asset[] {
    const assets: Asset[] = [];
    const seen = new Set<string>();

    const visit = (node: FramerNode): void => {
        if (node.image?.src) {
            const src = node.image.src;
            if (!seen.has(src)) {
                seen.add(src);
                assets.push(createAsset('image', src, node.image.name, node.image));
            }
        }

        if (node.vector?.src) {
            const src = node.vector.src;
            if (!seen.has(src)) {
                seen.add(src);
                assets.push(createAsset('svg', src, node.vector.name));
            }
        }

        if (node.style?.fills) {
            for (const fill of node.style.fills) {
                if (fill.type === 'image' && fill.image?.src) {
                    const src = fill.image.src;
                    if (!seen.has(src)) {
                        seen.add(src);
                        assets.push(createAsset('image', src, fill.image.name, fill.image));
                    }
                }
            }
        }

        for (const child of node.children ?? []) {
            visit(child);
        }
    };

    for (const node of nodes) {
        visit(node);
    }

    return assets;
}

/** Create an Asset from a source URL. */
function createAsset(type: AssetType, src: string, name?: string, meta?: { width?: number; height?: number; mimeType?: string; size?: number; alt?: string }): Asset {
    const extension = getExtension(src, type);
    // Deterministic file names: named assets keep their name, unnamed assets derive
    // a stable name from the source URL so output is reproducible across runs.
    const baseName = name ? sanitizeFileName(name) : stableId('asset', src);

    return {
        id: generateId('asset'),
        type,
        src,
        name: name ?? baseName,
        fileName: baseName,
        extension,
        width: meta?.width,
        height: meta?.height,
        mimeType: meta?.mimeType,
        size: meta?.size,
        alt: meta?.alt,
    };
}

/** Extract the file extension from a URL. */
function getExtension(src: string, type: AssetType): string {
    const match = /\.([a-zA-Z0-9]+)(?:\?.*)?$/.exec(src);
    if (match) return match[1].toLowerCase();

    switch (type) {
        case 'image':
            return 'png';
        case 'svg':
            return 'svg';
        case 'icon':
            return 'svg';
        case 'font':
            return 'woff2';
        case 'video':
            return 'mp4';
        default:
            return 'bin';
    }
}

/** Collect all fonts from a Framer node tree. */
export function collectFonts(nodes: FramerNode[]): FontAsset[] {
    const fonts: FontAsset[] = [];
    const seen = new Set<string>();

    const visit = (node: FramerNode): void => {
        const textStyle = node.text?.style;
        const fontFamily = textStyle?.fontFamily;
        if (fontFamily && !seen.has(fontFamily)) {
            seen.add(fontFamily);
            fonts.push({
                family: fontFamily,
                weight: typeof textStyle.fontWeight === 'number' ? textStyle.fontWeight : 400,
                style: 'normal',
                sources: [],
            });
        }

        for (const child of node.children ?? []) {
            visit(child);
        }
    };

    for (const node of nodes) {
        visit(node);
    }

    return fonts;
}