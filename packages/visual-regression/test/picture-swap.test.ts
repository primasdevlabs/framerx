/**
 * Two-viewport replica image swap test.
 *
 * A replica's image override folds into its primary's responsive behavior
 * (`node.responsive.<tier>.image`), and the reference renderer emits it as a
 * `<picture><source media>` element — the <img> keeps its src, box, and class
 * at every tier. This test renders that page, selects the active source with
 * real browser `<picture>` semantics (first matching `<source media>`, else
 * the <img> fallback) at a mobile and a desktop viewport, rasterizes both
 * viewports, and proves the ONLY differing pixels are the image node's box —
 * the swap is confined to the swapped image region.
 */

import { describe, expect, it } from 'vitest';

import { compareImages } from '../src/compare/compare';
import type { RgbaImage } from '../src/compare/png';
import { renderReferencePage } from '../src/reference/render';

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
function rasterize(width: number, height: number, box: { x: number; y: number; width: number; height: number }, color: [number, number, number]): RgbaImage {
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

describe('responsive image swap at two viewports', () => {
    it('confines the pixel diff to the swapped image region', () => {
        // The post-fold state of a replica swap: the primary Image node
        // carries the alternate image under the desktop tier.
        const document = {
            id: 'doc_swap2',
            name: 'Swap Doc',
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
                        desktop: { image: { src: 'https://cdn.test/b.png' } },
                    },
                },
            ],
        };
        const html = renderReferencePage(document);
        const picture = /<picture>[\s\S]*?<\/picture>/.exec(html)?.[0];
        expect(picture).toBeDefined();

        // The browser's picture selection: base image on mobile, swapped on
        // desktop — the boundary is exactly the document breakpoint.
        expect(selectPictureSrc(picture!, 375)).toBe('https://cdn.test/a.png');
        expect(selectPictureSrc(picture!, 1024)).toBe('https://cdn.test/b.png');

        // The img's box comes from the rendered stylesheet, not an assumption.
        const { width, height } = cssSize(html, 'fx-ref-0');
        expect(width).toBe(300);
        expect(height).toBe(200);

        // Rasterize both viewports on the same canvas: everything is
        // identical except the image box, which paints the selected source.
        const canvas = { width: 800, height: 600 };
        const box = { x: 0, y: 0, width, height };
        const mobile = rasterize(canvas.width, canvas.height, box, [220, 40, 40]);
        const desktop = rasterize(canvas.width, canvas.height, box, [40, 60, 220]);

        const result = compareImages(mobile, desktop);
        expect(result.dimensionsMatch).toBe(true);
        // Exactly the image box differs — nothing else on the page moved.
        expect(result.differentPixels).toBe(width * height);
        expect(result.diffRatio).toBeCloseTo((width * height) / (canvas.width * canvas.height), 5);
        expect(diffBounds(mobile, desktop)).toEqual({ left: 0, top: 0, right: width - 1, bottom: height - 1 });
    });
});
