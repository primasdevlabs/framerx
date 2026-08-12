/**
 * Two-tier replica image swap comparison.
 *
 * A replica's image overrides fold into its primary's responsive behavior
 * (`node.responsive.<tier>.image` — the fold itself is covered by the plugin
 * package's replica-folding tests; this package's boundary starts at the fold
 * OUTPUT). The reference renderer emits the swap as a
 * `<picture><source media>` element: the <img> keeps its src, box, and class
 * at every tier, and each source's media query is the document's own
 * breakpoint.
 *
 * This test renders that page, selects the active source with real browser
 * `<picture>` semantics (first matching `<source media>`, else the <img>
 * fallback) at base / tablet / desktop viewports, rasterizes each viewport,
 * and proves — for EVERY pair of tiers — that the only differing pixels are
 * the image node's box. The swap is confined to the swapped image region.
 */

import { describe, expect, it } from 'vitest';

import { compareImages } from '../src/compare/compare';
import type { RgbaImage } from '../src/compare/png';
import { renderReferencePage } from '../src/reference/render';

/**
 * The rendered `<picture>` element. Anchored on the element itself: the
 * page's stylesheet comment also contains the literal `<picture>` text, which
 * a naive `<picture>…</picture>` match would grab first.
 */
function extractPicture(html: string): string | undefined {
    return /<picture>\n\s*<source[\s\S]*?<\/picture>/.exec(html)?.[0];
}

/** Browser <picture> selection: first <source> whose media matches wins. */
function selectPictureSrc(pictureHtml: string, viewportWidth: number): string {
    const sourceRe = /<source media="\(min-width:\s*(\d+)px\)"\s+srcset="([^"]+)"\s*\/>/g;
    let match: RegExpExecArray | null;
    while ((match = sourceRe.exec(pictureHtml)) !== null) {
        if (viewportWidth >= Number(match[1])) return match[2];
    }
    const imgSrc = /<img[^>]*src="([^"]+)"/.exec(pictureHtml)?.[1];
    return imgSrc ?? '';
}

/** The width/height the reference stylesheet assigns to a node's class. */
function cssSize(html: string, className: string): { width: number; height: number } {
    const block = new RegExp(`\\.${className}\\s*\\{[^}]*}`).exec(html)?.[0] ?? '';
    const width = Number(/\bwidth:\s*(\d+)px/.exec(block)?.[1] ?? 0);
    const height = Number(/\bheight:\s*(\d+)px/.exec(block)?.[1] ?? 0);
    return { width, height };
}

/** A white canvas with the image box painted in a solid color. */
function rasterize(
    width: number,
    height: number,
    box: { x: number; y: number; width: number; height: number },
    color: [number, number, number],
): RgbaImage {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const off = (y * width + x) * 4;
            data[off + 3] = 255;
            const inBox = x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
            if (inBox) {
                data[off] = color[0];
                data[off + 1] = color[1];
                data[off + 2] = color[2];
            }
        }
    }
    return { width, height, data };
}

