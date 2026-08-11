/**
 * Browser end-to-end test (opt-in).
 *
 * Runs the FULL visual-regression suite against the fat fixture — real
 * Chrome screenshots of the reference page and the generated React project
 * at desktop/tablet/mobile, compared pixel-by-pixel.
 *
 * Skipped unless `VR_BROWSER=1` is set (the suite needs a Chrome install and
 * an npm install + vite build inside the generated project, so it is not
 * part of the default vitest run).
 */

import { describe, expect, it } from 'vitest';

import { fatFixtureDocument } from '@framer/compiler-parser';

import { DEFAULT_BREAKPOINT_TOLERANCES } from '../src/compare/tolerance';
import { runVisualRegression } from '../src/run';

const enabled = process.env.VR_BROWSER === '1';

describe.skipIf(!enabled)('visual regression (browser)', () => {
    it(
        'reference vs generated stays within per-breakpoint tolerance',
        async () => {
            const report = await runVisualRegression({
                document: fatFixtureDocument,
                projectName: 'FatFixture',
                outDir: '.vr-browser-test',
                breakpoints: DEFAULT_BREAKPOINT_TOLERANCES,
            });

            for (const bp of report.breakpoints) {
                console.log(
                    `  ${bp.name}@${bp.width}px: diff ${(bp.diffRatio * 100).toFixed(2)}% (tol ${(bp.tolerance * 100).toFixed(1)}%) ${bp.dimensionsMatch ? 'dims match' : `HEIGHT DRIFT ${bp.referenceHeight}→${bp.generatedHeight}`}`,
                );
            }

            expect(report.allPassed).toBe(true);
        },
        600_000,
    );
});
