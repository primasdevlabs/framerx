/**
 * Tests for the retry-state helpers that drive the prominent retry action:
 *   - a degraded document (canvas root could not be read → empty document with
 *     an `extraction.canvasRoot` error record) is a retryable failure;
 *   - a missing document in framer mode (engine handshake never landed) is a
 *     retryable failure;
 *   - healthy / standalone / loading states are not retryable failures;
 *   - the reason prefers the store error and falls back to the recorded one.
 */

import type { FramerDocument } from '@framer/compiler-parser';
import { describe, expect, it } from 'vitest';

import { extractionFailureReason, isRetryableExtractionFailure } from '../src/ui/retry';

/** An empty document with the extraction record a degraded load writes. */
function degradedDocument(reason = 'The Framer engine did not return a canvas root.'): FramerDocument {
    return {
        id: 'canvas',
        name: 'Framer Document',
        version: '1.0.0',
        nodes: [],
        metadata: {
            platform: 'framer',
            extraction: {
                canvasRoot: { status: 'error', reason },
            },
        },
    };
}

/** A healthy, non-degraded document. */
function healthyDocument(): FramerDocument {
    return {
        id: 'canvas',
        name: 'Framer Document',
        version: '1.0.0',
        nodes: [],
        metadata: { platform: 'framer' },
    };
}

describe('isRetryableExtractionFailure', () => {
    it('is true when the canvas root could not be read (degraded empty document)', () => {
        expect(isRetryableExtractionFailure(degradedDocument(), 'framer')).toBe(true);
    });

    it('is true when no document arrived in framer mode (handshake never landed)', () => {
        expect(isRetryableExtractionFailure(null, 'framer')).toBe(true);
    });

    it('is false for a healthy document', () => {
        expect(isRetryableExtractionFailure(healthyDocument(), 'framer')).toBe(false);
    });

    it('is false outside framer mode, even with no document', () => {
        expect(isRetryableExtractionFailure(null, 'standalone')).toBe(false);
        expect(isRetryableExtractionFailure(degradedDocument(), 'standalone')).toBe(false);
        expect(isRetryableExtractionFailure(null, 'loading')).toBe(false);
    });

    it('is false for an empty document without a canvas-root error record', () => {
        expect(isRetryableExtractionFailure(healthyDocument(), 'framer')).toBe(false);
    });
});

describe('extractionFailureReason', () => {
    it('prefers the store error (handshake failure)', () => {
        expect(extractionFailureReason(degradedDocument('from metadata'), 'connect error')).toBe('connect error');
        expect(extractionFailureReason(null, 'connect error')).toBe('connect error');
    });

    it('falls back to the recorded extraction reason', () => {
        const reason = 'Timed out after 10000ms waiting for getCanvasRoot';
        expect(extractionFailureReason(degradedDocument(reason), null)).toBe(reason);
    });

    it('returns null when nothing failed', () => {
        expect(extractionFailureReason(healthyDocument(), null)).toBeNull();
        expect(extractionFailureReason(null, null)).toBeNull();
    });
});
