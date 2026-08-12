/**
 * Browser end-to-end test (opt-in).
 *
 * Runs real Chrome against the reference page and the generated React
 * project. Two scenarios:
 *
 *   1. The FULL visual-regression suite against the fat fixture — screenshots
 *      at desktop/tablet/mobile, compared pixel-by-pixel.
 *   2. Responsive image behavior with REAL local image bytes: the browser must
 *      select the correct `<picture><source media>` per viewport, keep
 *      object-fit on the `<img>`, swap a frame's `background-image` per tier,
 *      hide/restore a node per tier, and render the tier's actual pixels —
 *      identically on the generated app and the reference page.
 *
 * Skipped unless `VR_BROWSER=1` is set (the suite needs a Chrome install and
 * an npm install + vite build inside the generated project, so it is not
 * part of the default vitest run).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import puppeteer from 'puppeteer-core';

import { fatFixtureDocument, type FramerDocument } from '@framer/compiler-parser';

import { findChromeExecutable } from '../src/browser/screenshot';
import { DEFAULT_BREAKPOINT_TOLERANCES } from '../src/compare/tolerance';
import { renderReferencePage } from '../src/reference/render';
import { runVisualRegression } from '../src/run';
import { serveDirectory } from '../src/serve';

import { buildGeneratedProject, solidPng } from './helpers';

const enabled = process.env.VR_BROWSER === '1';

/** The probe data collected for one page element. */
interface ElementProbe {
    /** The element's className (App anchor classes land here merged). */
    className: string;
    /** The img's currentSrc (the `<picture>`-selected source). */
    currentSrc: string;
    /** The computed object-fit (img only). */
    fit: string;
    /** The computed display (display: none when hidden at a tier). */
    display: string;
    /** The computed background-image (frame image-fill swap; 'none' when removed). */
    backgroundImage: string;
    /** The computed background-size (an object-fit change on a fill swap). */
    backgroundSize: string;
    /** Top-left pixel of the img's REAL rendered bytes. */
    pixel: [number, number, number] | null;
    /** Top-left pixel of the frame's active background-image bytes. */
    bgPixel: [number, number, number] | null;
}

/**
 * Probe a page in a real browser. `targets` maps a label to the section's
 * index among the page's `<main>` children (both pages render document nodes
 * as direct main children in order). Each element is matched by a token
 * present in ALL of its src/background-image URLs (e.g. 'photo' matches
 * photo.png AND photo-tablet.png), falling back to its main-child index when
 * no URL matches (a REMOVED fill has no background-image URL to match).
 */
async function probePage(
    url: string,
    width: number,
    targets: Record<string, number>,
): Promise<Record<string, ElementProbe>> {
    const executablePath = findChromeExecutable();
    const browser = await puppeteer.launch({
        executablePath,
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
    });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width, height: 800 });
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });
        await new Promise((resolve) => setTimeout(resolve, 400));

        return await page.evaluate(async (targets) => {
            const mainRoot = document.querySelector('main');
            const pick = (stem: string, index: number): Element | null => {
                const all = Array.from(document.querySelectorAll('img, div, section, a'));
                const byUrl =
                    all.find((el) => {
                        if (el.tagName === 'IMG') {
                            const src = (el as HTMLImageElement).getAttribute('src') ?? '';
                            if (src.includes(stem)) return true;
                        }
                        return getComputedStyle(el).backgroundImage.includes(stem);
                    }) ?? null;
                if (byUrl) return byUrl;
                // A removed fill has no URL to match — fall back to the
                // section's position among the page's main children.
                return mainRoot?.children[index] ?? null;
            };
            const readPixel = (el: HTMLImageElement): [number, number, number] | null => {
                const canvas = document.createElement('canvas');
                canvas.width = el.naturalWidth;
                canvas.height = el.naturalHeight;
                const ctx = canvas.getContext('2d');
                if (!ctx) return null;
                ctx.drawImage(el, 0, 0);
                const d = ctx.getImageData(0, 0, 1, 1).data;
                return [d[0], d[1], d[2]];
            };
            const loadUrl = (urlText: string): Promise<HTMLImageElement> =>
                new Promise((resolveImage) => {
                    const img = new Image();
                    img.onload = () => resolveImage(img);
                    img.onerror = () => resolveImage(img);
                    img.src = urlText;
                });

            const sample = async (stem: string, index: number): Promise<ElementProbe> => {
                const el = pick(stem, index);
                const empty: ElementProbe = {
                    className: '',
                    currentSrc: '',
                    fit: '',
                    display: '',
                    backgroundImage: '',
                    backgroundSize: '',
                    pixel: null,
                    bgPixel: null,
                };
                if (!el) return empty;
                const style = getComputedStyle(el);
                const backgroundImage = style.backgroundImage;
                const probe: ElementProbe = {
                    ...empty,
                    className: el.className || '',
                    display: style.display,
                    backgroundImage,
                    backgroundSize: style.backgroundSize,
                };

                if (el.tagName === 'IMG') {
                    const img = el as HTMLImageElement;
                    probe.currentSrc = img.currentSrc;
                    probe.fit = style.objectFit;
                    if (img.complete && img.naturalWidth > 0) probe.pixel = readPixel(img);
                }
                const bgMatch = backgroundImage.match(/url\("?([^")]+)"?\)/);
                if (bgMatch && !backgroundImage.includes('none')) {
                    const img = await loadUrl(new URL(bgMatch[1], location.href).href);
                    if (img.complete && img.naturalWidth > 0) probe.bgPixel = readPixel(img);
                }
                return probe;
            };

            // Poll until every target has produced at least one pixel signal
            // (the tier's image actually rendered), a removed fill (no bg),
            // or a hidden element — or the budget expires.
            const start = Date.now();
            let results: Record<string, ElementProbe> = {};
            while (Date.now() - start < 8000) {
                results = {};
                for (const [stem, index] of Object.entries(targets)) results[stem] = await sample(stem, index);
                const ready = Object.keys(targets).every(
                    (stem) =>
                        results[stem].pixel !== null ||
                        results[stem].bgPixel !== null ||
                        results[stem].display === 'none' ||
                        results[stem].backgroundImage === 'none',
                );
                if (ready) break;
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            return results;
        }, targets);
    } finally {
        await browser.close();
    }
}

