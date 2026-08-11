/**
 * Asset registry: complete, deduplicated, collision-safe asset extraction.
 */

import { describe, expect, it } from 'vitest';

import type { Asset, DesignDocument } from '@framer/compiler-ast';
import { buildAssets, findFile, generateProject } from '@framer/compiler-generators';

import { compileFramerDocument } from '../src/index';
import { parseFramerDocument } from '@framer/compiler-parser';

/** Build a minimal document with the given assets. */
function documentWithAssets(assets: Asset[], nodes: DesignDocument['nodes'] = []): DesignDocument {
    return {
        version: '1.0.0',
        name: 'Assets Doc',
        nodes,
        assets,
        fonts: [],
        breakpoints: [],
    };
}

/** A helper asset factory. */
function asset(partial: Partial<Asset> & { src: string }): Asset {
    return {
        id: `asset_${partial.src}`,
        type: 'image',
        name: partial.src.split('/').pop() ?? 'image',
        fileName: partial.src.split('/').pop() ?? 'image',
        extension: 'png',
        ...partial,
    } as Asset;
}

describe('asset registry', () => {
    it('deduplicates identical bytes under different names into one file', () => {
        const bytes = new TextEncoder().encode('the same pixels');
        const doc = documentWithAssets([
            asset({ src: 'https://cdn.test/hero.png', name: 'hero', data: bytes }),
            asset({ src: 'https://cdn.test/hero-copy.png', name: 'hero-copy', data: bytes }),
            asset({ src: 'https://cdn.test/hero-final.png', name: 'hero-final', data: bytes }),
        ]);
        const registry = buildAssets(doc);

        expect(registry.uniqueCount).toBe(1);
        expect(registry.discoveredCount).toBe(3);
        expect(registry.files[0].path).toBe('src/assets/images/hero.png');
        // Every source URL resolves to the same physical file.
        for (const src of ['https://cdn.test/hero.png', 'https://cdn.test/hero-copy.png', 'https://cdn.test/hero-final.png']) {
            expect(registry.pathBySrc.get(src)).toBe('src/assets/images/hero.png');
        }
    });

    it('keeps distinct bytes even under the same name (collision-safe suffix)', () => {
        const doc = documentWithAssets([
            asset({ src: 'https://cdn.test/a.png', name: 'photo', data: new TextEncoder().encode('bytes-a') }),
            asset({ src: 'https://cdn.test/b.png', name: 'photo', data: new TextEncoder().encode('bytes-b') }),
        ]);
        const registry = buildAssets(doc);

        expect(registry.uniqueCount).toBe(2);
        const paths = registry.files.map((file) => file.path);
        expect(paths).toContain('src/assets/images/photo.png');
        expect(paths).toContain('src/assets/images/photo-2.png');
        expect(registry.pathBySrc.get('https://cdn.test/a.png')).toBe('src/assets/images/photo.png');
        expect(registry.pathBySrc.get('https://cdn.test/b.png')).toBe('src/assets/images/photo-2.png');
    });

    it('derives deterministic names from URLs for unnamed assets', () => {
        const doc = documentWithAssets([
            asset({ src: 'https://cdn.test/icons/arrow-right.svg', type: 'svg', data: new TextEncoder().encode('<svg/>'), name: 'asset_1a2b3c' }),
        ]);
        const registry = buildAssets(doc);

        // A generated asset_… name is treated as unnamed → URL-derived base.
        expect(registry.files[0].path).toBe('src/assets/images/arrow-right.svg');
    });

    it('preserves asset types via mimeType and extension', () => {
        const doc = documentWithAssets([
            asset({ src: 'https://cdn.test/video', type: 'video', name: 'demo', data: new TextEncoder().encode('mp4'), mimeType: 'video/mp4' }),
            asset({ src: 'https://cdn.test/font.woff2', type: 'font', name: 'Inter', data: new TextEncoder().encode('font'), mimeType: 'font/woff2' }),
            asset({ src: 'https://cdn.test/pic', type: 'image', name: 'pic', data: new TextEncoder().encode('png'), mimeType: 'image/png' }),
        ]);
        const registry = buildAssets(doc);

        expect(registry.files.map((file) => file.path)).toContain('src/assets/videos/demo.mp4');
        expect(registry.files.map((file) => file.path)).toContain('public/fonts/Inter.woff2');
        expect(registry.files.map((file) => file.path)).toContain('src/assets/images/pic.png');
    });

    it('decodes data URIs into real files', () => {
        // 1x1 red PNG base64.
        const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const doc = documentWithAssets([asset({ src: dataUri, name: 'pixel' })]);
        const registry = buildAssets(doc);

        expect(registry.uniqueCount).toBe(1);
        expect(registry.files[0].path).toBe('src/assets/images/pixel.png');
        expect(registry.files[0].data?.byteLength).toBeGreaterThan(0);
        expect(registry.pathBySrc.get(dataUri)).toBe('src/assets/images/pixel.png');
    });

    it('flags remote-only assets (no local bytes) without writing broken references', () => {
        const doc = documentWithAssets([asset({ src: 'https://cdn.test/hero.png', name: 'hero' })]);
        const registry = buildAssets(doc);

        expect(registry.files[0].remoteOnly).toBe(true);
        expect(registry.pathBySrc.has('https://cdn.test/hero.png')).toBe(false);
    });

    it('preserves source bytes through the parser into the AST registry', () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);
        const document = parseFramerDocument({
            id: 'doc_bytes',
            name: 'Bytes',
            nodes: [{
                id: 'img',
                type: 'Image',
                name: 'Hero',
                frame: { x: 0, y: 0, width: 10, height: 10 },
                image: { src: 'https://cdn.test/hero.webp', name: 'hero', data: bytes, mimeType: 'image/webp' },
                children: [],
            }],
        });

        expect(document.nodes[0].type).toBe('image');
        expect(document.nodes[0].type === 'image' && document.nodes[0].asset.data).toEqual(bytes);
        expect(document.assets[0].data).toEqual(bytes);
        expect(document.assets[0].mimeType).toBe('image/webp');
    });

    it('writes every referenced asset into the generated project', async () => {
        const result = await compileFramerDocument({
            id: 'doc_assets',
            name: 'Assets',
            nodes: [
                {
                    id: 'img_hero',
                    type: 'Image',
                    name: 'Hero Image',
                    frame: { x: 0, y: 0, width: 100, height: 100 },
                    layout: { strategy: 'auto' },
                    style: {},
                    image: {
                        src: 'https://cdn.test/hero.png',
                        name: 'hero',
                        data: new TextEncoder().encode('png-bytes'),
                        objectFit: 'cover',
                    },
                    children: [],
                },
            ],
        }, { projectName: 'assets-demo' });

        // The image file is written.
        expect(findFile({ name: 'AssetsDemo', files: result.files, nodes: result.nodes }, 'src/assets/images/hero.png')).toBeDefined();

        // The section references the LOCAL path, never the remote URL.
        const section = result.files.find((f) => f.path === 'src/sections/HeroImage.tsx');
        expect(section).toBeDefined();
        expect(section!.content).toContain('src="../assets/images/hero.png"');
        expect(section!.content).not.toContain('https://cdn.test/hero.png');
    });

    it('emits local @font-face files when font bytes are available', () => {
        const bytes = new Uint8Array([9, 8, 7]);
        const fontProject = generateProject({
            ...documentWithAssets([]),
            fonts: [{
                family: 'Acme Sans',
                weight: 600,
                style: 'italic',
                sources: [{ url: 'https://cdn.test/acme.woff2', format: 'woff2', data: bytes }],
            }],
        }, { projectName: 'fonts' });
        const css = findFile(fontProject, 'src/styles/fonts.css');
        expect(css?.content).toContain("font-family: 'Acme Sans'");
        expect(css?.content).toContain('font-weight: 600');
        expect(css?.content).toContain('font-style: italic');
        expect(findFile(fontProject, 'public/fonts/Acme-Sans-600-italic.woff2')?.data).toEqual(bytes);
        expect(findFile(fontProject, 'index.html')?.content).not.toContain('fonts.googleapis.com');
    });

    it('warns for fonts with no downloadable source instead of substituting', () => {
        const fontProject = generateProject({
            ...documentWithAssets([]),
            fonts: [{
                family: 'Custom Display',
                weight: 400,
                style: 'normal',
                sources: [],
            }],
        }, { projectName: 'fonts' });

        // No @font-face is fabricated for a font whose source API exposed no
        // file — and the loss is reported, never silent.
        const css = findFile(fontProject, 'src/styles/fonts.css');
        expect(css?.content ?? '').not.toContain('Custom Display');
        expect(fontProject.warnings?.some(
            (w) => w.stage === 'fonts' && w.message.includes('Custom Display') && w.message.includes('no downloadable file'),
        )).toBe(true);
    });
});
