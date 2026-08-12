/**
 * Production-build asset test (opt-in).
 *
 * Builds a generated React project that references LOCAL image bytes (a
 * standalone image, a frame's image fill, and per-breakpoint responsive
 * alternates) and asserts the PRODUCTION build ships them: every `/assets/...`
 * URL appearing in `dist/index.html` and the emitted `dist/assets/*` bundles
 * resolves to a real file under `dist/`. This is the regression guard for the
 * public/ asset layout — a relative `../assets/...` reference would resolve
 * outside `dist/` and 404 once built.
 *
 * Skipped unless `VR_BROWSER=1` is set (needs pnpm + a working install cache
 * to build the generated project; no Chrome required for this one).
 */

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { FramerDocument } from '@framer/compiler-parser';

import { buildGeneratedProject, solidPng } from './helpers';

const enabled = process.env.VR_BROWSER === '1';

/** Every `/assets/...` URL referenced in a text blob (no query/hash). */
function assetUrlsIn(text: string): string[] {
    return [...text.matchAll(/\/assets\/[^"')\s]+/g)].map((m) => m[0].split(/[?#]/)[0]);
}

describe.skipIf(!enabled)('production build ships assets', () => {
    it('every /assets/... URL in dist/index.html and the JS bundle resolves to a real dist file', async () => {
        const base = solidPng([220, 40, 40]);
        const tablet = solidPng([40, 180, 60]);
        const desktop = solidPng([40, 60, 220]);
        const fill = solidPng([200, 200, 30]);

        const document: FramerDocument = {
            id: 'doc_dist_assets',
            name: 'Dist Assets',
            breakpoints: [
                { name: 'tablet', minWidth: 768 },
                { name: 'desktop', minWidth: 1024 },
            ],
            nodes: [
                {
                    id: 'photo',
                    type: 'Image',
                    name: 'Photo',
                    frame: { x: 0, y: 0, width: 300, height: 200 },
                    layout: { strategy: 'auto' },
                    style: {},
                    image: {
                        src: 'assets/images/photo.png',
                        name: 'photo',
                        alt: 'A',
                        mimeType: 'image/png',
                        data: base,
                    },
                    children: [],
                    responsive: {
                        tablet: {
                            image: {
                                src: 'assets/images/photo-tablet.png',
                                name: 'photo-tablet',
                                mimeType: 'image/png',
                                data: tablet,
                            },
                        },
                        desktop: {
                            image: {
                                src: 'assets/images/photo-desktop.png',
                                name: 'photo-desktop',
                                mimeType: 'image/png',
                                data: desktop,
                            },
                        },
                    },
                },
                {
                    id: 'banner',
                    type: 'Frame',
                    name: 'Banner',
                    frame: { x: 0, y: 0, width: 400, height: 120 },
                    layout: { strategy: 'auto' },
                    style: {
                        fills: [
                            {
                                type: 'image',
                                image: {
                                    src: 'assets/images/banner.png',
                                    name: 'banner',
                                    mimeType: 'image/png',
                                    data: fill,
                                },
                            },
                        ],
                    },
                    children: [],
                },
            ],
        };

        const runDir = join(process.cwd(), '.vr-dist-assets-test', 'DistAssets');
        const { distDir } = await buildGeneratedProject(document, 'DistAssets', runDir);

        // 1. The build actually copied the images into dist/.
        const copied = join(distDir, 'assets', 'images', 'photo.png');
        expect(existsSync(copied), 'photo.png exists in dist/assets/images').toBe(true);
        expect(await readFile(copied)).toEqual(base);

        // 2. Collect every emitted file that can carry asset URLs.
        const bundleDir = join(distDir, 'assets');
        const entries: string[] = [];
        const walk = async (dir: string): Promise<void> => {
            for (const entry of await readdir(dir, { withFileTypes: true })) {
                const full = join(dir, entry.name);
                if (entry.isDirectory()) await walk(full);
                else entries.push(full);
            }
        };
        await walk(bundleDir);

        const html = await readFile(join(distDir, 'index.html'), 'utf8');
        const bundleTexts = await Promise.all(entries.map((file) => readFile(file, 'utf8')));
        const blobs = [html, ...bundleTexts];

        // 3. Every referenced /assets/... URL must resolve to a real file.
        const urls = [...new Set(blobs.flatMap((blob) => assetUrlsIn(blob)))];
        expect(urls.length).toBeGreaterThan(0);
        for (const url of urls) {
            const target = resolve(distDir, url.slice(1));
            expect(existsSync(target), `dist resolves /${url.slice(1)}`).toBe(true);
            // The URL must resolve INSIDE dist — never escape it (the old
            // relative ../assets/... references resolved outside dist and
            // 404'd in production).
            expect(target.startsWith(resolve(distDir) + sep), `/${url.slice(1)} lives under dist/`).toBe(true);
        }

        // 4. Spot-check the responsive alternates + the fill are present.
        for (const name of ['photo-tablet.png', 'photo-desktop.png', 'banner.png']) {
            expect(existsSync(join(distDir, 'assets', 'images', name)), `${name} shipped to dist`).toBe(true);
        }
    }, 600_000);
});