describe.skipIf(!enabled)('visual regression (browser)', () => {
    it('reference vs generated stays within per-breakpoint tolerance', async () => {
        const report = await runVisualRegression({
            document: fatFixtureDocument,
            projectName: 'FatFixture',
            outDir: '.vr-browser-test',
            breakpoints: DEFAULT_BREAKPOINT_TOLERANCES,
        });

        for (const bp of report.breakpoints) {
            console.log(
                `  ${bp.name}@${bp.width}px: diff ${(bp.diffRatio * 100).toFixed(2)}% (tol ${(bp.tolerance * 100).toFixed(1)}%) ${bp.dimensionsMatch ? 'dims match' : `HEIGHT DRIFT ${bp.referenceHeight}→${bp.generatedHeight}`}`,
            );
        }

        expect(report.allPassed).toBe(true);
    }, 600_000);

    it('swaps <picture> sources, frame image-fills, and hide/restore per tier in a real browser', async () => {
        // REAL solid-color PNGs (local bytes, not remote URLs): the browser
        // must render the tier's actual pixels, not just change a string.
        const base = solidPng([220, 40, 40]);
        const tablet = solidPng([40, 180, 60]);
        const desktop = solidPng([40, 60, 220]);
        const fill = solidPng([200, 200, 30]);
        const fillTablet = solidPng([250, 120, 200]);
        const fillDesktop = solidPng([120, 200, 250]);
        const badge = solidPng([90, 90, 90]);

        const document: FramerDocument = {
            id: 'doc_swap_browser',
            name: 'Swap Browser',
            breakpoints: [
                { name: 'tablet', minWidth: 768 },
                { name: 'desktop', minWidth: 1024 },
                { name: 'wide', minWidth: 1440 },
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
                    responsive: {
                        tablet: {
                            image: {
                                src: 'assets/images/banner-tablet.png',
                                name: 'banner-tablet',
                                mimeType: 'image/png',
                                data: fillTablet,
                            },
                        },
                        // An object-fit change on a fill swap: the tier must
                        // re-assert background-size (contain, not cover).
                        desktop: {
                            image: {
                                src: 'assets/images/banner-desktop.png',
                                name: 'banner-desktop',
                                mimeType: 'image/png',
                                data: fillDesktop,
                                objectFit: 'contain',
                            },
                        },
                        // `src: ''` REMOVES the fill at this tier — the
                        // frame must render background-image: none.
                        wide: {
                            image: { src: '', name: 'banner-wide' },
                        },
                    },
                },
                {
                    id: 'badge',
                    type: 'Image',
                    name: 'Badge',
                    frame: { x: 0, y: 0, width: 60, height: 30 },
                    layout: { strategy: 'auto' },
                    style: {},
                    image: {
                        src: 'assets/images/badge.png',
                        name: 'badge',
                        alt: 'B',
                        mimeType: 'image/png',
                        data: badge,
                    },
                    children: [],
                    // Hidden from tablet up, RESTORED at desktop — both
                    // renderers must hide (display: none) and re-show it.
                    responsive: {
                        tablet: { visible: false },
                        desktop: { visible: true },
                    },
                },
            ],
        };

        // 1. Compile + write the generated project, then build it. The
        //    images land in public/assets/images and Vite copies them into
        //    dist/, so the built app serves REAL local bytes.
        const runDir = join(process.cwd(), '.vr-browser-swap-test', 'SwapBrowser');
        const referenceDir = join(runDir, 'reference');
        const { distDir } = await buildGeneratedProject(document, 'SwapBrowser', runDir);

        // 2. Reference page + its local images (served same-origin, so the
        //    browser loads the real bytes there too).
        await mkdir(join(referenceDir, 'assets', 'images'), { recursive: true });
        await writeFile(join(referenceDir, 'index.html'), renderReferencePage(document));
        const refImages: Array<[string, Buffer]> = [
            ['photo.png', base],
            ['photo-tablet.png', tablet],
            ['photo-desktop.png', desktop],
            ['banner.png', fill],
            ['banner-tablet.png', fillTablet],
            ['banner-desktop.png', fillDesktop],
            ['badge.png', badge],
        ];
        for (const [name, bytes] of refImages) {
            await writeFile(join(referenceDir, 'assets', 'images', name), bytes);
        }

        // 3. Serve both pages and probe every tier in a real browser.
        const servers = [await serveDirectory(distDir), await serveDirectory(referenceDir)];
        try {
            interface BannerCase {
                file: string;
                color: [number, number, number] | null;
                size: 'cover' | 'contain';
                removed: boolean;
            }
            const cases: Array<{
                width: number;
                photo: { file: string; color: [number, number, number] };
                banner: BannerCase;
                badgeVisible: boolean;
            }> = [
                {
                    width: 375,
                    photo: { file: 'photo.png', color: [220, 40, 40] },
                    banner: { file: 'banner.png', color: [200, 200, 30], size: 'cover', removed: false },
                    badgeVisible: true,
                },
                {
                    width: 768,
                    photo: { file: 'photo-tablet.png', color: [40, 180, 60] },
                    banner: { file: 'banner-tablet.png', color: [250, 120, 200], size: 'cover', removed: false },
                    badgeVisible: false,
                },
                {
                    width: 1024,
                    photo: { file: 'photo-desktop.png', color: [40, 60, 220] },
                    banner: { file: 'banner-desktop.png', color: [120, 200, 250], size: 'contain', removed: false },
                    badgeVisible: true,
                },
                {
                    width: 1440,
                    photo: { file: 'photo-desktop.png', color: [40, 60, 220] },
                    // The wide tier REMOVES the fill: background-image: none.
                    banner: { file: '', color: null, size: 'cover', removed: true },
                    badgeVisible: true,
                },
            ];
            for (const c of cases) {
                for (const [label, server] of [
                    ['generated', servers[0]],
                    ['reference', servers[1]],
                ] as const) {
                    const probe = await probePage(server.url, c.width, { photo: 0, banner: 1, badge: 2 });
                    const at = `${label} @${c.width}`;

                    // Standalone img: <picture> picks the tier's source.
                    expect(probe.photo.currentSrc, `${at}: <picture> selected source`).toContain(
                        `/assets/images/${c.photo.file}`,
                    );
                    expect(probe.photo.fit, `${at}: object-fit`).toBe('cover');
                    expect(probe.photo.pixel, `${at}: rendered pixel`).not.toBeNull();
                    for (let ch = 0; ch < 3; ch += 1) {
                        expect(
                            Math.abs((probe.photo.pixel as [number, number, number])[ch] - c.photo.color[ch]),
                            `${at}: photo channel ${ch}`,
                        ).toBeLessThanOrEqual(10);
                    }

                    // Frame image-fill: the active background-image is the
                    // tier's file and renders the tier's real bytes. An
                    // object-fit change re-asserts background-size; a
                    // removed fill becomes `none`.
                    if (c.banner.removed) {
                        expect(probe.banner.backgroundImage, `${at}: background removed`).toBe('none');
                        expect(probe.banner.bgPixel, `${at}: no background pixel`).toBeNull();
                    } else {
                        expect(probe.banner.backgroundImage, `${at}: background-image`).toContain(c.banner.file);
                        expect(probe.banner.backgroundSize, `${at}: background-size`).toBe(c.banner.size);
                        expect(probe.banner.bgPixel, `${at}: background pixel`).not.toBeNull();
                        for (let ch = 0; ch < 3; ch += 1) {
                            expect(
                                Math.abs(
                                    (probe.banner.bgPixel as [number, number, number])[ch] -
                                        (c.banner.color as [number, number, number])[ch],
                                ),
                                `${at}: banner channel ${ch}`,
                            ).toBeLessThanOrEqual(10);
                        }
                    }

                    // Hide/restore: display none at the hiding tier only.
                    if (c.badgeVisible) {
                        expect(probe.badge.display, `${at}: badge visible`).not.toBe('none');
                        expect(probe.badge.currentSrc, `${at}: badge source`).toContain('/assets/images/badge.png');
                    } else {
                        expect(probe.badge.display, `${at}: badge hidden`).toBe('none');
                    }

                    // App passes a section anchor className; every section
                    // root must carry it MERGED with its baked classes.
                    if (label === 'generated') {
                        for (const [stem, anchor] of [
                            ['photo', 'section-photo'],
                            ['banner', 'section-banner'],
                            ['badge', 'section-badge'],
                        ] as const) {
                            expect(probe[stem].className, `${at}: ${stem} anchor class`).toContain(anchor);
                            expect(probe[stem].className, `${at}: ${stem} baked classes survive`).not.toBe(anchor);
                        }
                    }
                }
            }
        } finally {
            await Promise.all(servers.map((server) => server.close()));
        }
    }, 600_000);
});
