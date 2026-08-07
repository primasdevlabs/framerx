/**
 * Zod schemas for the exporter.
 *
 * The document schema is deliberately permissive (the node shape is versioned
 * by the compiler) — its purpose is to catch gross shape drift from the SDK
 * before compilation rather than to deep-validate every node.
 */

import { z } from 'zod';

/** Validate the shape of a document before compilation. */
export const framerDocumentSchema = z.object({
    id: z.string(),
    name: z.string(),
    version: z.string().optional(),
    nodes: z.array(z.unknown()),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Validate the export options. */
export const exportOptionsSchema = z.object({
    projectName: z.string().min(1).optional(),
    animations: z.boolean().optional(),
    format: z.boolean().optional(),
    zip: z.boolean().optional(),
});

/** The validated export options. */
export type ExportOptions = z.infer<typeof exportOptionsSchema>;

/** Validate a document, throwing a descriptive error when malformed. */
export function validateDocument(value: unknown): void {
    const result = framerDocumentSchema.safeParse(value);
    if (!result.success) {
        const issue = result.error.issues[0];
        throw new Error(
            `Invalid Framer document: ${issue?.path.join('.') || 'root'} — ${issue?.message ?? 'unexpected shape'}`,
        );
    }
}
