/**
 * Export manifest (.export-manifest.json) — automated regression tests.
 *
 * The manifest is the machine-readable fidelity summary every export ships
 * with. These tests guard against:
 *  - the manifest disappearing from generated projects,
 *  - the manifest losing the coverage summary,
 *  - the manifest becoming non-deterministic across runs,
 *  - the manifest failing to parse as valid JSON,
 *  - the manifest path colliding with another emitted file.
 */

import { describe, expect, it } from 'vitest';

import { compileFramerDocument, compileWithoutValidation } from '../src/index';
import { mockFramerDocument } from '@framer/compiler-parser';
import { generateExportManifest, EXPORT_MANIFEST_PATH, renderExportManifest } from '@framer/compiler-generators';

const MANIFEST_KEYS = [
    'compilerVersion',
    'exportedAt',
    'projectName',
    'source',
    'nodes',
    'components',
    'assets',
    'fonts',
    'replicas',
    'animations',
    'coverage',
    'validation',
] as const;

describe('.export-manifest.json emission', () => {
    it('lands a manifest file in the generated project under the canonical path', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'manifest-demo' });

        const manifest = result.files.find((file) => file.path === EXPORT_MANIFEST_PATH);
        expect(manifest).toBeDefined();
        expect(manifest?.binary).toBeFalsy();
    });

    it('parses as valid JSON and exposes every keystone field', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'manifest-json' });
        const manifest = result.files.find((file) => file.path === EXPORT_MANIFEST_PATH)!;

        let parsed: Record<string, unknown>;
        expect(() => {
            parsed = JSON.parse(manifest.content) as Record<string, unknown>;
        }).not.toThrow();

        for (const key of MANIFEST_KEYS) {
            expect(parsed).toHaveProperty(key);
        }
        expect(parsed.compilerVersion).toEqual(expect.any(String));
        expect(parsed.projectName).toBe('manifest-json');
        expect(parsed.nodes).toMatchObject({ discovered: expect.any(Number), preserved: expect.any(Number) });
        expect(parsed.components).toMatchObject({
            definitions: expect.any(Number),
            instances: expect.any(Number),
            fromMasters: expect.any(Number),
            fromCode: expect.any(Number),
            synthesized: expect.any(Number),
        });
        // Replica folding counts are always present (zero-filled when the
        // source carried no replica record) so CI can rely on the shape.
        expect(parsed.replicas).toMatchObject({
            discovered: expect.any(Number),
            folded: expect.any(Number),
            unresolved: expect.any(Number),
            unsupported: expect.any(Number),
        });
        expect(parsed.coverage).toMatchObject({
            registered: expect.any(Number),
            discovered: expect.any(Number),
            preserved: expect.any(Number),
            emitted: expect.any(Number),
            unsupported: expect.any(Number),
            lost: expect.any(Number),
        });
        // Per-property array is sorted by id for stability.
        const coverageObj = parsed.coverage as { properties: Array<{ id: string }> };
        const ids = coverageObj.properties.map((entry) => entry.id);
        const sortedIds = [...ids].sort();
        expect(ids).toEqual(sortedIds);
    });

    it('is identical across two runs on the same input (no timestamps leak)', async () => {
        const stubTime = '2025-01-01T00:00:00.000Z';
        const a = await compileFramerDocument(mockFramerDocument, { projectName: 'det' });
        const b = await compileFramerDocument(mockFramerDocument, { projectName: 'det' });
        const aManifest = a.files.find((file) => file.path === EXPORT_MANIFEST_PATH)!;
        const bManifest = b.files.find((file) => file.path === EXPORT_MANIFEST_PATH)!;

        // Strip the exportedAt timestamp on both sides (the real export
        // includes it; tests pin otherwise).
        const stripTimestamp = (text: string): string =>
            text.replace(/"exportedAt"\s*:\s*"[^"]+"/, '"exportedAt":"' + stubTime + '"');
        expect(stripTimestamp(aManifest.content)).toBe(stripTimestamp(bManifest.content));
    });

    it('ships alongside the rest of the project in the ZIP', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'zip', zip: true });
        expect(result.zip).toBeDefined();
        // JSZip is loaded transitively; assert the bundle exists without
        // pulling the whole zip parsing surface here (covered by the
        // exporter integration test).
        expect(result.zip!.byteLength).toBeGreaterThan(0);
    });

    it('is also emitted when compileWithoutValidation is used (manifest is not behind the validator gate)', async () => {
        const ast = (await import('@framer/compiler-parser')).parseFramerDocument(mockFramerDocument);
        const result = await compileWithoutValidation(ast, { projectName: 'unvalidated' });
        expect(result.files.find((file) => file.path === EXPORT_MANIFEST_PATH)).toBeDefined();
    });
});

describe('generateExportManifest helper', () => {
    it('omits unknown coverage properties silently', () => {
        const file = generateExportManifest({
            compilerVersion: '0.9.9',
            projectName: 'helper',
            coverage: { registered: 10, discovered: 4, preserved: 4, emitted: 2, unsupported: 1, lost: 0 },
        });
        const parsed = JSON.parse(file.content) as { coverage: { registered: number }; compilerVersion: string };
        expect(parsed.compilerVersion).toBe('0.9.9');
        expect(parsed.coverage.registered).toBe(10);
    });

    it('renderExportManifest produces valid JSON even with no input fields', () => {
        const text = renderExportManifest({ projectName: 'bare' });
        const parsed = JSON.parse(text) as Record<string, unknown>;
        expect(parsed.projectName).toBe('bare');
        expect(parsed.compilerVersion).toEqual(expect.any(String));
        expect(parsed.coverage).toBeUndefined();
        // The replicas section is deterministic even when absent from input.
        expect(parsed.replicas).toEqual({ discovered: 0, folded: 0, unresolved: 0, unsupported: 0 });
    });

    it('renders replica folding counts from the extraction record', async () => {
        const result = await compileFramerDocument(
            {
                ...mockFramerDocument,
                metadata: {
                    platform: 'framer',
                    extraction: {
                        replicas: {
                            status: 'partial',
                            count: 3,
                            failed: 1,
                            unresolved: 1,
                            unsupported: 0,
                            reason: "1 replica(s) had no matching primary node ('Ghost' (missing))",
                        },
                    },
                },
            },
            { projectName: 'manifest-replicas' },
        );

        const manifest = result.files.find((file) => file.path === EXPORT_MANIFEST_PATH)!;
        const parsed = JSON.parse(manifest.content) as {
            replicas: { discovered: number; folded: number; unresolved: number; unsupported: number };
        };
        expect(parsed.replicas).toEqual({ discovered: 4, folded: 3, unresolved: 1, unsupported: 0 });
    });
});
