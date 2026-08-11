/**
 * CLI entry for the visual-regression suite.
 *
 * Usage:
 *   tsx packages/visual-regression/scripts/run-visual-regression.ts \
 *       --fixture fat-fixture \
 *       --breakpoints desktop:1440:0.02,tablet:768:0.04,mobile:375:0.08 \
 *       [--out .vr-out] [--reference-url <url>] [--no-build] [--reuse]
 *
 * Fixtures: fat-fixture | demo-landing | master-golden
 *
 * Exit code 0 = every breakpoint within tolerance, 1 = at least one
 * breakpoint failed or the suite could not run.
 */

import { fatFixtureDocument, masterBackedDocument, mockFramerDocument } from '@framer/compiler-parser';

import {
    DEFAULT_BREAKPOINT_TOLERANCES,
    type BreakpointTolerance,
} from '../src/compare/tolerance';
import { runVisualRegression } from '../src/run';

const FIXTURES: Record<string, { document: typeof fatFixtureDocument; name: string }> = {
    'fat-fixture': { document: fatFixtureDocument, name: 'FatFixture' },
    'demo-landing': { document: mockFramerDocument, name: 'DemoLanding' },
    'master-golden': { document: masterBackedDocument, name: 'MasterGolden' },
};

interface CliArgs {
    fixture: string;
    outDir: string;
    breakpoints: BreakpointTolerance[];
    referenceUrl?: string;
    installAndBuild: boolean;
    reuseGenerated: boolean;
    chromePath?: string;
    settleMs: number;
}

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        fixture: 'fat-fixture',
        outDir: '.vr-out',
        breakpoints: [...DEFAULT_BREAKPOINT_TOLERANCES],
        installAndBuild: true,
        reuseGenerated: false,
        settleMs: 800,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const next = () => argv[i + 1];
        switch (arg) {
            case '--fixture':
                args.fixture = next();
                i += 1;
                break;
            case '--out':
                args.outDir = next();
                i += 1;
                break;
            case '--breakpoints': {
                const spec = next();
                args.breakpoints = spec.split(',').map((part) => {
                    const [name, width, tolerance] = part.split(':');
                    return {
                        name,
                        width: Number(width),
                        tolerance: Number(tolerance),
                    };
                });
                i += 1;
                break;
            }
            case '--reference-url':
                args.referenceUrl = next();
                i += 1;
                break;
            case '--no-build':
                args.installAndBuild = false;
                break;
            case '--reuse':
                args.reuseGenerated = true;
                break;
            case '--chrome':
                args.chromePath = next();
                i += 1;
                break;
            case '--settle-ms':
                args.settleMs = Number(next());
                i += 1;
                break;
            case '--help':
            case '-h':
                console.log(helpText());
                process.exit(0);
                break;
            default:
                console.error(`Unknown argument: ${arg}`);
                console.error(helpText());
                process.exit(1);
        }
    }
    return args;
}

function helpText(): string {
    return `Visual regression suite
  --fixture <fat-fixture|demo-landing|master-golden>
  --breakpoints <name:width:tolerance,...>  (default desktop:1440:0.02,tablet:768:0.04,mobile:375:0.08)
  --reference-url <url>                     screenshot a real deployed page instead of the local reference
  --out <dir>                               artifact root (default .vr-out)
  --no-build                                don't run pnpm install/build in the generated project
  --reuse                                   reuse an existing generated project (skip compilation)
  --chrome <path>                           Chrome executable
  --settle-ms <ms>                          settle time for animations (default 800)`;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    const fixture = FIXTURES[args.fixture];
    if (!fixture) {
        console.error(`Unknown fixture "${args.fixture}". Choose from: ${Object.keys(FIXTURES).join(', ')}`);
        process.exit(1);
    }

    console.log(`▶ Visual regression — ${fixture.name}`);
    console.log(`  Reference: ${args.referenceUrl ?? 'local render (independent source→HTML baseline)'}`);
    console.log(`  Breakpoints: ${args.breakpoints.map((b) => `${b.name}@${b.width}px (≤${(b.tolerance * 100).toFixed(1)}%)`).join(', ')}`);
    console.log(`  Output: ${args.outDir}/${fixture.name}`);

    const report = await runVisualRegression({
        document: fixture.document,
        projectName: fixture.name,
        outDir: args.outDir,
        breakpoints: args.breakpoints,
        referenceUrl: args.referenceUrl,
        installAndBuild: args.installAndBuild,
        reuseGenerated: args.reuseGenerated,
        chromePath: args.chromePath,
        settleMs: args.settleMs,
    });

    console.log('');
    console.log('VISUAL REGRESSION');
    for (const bp of report.breakpoints) {
        const icon = bp.passed ? '✅' : '❌';
        const dims = bp.dimensionsMatch
            ? 'dims match'
            : `HEIGHT DRIFT ${bp.referenceHeight}px → ${bp.generatedHeight}px`;
        console.log(
            `  ${icon} ${bp.name.padEnd(8)} ${bp.width}px  diff ${(bp.diffRatio * 100).toFixed(2)}%  tolerance ${(bp.tolerance * 100).toFixed(1)}%  ${dims}`,
        );
        if (bp.diffPng) console.log(`     diff image: ${bp.diffPng}`);
    }
    console.log('');
    console.log(report.allPassed ? '✅ ALL BREAKPOINTS WITHIN TOLERANCE' : '❌ VISUAL REGRESSION FAILED');
    process.exit(report.allPassed ? 0 : 1);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
