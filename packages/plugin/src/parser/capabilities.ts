/**
 * Runtime capability probe.
 *
 * The adapter deliberately duck-types the SDK surface, so the difference
 * between "this SDK version does not expose an API" and "the API exists but
 * this entity genuinely has no downloadable source" is only knowable at
 * runtime — and only by probing the actual objects. This module runs that
 * probe and produces a structured report the export diagnostics can cite,
 * so the user-facing warnings say WHY instead of a flat "failed":
 *
 *   - `getFonts` missing on the SDK object → an SDK capability gap (update
 *     the plugin SDK); NOT a property of any font in the project.
 *   - `getFonts` present but a font's `url` is null → the font genuinely has
 *     no downloadable source (custom fonts are not exposed to plugins).
 *   - `ImageAsset.getData` missing on the image assets → an SDK capability
 *     gap (original bytes unreadable; URL fetch is the only path).
 */

import type { ParseContext } from './node';
import type { FramerApi } from './sdk';

/** The outcome of probing one SDK capability. */
export type CapabilityProbe = { available: true } | { available: false; reason: string };

/** The runtime capability report for one extraction. */
export interface CapabilityReport {
    /**
     * framer.getFonts() — project-font collection. When absent, fonts are
     * exported as metadata only; that is an SDK surface gap (update the
     * plugin SDK), NOT a property of the project's fonts.
     */
    getFonts: CapabilityProbe;
    /**
     * ImageAsset.getData() — original image bytes. Only present when the
     * document carried SDK image assets that needed bytes. When unavailable,
     * images are exported via URL fetch (remote reference).
     */
    imageGetData?: CapabilityProbe;
}

/**
 * Probe whether the live SDK object exposes framer.getFonts().
 *
 * This is the runtime check that separates two otherwise-identical-looking
 * outcomes: "the SDK surface does not expose font collection" (probe fails —
 * an SDK capability gap, actionable by updating the plugin SDK) from "the
 * API exists but this font has no downloadable file" (probe passes; the
 * per-font `url: null` carries that answer).
 */
export function probeFontsCapability(api: FramerApi): CapabilityProbe {
    if (typeof api.getFonts === 'function') return { available: true };
    return {
        available: false,
        reason: 'The SDK does not expose framer.getFonts (runtime capability probe: no getFonts method on the live SDK object) — fonts are exported as metadata only. This is an SDK capability gap, not a property of the project fonts.',
    };
}

/**
 * Probe whether the SDK image assets exposed ImageAsset.getData() during the
 * node walk.
 *
 * Unlike fonts, the image-bytes capability lives on individual asset objects,
 * so the probe runs during parsing: every asset that needed ORIGINAL bytes
 * was checked for a getData method. The report is omitted when the document
 * carried no such assets (nothing to report); `available: false` means the
 * SDK surface never exposed getData for any image — the URL-fetch fallback
 * is the only path, an SDK capability gap rather than a per-image condition.
 */
export function probeImageGetDataCapability(context: ParseContext): CapabilityProbe | undefined {
    if (!context.imageGetDataSeen) return undefined;
    if (context.imageGetDataAvailable) return { available: true };
    return {
        available: false,
        reason: 'No SDK image asset exposed ImageAsset.getData (runtime capability probe) — original image bytes cannot be read through this SDK surface; images are exported via URL fetch (remote reference). This is an SDK capability gap, not a per-image condition.',
    };
}
