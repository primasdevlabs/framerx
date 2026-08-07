/**
 * Standalone demo document source.
 *
 * When the plugin runs outside the Framer runtime (local development, previews,
 * tests), the UI loads the mock Framer document from the parser package so the
 * full export flow can be exercised end-to-end.
 */

import { mockFramerDocument } from '@framer/compiler-parser';

/** The mock Framer document used in standalone mode. */
export function loadMockDocument(): Promise<typeof mockFramerDocument> {
    return Promise.resolve(mockFramerDocument);
}
