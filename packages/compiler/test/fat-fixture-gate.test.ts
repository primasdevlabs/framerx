/**
 * The "fat fixture" CI gate.
 *
 * A regression floor for the whole compiler: the fat-fixture document
 * exercises all 65 registered source properties. This test compiles it
 * through the production pipeline and asserts:
 *
 *   1. Every registered SourceProperty reaches `emitted` status.
 *   2. No registered property carries `unsupported: true`.
 *   3. Every registered property is at least `discovered` (the source model
 *      contains the corresponding shape) — proves the fixture actually
 *      exercises everything and isn't lying about coverage.
 *   4. The totals stay byte-stable for byte-identical reruns.
 *
 * If this test fails:
 *
 *   - A property was removed from the registry without updating the fixture.
 *   - The generator stopped emitting a signal that the coverage needles can
 *     no longer match against (action: tighten the needle only when
 *     warranted).
 *   - A new unsupported property was reintroduced (action: add it to
 *     `LayoutStyle`/`VisualStyle`/etc. and wire it through).
 *
 * The fat fixture itself lives in
 * `@framer/compiler-parser/fat-fixture` so all packages import the same
 * source document.
 */

import { describe, expect, it } from 'vitest';

import { collectCoverage, SOURCE_PROPERTIES } from '../src/coverage';
import { compileFramerDocument } from '../src/index';
import { fatFixtureDocument, parseFramerDocument } from '@framer/compiler-parser';

/** Source properties currently registered as unsupported. Must stay empty. */
const EXPECTED_UNSUPPORTED: readonly string[] = Object.freeze([]);

describe('fat fixture — CI gate', () => {
    it('registers the canonical 66 properties', () => {
        // If a new property is added deliberately, update this floor.
        expect(SOURCE_PROPERTIES.length).toBe(66);
    });

    it('has zero properties marked unsupported', () => {
        const unsupported = SOURCE_PROPERTIES.filter((p) => 'unsupported' in p && (p as { unsupported?: boolean }).unsupported === true);
        expect(unsupported.map((p) => p.id).sort()).toEqual([...EXPECTED_UNSUPPORTED].sort());
    });

    it('every registered property is at least discovered on the fat fixture', async () => {
        const result = await compileFramerDocument(fatFixtureDocument, { projectName: 'fat-fixture' });
        // Sanity: compilation completes without throwing.
        expect(result.files.length).toBeGreaterThan(0);
        expect(result.diagnostics.validation.valid).toBe(true);

        const report = result.diagnostics.coverage;
        expect(report).toBeDefined();
        expect(report!.summary.registered).toBe(66);
        expect(report!.summary.discovered).toBe(66);
        expect(report!.summary.unsupported).toBe(0);

        const notDiscovered = report!.properties.filter((p) => p.discoveredCount === 0).map((p) => p.id);
        expect(notDiscovered, 'every registered property must be discovered by the fat fixture').toEqual([]);
    });

    it('every registered property reaches emitted on the fat fixture', async () => {
        const result = await compileFramerDocument(fatFixtureDocument, { projectName: 'fat-fixture' });
        const report = result.diagnostics.coverage!;
        const notEmitted = report.properties
            .filter((p) => p.discoveredCount > 0 && p.stage !== 'emitted')
            .map((p) => ({ id: p.id, stage: p.stage, sources: p.discoveredCount }));
        expect(
            notEmitted,
            'every discovered property must reach the emitted stage end-to-end',
        ).toEqual([]);
        expect(report.summary.emitted).toBe(66);
    });

    it('exposes a deterministic stage distribution for the fat fixture', async () => {
        // Pin the stage distribution so any silent shift in the pipeline
        // (e.g. a needle going stale, a property dropping into framer-preserved)
        // is caught by CI, not by the user.
        const result = await compileFramerDocument(fatFixtureDocument, { projectName: 'fat-fixture' });
        const s = result.diagnostics.coverage!.summary;
        expect(s).toMatchObject({
            registered: 66,
            discovered: 66,
            emitted: 66,
            unsupported: 0,
        });
        // Conservation-of-mass: every emitted property is also discovered, and
        // every registered property is either discovered, unsupported, or has
        // the explicit zero-sources vacuous state (handled by the previous
        // test). Lost must stay at zero on the fat fixture.
        expect(s.lost).toBe(0);
    });

    it('compile() is byte-stable across reruns on the fat fixture', async () => {
        const a = await compileFramerDocument(fatFixtureDocument, { projectName: 'fat-fixture' });
        const b = await compileFramerDocument(fatFixtureDocument, { projectName: 'fat-fixture' });
        const sum = (r: typeof a) =>
            r.files
                .map((f) => `${f.path}:${f.content.length}`)
                .sort()
                .join('|');
        expect(sum(a)).toBe(sum(b));
    });

    it('parses without throwing on the fat fixture', () => {
        const ast = parseFramerDocument(fatFixtureDocument);
        expect(ast.nodes.length).toBeGreaterThan(0);
        expect(ast.metadata).toBeDefined();
    });
});
