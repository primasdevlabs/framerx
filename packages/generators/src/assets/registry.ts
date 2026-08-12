/**
 * The asset registry.
 *
 * Asset extraction is a first-class compiler subsystem, not an afterthought:
 *
 *   Asset Collector (parser)
 *        ↓
 *   Asset Registry      ← this module
 *        ↓
 *   Deduplicate by content (SHA-256 of bytes / text)
 *        ↓
 *   Deterministic, collision-safe filenames
 *        ↓
 *   Write files + resolve code references to real paths
 *
 * Rules enforced here:
 *   - Two assets with identical bytes/text export as ONE physical file
 *     (content hashing — never by name or URL alone).
 *   - Two assets with different bytes keep both files, even when they share a
 *     name (deterministic `-2`, `-3` suffixes).
 *   - File names are deterministic: derived from the asset name, then the URL,
 *     never from traversal order or random ids.
 *   - Extensions preserve the real asset type (mimeType first, then URL).
 *   - `data:` URIs are decoded to real bytes so the ZIP is self-contained.
 *   - Assets with only a remote URL are flagged `remoteOnly` — the code keeps
 *     a runtime URL reference and the validator reports a warning, because a
 *     broken local reference is worse than an external one.
 */

import type { Asset, DesignDocument } from '@framer/compiler-ast';
import { sanitizeFileName, sha256Hex, sha256HexOfString, utf8Encode } from '@framer/compiler-shared';

// `atob` is a global in browsers and Node 16+, but neither lib declares it
// without DOM types — declare it locally so this file compiles everywhere.
declare function atob(data: string): string;

import type { VirtualFile } from '../types';

/** A resolved, deduplicated asset file for the generated project. */
export interface AssetFile {
    /** The originating asset (first occurrence wins the content group). */
    asset: Asset;
    /** The project-relative output path (e.g. `public/assets/images/hero.png`). */
    path: string;
    /** The binary bytes (images, videos, fonts, decoded data URIs). */
    data?: Uint8Array;
    /** The text content (inline SVGs). */
    text?: string;
    /** True when only a remote URL is available (no local bytes). */
    remoteOnly?: boolean;
}

/** The built asset registry. */
export interface AssetRegistry {
    /** The deduplicated files to write into the project. */
    files: AssetFile[];
    /** src URL / data URI → project-relative output path (for code references). */
    pathBySrc: ReadonlyMap<string, string>;
    /** asset id → project-relative output path. */
    pathById: ReadonlyMap<string, string>;
    /** The number of source assets discovered (before dedup). */
    discoveredCount: number;
    /** The number of unique assets after content dedup. */
    uniqueCount: number;
}

/** MIME type → canonical file extension. */
const EXTENSION_BY_MIME: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'font/woff': 'woff',
    'font/woff2': 'woff2',
    'font/ttf': 'ttf',
    'font/otf': 'otf',
};

/** Build the asset registry for a document. Deterministic: same input → same output. */
export function buildAssetRegistry(document: DesignDocument): AssetRegistry {
    // 1. Normalize every source asset into a content carrier.
    const normalized: Array<{
        asset: Asset;
        data?: Uint8Array;
        text?: string;
        remoteOnly?: boolean;
        mimeType?: string;
    }> = [];
    for (const asset of document.assets) {
        if (asset.data && asset.data.byteLength > 0) {
            normalized.push({ asset, data: asset.data });
            continue;
        }
        if (asset.text) {
            normalized.push({ asset, text: asset.text });
            continue;
        }
        if (asset.src.startsWith('data:')) {
            const decoded = decodeDataUri(asset.src);
            if (decoded) {
                normalized.push({ asset, data: decoded.data, mimeType: decoded.mimeType });
                continue;
            }
        }
        if (/^https?:\/\//i.test(asset.src)) {
            normalized.push({ asset, remoteOnly: true });
            continue;
        }
        // Degenerate: no bytes, no text, no usable source. Skip.
    }

    // 2. Deduplicate by content (bytes or text); remote-only dedups by URL.
    const byContentKey = new Map<string, (typeof normalized)[number]>();
    const order: string[] = [];
    // Every source entry → its content key, so identical assets reached via
    // different URLs all resolve to the single physical file.
    const contentKeyOf = new Map<(typeof normalized)[number], string>();
    for (const entry of normalized) {
        const key = contentKey(entry);
        contentKeyOf.set(entry, key);
        if (!byContentKey.has(key)) {
            byContentKey.set(key, entry);
            order.push(key);
        }
    }

    // 3. Assign deterministic, collision-safe output paths.
    const files: AssetFile[] = [];
    const pathBySrc = new Map<string, string>();
    const pathById = new Map<string, string>();
    // content key → assigned path (built after naming, used for all aliases).
    const pathByContentKey = new Map<string, string>();
    // directory → base name → number of files already using that base name.
    const usedBases = new Map<string, Map<string, number>>();

    for (const key of order) {
        const entry = byContentKey.get(key)!;
        const { asset } = entry;
        const extension = resolveExtension(asset, entry);
        const baseName = resolveBaseName(asset);
        const directory = assetDirectory(asset.type);

        const used = usedBases.get(directory) ?? new Map<string, number>();
        const count = used.get(baseName) ?? 0;
        used.set(baseName, count + 1);
        usedBases.set(directory, used);
        const fileName = count === 0 ? baseName : `${baseName}-${count + 1}`;
        const path = `${directory}/${fileName}.${extension}`;

        const file: AssetFile = { asset, path };
        if (entry.data) file.data = entry.data;
        if (entry.text) file.text = entry.text;
        if (entry.remoteOnly) file.remoteOnly = true;
        files.push(file);
        pathByContentKey.set(key, path);
        pathById.set(asset.id, path);
    }

    // Every source src (including deduplicated aliases) resolves to the path
    // of the file that physically contains it. Remote-only assets have no
    // local file — they keep their runtime URL reference instead.
    for (const entry of normalized) {
        const key = contentKeyOf.get(entry)!;
        if (entry.remoteOnly) continue;
        const path = pathByContentKey.get(key);
        if (path && entry.asset.src) pathBySrc.set(entry.asset.src, path);
    }

    return {
        files,
        pathBySrc,
        pathById,
        discoveredCount: normalized.length,
        uniqueCount: files.length,
    };
}

