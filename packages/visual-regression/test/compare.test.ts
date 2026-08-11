/**
 * Comparator tests — verify diff ratios, dimension-drift handling, and
 * tolerance verdicts with synthetic RGBA images.
 */

import { describe, expect, it } from 'vitest';

import { compareImages } from '../src/compare/compare';
import { verdictFor, summarizeVerdicts } from '../src/compare/tolerance';
import { decodePng, encodePng } from '../src/compare/png';

function solid(width: number, height: number, [r, g, b]: [number, number, number]): ReturnType<typeof decodePng> {
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
        data[i * 4] = r;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = b;
        data[i * 4 + 3] = 255;
    }
    return { width, height, data };
}

describe('compareImages', () => {
    it('reports zero diff for identical images', () => {
        const a = solid(100, 50, [200, 100, 50]);
        const result = compareImages(a, solid(100, 50, [200, 100, 50]));
        expect(result.diffRatio).toBe(0);
        expect(result.differentPixels).toBe(0);
        expect(result.dimensionsMatch).toBe(true);
    });

    it('ignores sub-threshold channel noise (antialiasing)', () => {
        const base = solid(100, 50, [200, 100, 50]);
        const noisy = solid(100, 50, [204, 103, 54]); // Δ = 4+3+4 = 11 < 30
        expect(compareImages(base, noisy, { channelDeltaThreshold: 30 }).diffRatio).toBe(0);
        // And it DOES catch a real change:
        const changed = solid(100, 50, [250, 100, 50]); // Δ = 50
        const result = compareImages(base, changed, { channelDeltaThreshold: 30 });
        expect(result.diffRatio).toBeCloseTo(1, 5);
    });

    it('measures partial diffs proportionally', () => {
        // 100x50 = 5000px; change the left half (2500px) to a different color.
        const base = solid(100, 50, [0, 0, 0]);
        const half = { width: 100, height: 50, data: new Uint8Array(100 * 50 * 4) };
        for (let y = 0; y < 50; y += 1) {
            for (let x = 0; x < 100; x += 1) {
                const off = (y * 100 + x) * 4;
                half.data[off + 3] = 255;
                if (x < 50) {
                    half.data[off] = 255;
                }
            }
        }
        const result = compareImages(base, half);
        expect(result.diffRatio).toBeCloseTo(0.5, 3);
    });

    it('counts a taller generated page as differing area', () => {
        const base = solid(100, 50, [0, 0, 0]);
        const taller = solid(100, 60, [0, 0, 0]);
        const result = compareImages(base, taller);
        // 1000 extra px all differ (100*10) out of 6000 compared.
        expect(result.dimensionsMatch).toBe(false);
        expect(result.diffRatio).toBeCloseTo(1000 / 6000, 3);
    });

    it('generates a diff image where changed pixels are red', () => {
        const base = solid(10, 10, [0, 0, 0]);
        const other = solid(10, 10, [255, 255, 255]);
        const result = compareImages(base, other);
        expect(result.diffImage.data[0]).toBe(255); // red channel
        expect(result.diffImage.data[1]).toBe(32);
        expect(result.diffImage.data[2]).toBe(32);
    });

    it('works with PNG buffers via encode/decode', () => {
        const pngA = encodePng(solid(16, 16, [10, 20, 30]));
        const pngB = encodePng(solid(16, 16, [10, 20, 30]));
        expect(compareImages(decodePng(pngA), decodePng(pngB)).diffRatio).toBe(0);
    });
});

describe('tolerance verdicts', () => {
    it('passes when diff ≤ tolerance, fails when over', () => {
        const bp = { name: 'desktop', width: 1440, tolerance: 0.02 };
        expect(verdictFor(0.01, bp).passed).toBe(true);
        expect(verdictFor(0.02, bp).passed).toBe(true);
        expect(verdictFor(0.021, bp).passed).toBe(false);
        expect(verdictFor(0.05, bp).excess).toBeCloseTo(0.03, 5);
    });

    it('summarizes all-passed only when every tier passes', () => {
        const verdicts = [
            verdictFor(0.001, { name: 'desktop', width: 1440, tolerance: 0.02 }),
            verdictFor(0.09, { name: 'mobile', width: 375, tolerance: 0.08 }),
        ];
        const summary = summarizeVerdicts(verdicts);
        expect(summary.allPassed).toBe(false);
        expect(summary.failed.map((v) => v.name)).toEqual(['mobile']);
    });
});
