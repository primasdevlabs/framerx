/**
 * Font registry.
 *
 * Fonts are compilation resources, not CSS guesses. The registry preserves the
 * family/weight/style tuple from the source model, writes accessible bytes to
 * the project, and reports every source that cannot be made self-contained.
 */

import type { DesignDocument, FontAsset } from '@framer/compiler-ast';
import { sanitizeFileName, sha256Hex, sha256HexOfString } from '@framer/compiler-shared';

import type { VirtualFile } from '../types';

export interface FontFile {
    font: FontAsset;
    source: FontAsset['sources'][number];
    path: string;
    data?: Uint8Array;
    remoteOnly?: boolean;
}

export interface FontRegistry {
    /** Unique physical font files, deduplicated by bytes/URL. */
    files: FontFile[];
    /** Every source tuple, including aliases sharing one physical file. */
    faces: FontFile[];
    css: string;
    warnings: Array<{ stage: string; message: string }>;
    discoveredCount: number;
    exportedCount: number;
}

/** Build the font registry from the normalized document. */
export function buildFontRegistry(document: DesignDocument): FontRegistry {
    const files: FontFile[] = [];
    const faces: FontFile[] = [];
    const warnings: Array<{ stage: string; message: string }> = [];
    const seen = new Map<string, FontFile>();
    const usedNames = new Map<string, number>();
    let discoveredCount = 0;

    const inferredFromNodeStyles = document.metadata?.custom?.fontSources === 'node-inferred';
    for (const font of document.fonts) {
        if (font.sources.length === 0) {
            if (inferredFromNodeStyles) continue;
            warnings.push({
                stage: 'fonts',
                message: `Font ${font.family} ${font.weight} ${font.style} was discovered but the source API exposed no downloadable file; no substitute was generated.`,
            });
            continue;
        }

        for (const source of font.sources) {
            discoveredCount += 1;
            const key = source.data
                ? `bytes:${sha256Hex(source.data)}`
                : source.url
                    ? `url:${source.url}`
                    : `font:${font.family}:${font.weight}:${font.style}:${source.format}`;
            const existing = seen.get(key);
            if (existing) {
                faces.push({ ...existing, font, source, data: existing.data, remoteOnly: existing.remoteOnly });
                continue;
            }

            const base = sanitizeFileName(`${font.family}-${font.weight}-${font.style}`) || 'font';
            const count = usedNames.get(base) ?? 0;
            usedNames.set(base, count + 1);
            const fileName = `${base}${count === 0 ? '' : `-${count + 1}`}.${source.format}`;
            const file: FontFile = {
                font,
                source,
                path: `public/fonts/${fileName}`,
                data: source.data,
                remoteOnly: !source.data,
            };
            files.push(file);
            faces.push(file);
            seen.set(key, file);

            if (!source.data) {
                warnings.push({
                    stage: 'fonts',
                    message: `Font ${font.family} ${font.weight} ${font.style} has no local bytes; the exported @font-face keeps its source URL (${source.url || 'missing URL'}) and remains network-dependent.`,
                });
            }
        }
    }

    const cssLines: string[] = [];
    for (const file of faces) {
        const { font, source } = file;
        const src = file.data
            ? `url('/fonts/${file.path.slice('public/fonts/'.length)}') format('${source.format}')`
            : `url('${escapeCssUrl(source.url)}') format('${source.format}')`;
        cssLines.push(
            `@font-face {\n    font-family: '${escapeCss(font.family)}';\n    src: ${src};\n    font-weight: ${font.weight};\n    font-style: ${font.style};\n    font-display: swap;\n}`,
        );
    }

    return {
        files,
        faces,
        css: cssLines.length > 0 ? `${cssLines.join('\n\n')}\n` : '',
        warnings,
        discoveredCount,
        exportedCount: files.filter((file) => Boolean(file.data)).length,
    };
}

/** Convert registry entries to ZIP/project files. */
export function fontRegistryToVirtualFiles(registry: FontRegistry): VirtualFile[] {
    return registry.files
        .filter((file) => file.data)
        .map((file) => ({ path: file.path, content: '', binary: true, data: file.data }));
}

function escapeCss(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeCssUrl(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Stable fingerprint useful to callers comparing registry output. */
export function fontRegistryFingerprint(registry: FontRegistry): string {
    return sha256HexOfString(registry.files.map((file) => `${file.path}:${file.source.url}`).join('|'));
}
