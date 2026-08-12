/**
 * Framer asset collection.
 */

import type { Asset, AssetType, FontAsset } from '@framer/compiler-ast';
import { sanitizeFileName, stableId } from '@framer/compiler-shared';

import type { FramerNode, FramerTypography } from './types';

/** Collect all assets from a Framer node tree. */
export function collectAssets(nodes: FramerNode[]): Asset[] {
    const assets: Asset[] = [];
    const seen = new Set<string>();

    const visit = (node: FramerNode): void => {
        // Standalone image nodes (leaf <img> elements).
        if (node.image?.src) {
            const src = node.image.src;
            if (!seen.has(src)) {
                seen.add(src);
                // Pass the full FramerImage object as meta — it now carries
                // the pre-fetched binary `data` field written by the exporter.
                assets.push(
                    createAsset(
                        'image',
                        src,
                        node.image.name,
                        node.image as {
                            data?: Uint8Array;
                            width?: number;
                            height?: number;
                            mimeType?: string;
                            size?: number;
                            alt?: string;
                        },
                    ),
                );
            }
        }

        // External SVG asset URL.
        if (node.vector?.src) {
            const src = node.vector.src;
            if (!seen.has(src)) {
                seen.add(src);
                assets.push(createAsset('svg', src, node.vector.name, node.vector));
            }
        }

        // Inline SVG text — store as an SVG file so it appears in the ZIP.
        if (node.vector?.svg && !node.vector.src) {
            const key = `inline-svg:${node.id}`;
            if (!seen.has(key)) {
                seen.add(key);
                const baseName = sanitizeFileName(node.vector.name ?? node.name ?? 'icon');
                assets.push({
                    id: stableId('asset', `inline-svg:${node.id}`),
                    type: 'svg',
                    src: '',
                    name: node.vector.name ?? node.name ?? 'icon',
                    fileName: baseName,
                    extension: 'svg',
                    text: node.vector.svg,
                });
            }
        }

        // Image fills on any node — covers frames used as cards, hero sections,
        // testimonial backgrounds, etc. where the image is a CSS background-image.
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

        // Responsive image overrides — an alternate image folded into the
        // primary's per-breakpoint behavior (its bytes were resolved by the
        // plugin before the replica was pruned). The alternate must ship as a
        // local file too, or the tier's CSS swap would point at a file the
        // ZIP does not contain.
        if (node.responsive) {
            for (const override of Object.values(node.responsive)) {
                const img = override.image;
                if (img?.src && !seen.has(img.src)) {
                    seen.add(img.src);
                    assets.push(createAsset('image', img.src, img.name, img));
                }
            }
        }

        // Component props asset URLs and inline SVGs (avatars, prop-driven images, icons).
        if (node.props) {
            for (const [propName, val] of Object.entries(node.props)) {
                if (typeof val === 'string') {
                    if (/^https?:\/\//i.test(val) || /^data:image\//i.test(val)) {
                        const isSvg = /\.svg(?:\?.*)?$/i.test(val);
                        const type: AssetType = isSvg ? 'svg' : 'image';
                        if (!seen.has(val)) {
                            seen.add(val);
                            assets.push(createAsset(type, val, propName));
                        }
                    } else if (val.trim().startsWith('<svg')) {
                        const propKey = `inline-svg-prop:${node.id}:${propName}`;
                        if (!seen.has(propKey)) {
                            seen.add(propKey);
                            const baseName = sanitizeFileName(propName || 'icon');
                            assets.push({
                                id: stableId('asset', `inline-svg-prop:${node.id}:${propName}`),
                                type: 'svg',
                                src: '',
                                name: propName,
                                fileName: baseName,
                                extension: 'svg',
                                text: val,
                            });
                        }
                    }
                }
            }
        }

        for (const child of node.children ?? []) {
            visit(child);
        }

        // Traverse component slot children and variant nodes.
        if (node.component?.slots) {
            for (const slotNodes of Object.values(node.component.slots)) {
                for (const slotNode of slotNodes) visit(slotNode);
            }
        }
        // Component masters are real source subtrees. Their assets are used by
        // the generated definition even though the master is not mounted as a
        // canvas child, so they must enter the same registry traversal.
        if (node.component?.master) visit(node.component.master);
        if (node.variants) {
            for (const variant of node.variants) {
                for (const variantNode of variant.nodes) visit(variantNode);
            }
        }
    };

    for (const node of nodes) {
        visit(node);
    }

    return assets;
}

/** Create an Asset from a source URL. */
function createAsset(
    type: AssetType,
    src: string,
    name?: string,
    meta?: { width?: number; height?: number; mimeType?: string; size?: number; alt?: string; data?: Uint8Array },
): Asset {
    const extension = getExtension(src, type);
    // Deterministic file names: named assets keep their name, unnamed assets derive
    // a stable name from the source URL so output is reproducible across runs.
    const baseName = name ? sanitizeFileName(name) : stableId('asset', src);

    return {
        id: stableId('asset', src),
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
        data: meta?.data,
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

/** Collect every distinct font family/weight/style tuple from the source tree. */
export function collectFonts(nodes: FramerNode[]): FontAsset[] {
    const fonts: FontAsset[] = [];
    const seen = new Set<string>();

    const addTypography = (style?: FramerTypography): void => {
        if (!style) return;
        const typography = style;
        const family = typography.fontFamily?.trim();
        if (!family) return;
        const weight = typeof typography.fontWeight === 'number' ? typography.fontWeight : 400;
        const fontStyle: FontAsset['style'] = typography.italic ? 'italic' : 'normal';
        const key = `${family}|${weight}|${fontStyle}`;
        if (seen.has(key)) return;
        seen.add(key);
        fonts.push({ family, weight, style: fontStyle, sources: [] });
    };

    const visit = (node: FramerNode): void => {
        addTypography(node.text?.style);
        for (const run of node.text?.runs ?? []) addTypography(run.style);
        for (const child of node.children ?? []) visit(child);
        for (const slotNodes of Object.values(node.component?.slots ?? {})) {
            for (const slotNode of slotNodes) visit(slotNode);
        }
        if (node.component?.master) visit(node.component.master);
        for (const variant of node.variants ?? []) {
            for (const variantNode of variant.nodes) visit(variantNode);
        }
    };

    for (const node of nodes) visit(node);
    return fonts;
}