/** The bounding box of every differing pixel between two same-size rasters. */
function diffBounds(a: RgbaImage, b: RgbaImage): { left: number; top: number; right: number; bottom: number } | null {
    let left = Infinity;
    let top = Infinity;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < a.height; y += 1) {
        for (let x = 0; x < a.width; x += 1) {
            const off = (y * a.width + x) * 4;
            const delta =
                Math.abs(a.data[off] - b.data[off]) +
                Math.abs(a.data[off + 1] - b.data[off + 1]) +
                Math.abs(a.data[off + 2] - b.data[off + 2]);
            if (delta > 0) {
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
    }
    return left === Infinity ? null : { left, top, right, bottom };
}

describe('replica image swap at two tiers', () => {
    it('confines the reference-page diff to the swapped image region at every tier', () => {
        // The post-fold state of a replica that swaps the image on BOTH the
        // tablet and desktop tiers: the primary Image node carries each
        // alternate under its tier.
        const document = {
            id: 'doc_swap_tiers',
            name: 'Swap Doc',
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
                    layout: { strategy: 'auto', sizing: { widthMode: 'fixed', heightMode: 'fixed' } },
                    style: {},
                    image: { src: 'https://cdn.test/a.png', alt: 'A' },
                    responsive: {
                        tablet: { image: { src: 'https://cdn.test/b.png' } },
                        desktop: { image: { src: 'https://cdn.test/c.png' } },
                    },
                },
            ],
        };
        const html = renderReferencePage(document);
        const picture = extractPicture(html);
        expect(picture).toBeDefined();

        // The sources are emitted in DESCENDING min-width order at the
        // document's own breakpoint widths — browsers select the first
        // matching <source> in tree order, so the desktop tier must precede
        // the tablet tier or it would be shadowed.
        expect(picture!).toContain('<source media="(min-width: 1024px)" srcset="https://cdn.test/c.png" />');
        expect(picture!.indexOf('min-width: 1024px')).toBeLessThan(picture!.indexOf('min-width: 768px'));

        // Browser selection: base image until tablet, tablet image until
        // desktop, desktop image from desktop on — the boundaries are exactly
        // the document breakpoints (1023px still shows the tablet image).
        expect(selectPictureSrc(picture!, 375)).toBe('https://cdn.test/a.png');
        expect(selectPictureSrc(picture!, 767)).toBe('https://cdn.test/a.png');
        expect(selectPictureSrc(picture!, 768)).toBe('https://cdn.test/b.png');
        expect(selectPictureSrc(picture!, 1023)).toBe('https://cdn.test/b.png');
        expect(selectPictureSrc(picture!, 1024)).toBe('https://cdn.test/c.png');

        // The img's box comes from the rendered stylesheet, not an assumption.
        const { width, height } = cssSize(html, 'fx-ref-0');
        expect(width).toBe(300);
        expect(height).toBe(200);

        // Rasterize all three tiers on the same canvas: everything is
        // identical except the image box, which paints the selected source.
        const canvas = { width: 800, height: 600 };
        const box = { x: 0, y: 0, width, height };
        const colors: Record<string, [number, number, number]> = {
            'https://cdn.test/a.png': [220, 40, 40],
            'https://cdn.test/b.png': [40, 180, 60],
            'https://cdn.test/c.png': [40, 60, 220],
        };
        const tiers = {
            base: rasterize(canvas.width, canvas.height, box, colors['https://cdn.test/a.png']),
            tablet: rasterize(canvas.width, canvas.height, box, colors['https://cdn.test/b.png']),
            desktop: rasterize(canvas.width, canvas.height, box, colors['https://cdn.test/c.png']),
        };

        // Every pair of tiers differs ONLY inside the image box — the swap is
        // confined to the swapped image region, nothing else on the page moved.
        const pairs: Array<[string, RgbaImage, RgbaImage]> = [
            ['base → tablet', tiers.base, tiers.tablet],
            ['base → desktop', tiers.base, tiers.desktop],
            ['tablet → desktop', tiers.tablet, tiers.desktop],
        ];
        for (const [label, a, b] of pairs) {
            const result = compareImages(a, b);
            expect(result.dimensionsMatch, `${label}: dimensions`).toBe(true);
            expect(result.differentPixels, `${label}: pixel count`).toBe(width * height);
            expect(result.diffRatio, `${label}: ratio`).toBeCloseTo(
                (width * height) / (canvas.width * canvas.height),
                5,
            );
            expect(diffBounds(a, b), `${label}: diff bounds`).toEqual({
                left: 0,
                top: 0,
                right: width - 1,
                bottom: height - 1,
            });
        }
    });

    it('emits a real min-width-0 tier as an always-matching source shadowed by larger tiers', () => {
        // A REAL min-width-0 breakpoint must NOT be skipped: its source is
        // `(min-width: 0px)` (always matches), and — emitted LAST in the
        // descending tree order — it is shadowed by every larger tier while
        // still replacing the <img> fallback below the first tier.
        const document = {
            id: 'doc_zero_tier',
            name: 'Zero Tier Doc',
            breakpoints: [
                { name: 'mobile', minWidth: 0 },
                { name: 'tablet', minWidth: 768 },
                { name: 'desktop', minWidth: 1024 },
            ],
            nodes: [
                {
                    id: 'photo',
                    type: 'Image',
                    name: 'Photo',
                    frame: { x: 0, y: 0, width: 300, height: 200 },
                    layout: { strategy: 'auto', sizing: { widthMode: 'fixed', heightMode: 'fixed' } },
                    style: {},
                    image: { src: 'https://cdn.test/base.png', alt: 'A' },
                    responsive: {
                        mobile: { image: { src: 'https://cdn.test/mobile.png' } },
                        desktop: { image: { src: 'https://cdn.test/desktop.png' } },
                    },
                },
            ],
        };
        const html = renderReferencePage(document);
        const picture = extractPicture(html);
        expect(picture).toBeDefined();

        // The 0-width tier is emitted, NOT skipped as an unresolvable one.
        expect(picture!).toContain('<source media="(min-width: 0px)" srcset="https://cdn.test/mobile.png" />');
        // Descending tree order: the always-matching source is LAST, so the
        // desktop tier shadows it (first matching <source> wins), never the
        // reverse.
        expect(picture!.indexOf('min-width: 0px')).toBeGreaterThan(picture!.indexOf('min-width: 1024px'));

        // Selection: the mobile image applies until desktop; the desktop tier
        // wins from 1024px on; the base <img> fallback is shadowed everywhere
        // because the 0px source always matches.
        expect(selectPictureSrc(picture!, 375)).toBe('https://cdn.test/mobile.png');
        expect(selectPictureSrc(picture!, 767)).toBe('https://cdn.test/mobile.png');
        expect(selectPictureSrc(picture!, 1024)).toBe('https://cdn.test/desktop.png');
        expect(selectPictureSrc(picture!, 2000)).toBe('https://cdn.test/desktop.png');
    });

    it('skips swap tiers whose breakpoint is not in the document scale', () => {
        // A swap keyed by a breakpoint the document does not define cannot be
        // placed. `(min-width: 0px)` would match EVERY viewport and, as the
        // last <source> in tree order, shadow the <img> fallback everywhere —
        // silently the wrong image at all sizes. The tier is dropped instead.
        const document = {
            id: 'doc_ghost_tier',
            name: 'Ghost Tier Doc',
            breakpoints: [{ name: 'desktop', minWidth: 1024 }],
            nodes: [
                {
                    id: 'photo',
                    type: 'Image',
                    name: 'Photo',
                    frame: { x: 0, y: 0, width: 300, height: 200 },
                    layout: { strategy: 'auto', sizing: { widthMode: 'fixed', heightMode: 'fixed' } },
                    style: {},
                    image: { src: 'https://cdn.test/a.png', alt: 'A' },
                    responsive: {
                        desktop: { image: { src: 'https://cdn.test/c.png' } },
                        ultrawide: { image: { src: 'https://cdn.test/ghost.png' } },
                    },
                },
            ],
        };
        const html = renderReferencePage(document);
        const picture = extractPicture(html);
        expect(picture).toBeDefined();

        // The defined tier is emitted; the ghost tier is dropped entirely —
        // no always-matching (min-width: 0px) source to shadow the fallback.
        expect(picture!).toContain('<source media="(min-width: 1024px)" srcset="https://cdn.test/c.png" />');
        expect(picture!).not.toContain('ghost');
        expect(picture!).not.toContain('(min-width: 0px)');

        // Browser selection still resolves correctly at every viewport.
        expect(selectPictureSrc(picture!, 375)).toBe('https://cdn.test/a.png');
        expect(selectPictureSrc(picture!, 1440)).toBe('https://cdn.test/c.png');
    });
});
