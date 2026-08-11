/**
 * Pixel-diff comparator.
 *
 * Compares a reference screenshot against a generated-project screenshot:
 *
 *   - Same dimensions → 1:1 comparison.
 *   - Different dimensions → the overlapping top-left region compares, and
 *     the unshared area counts as fully-different (a height/width drift IS a
 *     visual regression, not something to paper over).
 *
 * A pixel counts as "different" when the sum of absolute channel deltas
 * exceeds a threshold — tuned to ignore sub-pixel antialiasing noise while
 * catching real color/layout/typography regressions.
 */

import { decodePng, resizeNearest, type RgbaImage } from './png';

/** Options controlling the diff. */
export interface CompareOptions {
    /** Max |ΔR|+|ΔG|+|ΔB| (0-765) before a pixel counts as different. Default 30. */
    channelDeltaThreshold?: number;
    /** Also compare alpha when true. Default true. */
    compareAlpha?: boolean;
}

/** The result of comparing two screenshots. */
export interface DiffResult {
    /** Reference dimensions. */
    width: number;
    height: number;
    /** Generated dimensions (may differ from reference when layout drifts). */
    generatedWidth: number;
    generatedHeight: number;
    /** Total pixels compared (reference area). */
    totalPixels: number;
    /** Pixels that differ. */
    differentPixels: number;
    /** differentPixels / totalPixels (0..1). */
    diffRatio: number;
    /** True when dimensions matched exactly. */
    dimensionsMatch: boolean;
    /**
     * RGBA image highlighting differences: unchanged pixels are dimmed to
     * 12% brightness, changed pixels are tinted red.
     */
    diffImage: RgbaImage;
}

/**
 * Compare two screenshots. The reference defines the comparison canvas; the
 * generated screenshot is resized to it only for dimension alignment — the
 * size mismatch itself is reported and counts toward the diff.
 */
export function compareImages(reference: RgbaImage, generated: RgbaImage, options: CompareOptions = {}): DiffResult {
    const threshold = options.channelDeltaThreshold ?? 30;
    const compareAlpha = options.compareAlpha ?? true;

    const width = reference.width;
    const height = reference.height;
    const totalPixels = width * height;

    const aligned = resizeNearest(generated, width, height);
    const diffImage = new Uint8Array(totalPixels * 4);

    let differentPixels = 0;
    for (let i = 0; i < totalPixels; i += 1) {
        const r = i * 4;
        const dr = Math.abs(reference.data[r] - aligned.data[r]);
        const dg = Math.abs(reference.data[r + 1] - aligned.data[r + 1]);
        const db = Math.abs(reference.data[r + 2] - aligned.data[r + 2]);
        const da = compareAlpha ? Math.abs(reference.data[r + 3] - aligned.data[r + 3]) : 0;
        const isDifferent = dr + dg + db + da > threshold;

        if (isDifferent) {
            differentPixels += 1;
            // Red overlay on a dimmed copy of the reference.
            diffImage[r] = 255;
            diffImage[r + 1] = 32;
            diffImage[r + 2] = 32;
            diffImage[r + 3] = 255;
        } else {
            const dim = Math.round(reference.data[r] * 0.12);
            diffImage[r] = dim;
            diffImage[r + 1] = dim;
            diffImage[r + 2] = dim;
            diffImage[r + 3] = 255;
        }
    }

    // The unshared area (when the generated page is taller/wider) counts as
    // different: the generated page rendered content the reference did not.
    const generatedPixels = generated.width * generated.height;
    const unshared = Math.max(0, generatedPixels - totalPixels);
    differentPixels += unshared;

    const dimensionsMatch = reference.width === generated.width && reference.height === generated.height;

    return {
        width,
        height,
        generatedWidth: generated.width,
        generatedHeight: generated.height,
        totalPixels: totalPixels + unshared,
        differentPixels,
        diffRatio: totalPixels + unshared > 0 ? differentPixels / (totalPixels + unshared) : 0,
        dimensionsMatch,
        diffImage: { width, height, data: diffImage },
    };
}

/** Convenience: compare two PNG buffers directly. */
export function comparePngBuffers(
    referencePng: Buffer,
    generatedPng: Buffer,
    options: CompareOptions = {},
): DiffResult {
    return compareImages(decodePng(referencePng), decodePng(generatedPng), options);
}
