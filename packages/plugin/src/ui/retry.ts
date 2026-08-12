/**
 * Retry-state helpers for the plugin panel.
 *
 * A failed project load has two shapes, both recoverable by rescanning (the
 * refresh flow reconnects when the engine connection was lost):
 *   • the engine never answered the handshake — no document at all, and the
 *     connect error is set on the store;
 *   • extraction degraded — the canvas root could not be read (e.g. a
 *     timed-out SDK call), so `extractFramerDocument` returned an empty
 *     document whose `metadata.extraction.canvasRoot` records the failure.
 *
 * When either shape is detected the panel shows a prominent retry action so
 * the user can re-attempt without closing and reopening the plugin.
 */

import type { FramerDocument } from '@framer/compiler-parser';

import type { PluginMode } from '../store/plugin-store';

/** The extraction status record the plugin adapter writes on `document.metadata.extraction`. */
interface ExtractionStatusRecord {
    status: string;
    reason?: string;
}

interface ExtractionMetadata {
    canvasRoot?: ExtractionStatusRecord;
}

/** The canvas-root extraction record, when the document carries one. */
function canvasRootRecord(document: FramerDocument | null): ExtractionStatusRecord | undefined {
    const metadata = document?.metadata as { extraction?: ExtractionMetadata } | undefined;
    return metadata?.extraction?.canvasRoot;
}

/**
 * Whether the panel is showing a failed load that a rescan can recover from.
 *
 * `true` in framer mode when either no document ever arrived (handshake
 * failure) or the loaded document is the degraded empty one produced when the
 * canvas root could not be read.
 */
export function isRetryableExtractionFailure(document: FramerDocument | null, mode: PluginMode): boolean {
    if (mode !== 'framer') return false;
    if (!document) return true;
    return canvasRootRecord(document)?.status === 'error';
}

/**
 * A human-readable explanation of the failed load, for the retry panel.
 *
 * Prefers the store error (handshake failure); falls back to the reason the
 * extraction recorded (degraded canvas root).
 */
export function extractionFailureReason(document: FramerDocument | null, error: string | null): string | null {
    if (error) return error;
    return canvasRootRecord(document)?.reason ?? null;
}