/** The deterministic content key for dedup. */
function contentKey(entry: { data?: Uint8Array; text?: string; remoteOnly?: boolean; asset: Asset }): string {
    if (entry.data) return `b:${sha256Hex(entry.data)}`;
    if (entry.text) return `t:${sha256HexOfString(entry.text)}`;
    return `r:${entry.asset.src}`;
}

/** Resolve the file extension for an asset (mimeType → URL → existing). */
function resolveExtension(asset: Asset, entry: { mimeType?: string; data?: Uint8Array; text?: string }): string {
    const mime = entry.mimeType ?? asset.mimeType;
    if (mime) {
        const byMime = EXTENSION_BY_MIME[mime.toLowerCase()];
        if (byMime) return byMime;
    }
    const urlMatch = /\.([a-zA-Z0-9]+)(?:\?.*)?$/.exec(asset.src);
    if (urlMatch) return urlMatch[1].toLowerCase();
    if (asset.extension) return asset.extension;
    return asset.type === 'svg' || asset.type === 'icon' ? 'svg' : 'png';
}

/**
 * The deterministic base file name (no extension).
 *
 * Prefers the asset's own name; falls back to the last URL path segment so
 * unnamed assets still get readable, stable names.
 */
function resolveBaseName(asset: Asset): string {
    const sanitized = sanitizeFileName(asset.name || '');
    if (sanitized && !/^asset_[a-z0-9]+$/i.test(sanitized)) return sanitized;

    const urlBase = urlBaseName(asset.src);
    if (urlBase) return urlBase;
    return sanitizeFileName(asset.name || '') || 'asset';
}

/** The last path segment of a URL without its extension. */
function urlBaseName(src: string): string | undefined {
    if (!src || src.startsWith('data:')) return undefined;
    const withoutQuery = src.split(/[?#]/)[0] ?? '';
    const segment = withoutQuery.split('/').pop() ?? '';
    const withoutExt = segment.replace(/\.[a-zA-Z0-9]+$/, '');
    const sanitized = sanitizeFileName(decodeURIComponent(withoutExt));
    return sanitized || undefined;
}

/**
 * The output directory for an asset type.
 *
 * Everything lands under `public/` so Vite copies it VERBATIM into the
 * production build (a runtime-string `<img src>` / `url()` reference is not
 * bundled or rewritten — the file must physically ship in `dist/`). Code
 * references resolve to absolute `/assets/...` / `/fonts/...` URLs, which the
 * dev server and the built app both serve from the project root. This is the
 * same layout the fonts registry already uses (`public/fonts` + `/fonts/...`).
 */
function assetDirectory(type: Asset['type']): string {
    switch (type) {
        case 'font':
            return 'public/fonts';
        case 'icon':
            return 'public/assets/icons';
        case 'video':
            return 'public/assets/videos';
        default:
            return 'public/assets/images';
    }
}

/** Decode a `data:` URI into bytes + mime type (base64 or URL-encoded text). */
export function decodeDataUri(uri: string): { mimeType: string; data: Uint8Array } | undefined {
    const match = /^data:([^;,]*)?(;base64)?,(.*)$/s.exec(uri);
    if (!match) return undefined;
    const mimeType = match[1] || 'application/octet-stream';
    const isBase64 = Boolean(match[2]);
    const payload = match[3] ?? '';
    try {
        if (isBase64) {
            const binary = atob(payload);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) {
                bytes[i] = binary.charCodeAt(i);
            }
            return { mimeType, data: bytes };
        }
        const text = decodeURIComponent(payload);
        return { mimeType, data: utf8Encode(text) };
    } catch {
        return undefined;
    }
}

/** Convert registry files into project VirtualFiles (placeholder note for remote-only). */
export function registryToVirtualFiles(files: AssetFile[]): VirtualFile[] {
    const result: VirtualFile[] = [];
    for (const file of files) {
        if (file.data) {
            result.push({ path: file.path, content: '', binary: true, data: file.data });
        } else if (file.text) {
            result.push({ path: file.path, content: file.text });
        } else if (file.remoteOnly) {
            // No local bytes: keep a discoverable placeholder note in the ZIP.
            const placeholderPath = file.path.replace(/\.[^.]+$/, '.placeholder.txt');
            result.push({
                path: placeholderPath,
                content: `Remote asset: ${file.asset.src}\nNo local bytes were available from the Framer Plugin API, so this file could not be exported. Replace it with the real asset to make the project fully self-contained.\n`,
            });
        }
        // Degenerate entries (no content at all) are skipped.
    }
    return result;
}
