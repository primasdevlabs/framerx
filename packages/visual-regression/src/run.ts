/**
 * Visual-regression suite orchestration.
 *
 *   FramerDocument (plugin extraction)
 *       ├── reference renderer ──→ reference/index.html (independent baseline)
 *       └── compiler ──→ generated project ──build──→ dist/ (candidate)
 *
 * For each breakpoint (desktop / tablet / mobile) both pages are
 * full-page-screenshotted in the same browser at the same viewport width,
 * pixel-compared, and judged against that breakpoint's tolerance. A JSON +
 * Markdown report is written so CI can consume the verdicts.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';

import { compileFramerDocument } from '@framer/compiler';
import type { FramerDocument } from '@framer/compiler-parser';

import { captureScreenshot } from './browser/screenshot';
import { compareImages, type DiffResult } from './compare/compare';
import { decodePng, encodePng } from './compare/png';
import { summarizeVerdicts, type BreakpointTolerance, type ToleranceVerdict } from './compare/tolerance';
import { renderReferencePage } from './reference/render';
import { serveDirectory, type ServeHandle } from './serve';

export interface VisualRegressionConfig {
    /** The extracted Framer document. */
    document: FramerDocument;
    /** Project name (also the generated package name). */
    projectName: string;
    /** Output root; artifacts land in `<out>/<projectName>/`. */
    outDir: string;
    /** Per-breakpoint tolerances. */
    breakpoints: readonly BreakpointTolerance[];
    /** ms to settle after load (motion animations). Default 800. */
    settleMs?: number;
    /** Block external requests so both pages render with local resources only. Default true. */
    blockExternal?: boolean;
    /** Chrome executable (defaults to an OS-appropriate location). */
    chromePath?: string;
    /**
     * When set, screenshot this URL instead of the locally rendered
     * reference — the "real Framer page" mode (a deployed Framer site).
     */
    referenceUrl?: string;
    /** Run `pnpm install` + `pnpm build` in the generated project. Default true. */
    installAndBuild?: boolean;
    /** Skip compilation and reuse an existing generated project. Default false. */
    reuseGenerated?: boolean;
    /** Write reference/generated/diff PNGs to disk. Default true. */
    writeArtifacts?: boolean;
}

export interface BreakpointReport {
    name: string;
    width: number;
    tolerance: number;
    diffRatio: number;
    passed: boolean;
    excess: number;
    dimensionsMatch: boolean;
    referenceHeight: number;
    generatedHeight: number;
    referencePng?: string;
    generatedPng?: string;
    diffPng?: string;
}

export interface SuiteReport {
    projectName: string;
    derivation: string;
    reference: 'local-render' | 'external-url';
    referenceUrl?: string;
    breakpoints: BreakpointReport[];
    allPassed: boolean;
    coverage?: {
        registered: number;
        discovered: number;
        preserved: number;
        emitted: number;
        unsupported: number;
        lost: number;
    };
}

/**
 * Run the suite end-to-end. Throws on setup failure (missing Chrome, build
 * failure); per-breakpoint verdicts are returned in the report.
 */
export async function runVisualRegression(config: VisualRegressionConfig): Promise<SuiteReport> {
    const outRoot = resolve(config.outDir);
    const runDir = join(outRoot, config.projectName);
    const generatedDir = join(runDir, 'generated');
    const referenceDir = join(runDir, 'reference');
    const artifactsDir = join(runDir, 'artifacts');
    await mkdir(artifactsDir, { recursive: true });

    // ── 1. Compile the fixture into a generated React project ─────────────
    if (!config.reuseGenerated) {
        const result = await compileFramerDocument(config.document, { projectName: config.projectName });
        await mkdir(generatedDir, { recursive: true });
        for (const file of result.files) {
            const target = join(generatedDir, file.path);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, file.binary && file.data ? file.data : file.content);
        }
        // The generated project gets its OWN pnpm workspace marker so `pnpm
        // install` inside it resolves react/motion/tailwind independently
        // instead of being absorbed by the monorepo workspace above it.
        await writeFile(
            join(generatedDir, 'pnpm-workspace.yaml'),
            'packages:\n  - "**"\n',
        );
    }

    // ── 2. Render the reference page (independent baseline) ───────────────
    const referenceHtml = renderReferencePage(config.document);
    await mkdir(referenceDir, { recursive: true });
    await writeFile(join(referenceDir, 'index.html'), referenceHtml);

    // ── 3. Build the generated project (cached when dist/ is present) ─────
    const distDir = join(generatedDir, 'dist');
    if (!existsSync(join(distDir, 'index.html'))) {
        if (config.installAndBuild !== false) {
            await runInDir(generatedDir, 'pnpm', ['install', '--prefer-offline']);
            await runInDir(generatedDir, 'pnpm', ['build']);
        } else {
            throw new Error(
                `Generated project is not built (missing ${join(distDir, 'index.html')}) and installAndBuild is disabled.`,
            );
        }
    }

    // ── 4. Serve both pages ───────────────────────────────────────────────
    const servers: ServeHandle[] = [];
    const generatedServer = await serveDirectory(distDir);
    servers.push(generatedServer);
    const referenceServer = config.referenceUrl ? undefined : await serveDirectory(referenceDir);
    if (referenceServer) servers.push(referenceServer);

    try {
        const referenceBase = config.referenceUrl ?? referenceServer!.url;
        const generatedBase = generatedServer.url;

        // ── 5. Screenshot + compare per breakpoint ────────────────────────
        const breakpoints: BreakpointReport[] = [];
        for (const bp of config.breakpoints) {
            const referencePng = await captureScreenshot(referenceBase, {
                width: bp.width,
                settleMs: config.settleMs ?? 800,
                blockExternal: config.blockExternal ?? true,
                executablePath: config.chromePath,
            });
            const generatedPng = await captureScreenshot(generatedBase, {
                width: bp.width,
                settleMs: config.settleMs ?? 800,
                blockExternal: config.blockExternal ?? true,
                executablePath: config.chromePath,
            });

            const diff: DiffResult = compareImages(
                decodePng(referencePng.png),
                decodePng(generatedPng.png),
            );
            const verdict: ToleranceVerdict = {
                name: bp.name,
                width: bp.width,
                tolerance: bp.tolerance,
                diffRatio: diff.diffRatio,
                passed: diff.diffRatio <= bp.tolerance,
                excess: diff.diffRatio - bp.tolerance,
            };

            let referencePngPath: string | undefined;
            let generatedPngPath: string | undefined;
            let diffPngPath: string | undefined;
            if (config.writeArtifacts !== false) {
                const safe = bp.name.replace(/[^a-z0-9-]/gi, '');
                referencePngPath = join(artifactsDir, `${safe}-reference.png`);
                generatedPngPath = join(artifactsDir, `${safe}-generated.png`);
                diffPngPath = join(artifactsDir, `${safe}-diff.png`);
                await writeFile(referencePngPath, referencePng.png);
                await writeFile(generatedPngPath, generatedPng.png);
                await writeFile(diffPngPath, encodePng(diff.diffImage));
                // Portability: report paths relative to the run directory so
                // the report survives moving/copying `.vr-out/<project>/`.
                referencePngPath = relative(runDir, referencePngPath);
                generatedPngPath = relative(runDir, generatedPngPath);
                diffPngPath = relative(runDir, diffPngPath);
            }

            breakpoints.push({
                name: bp.name,
                width: bp.width,
                tolerance: bp.tolerance,
                diffRatio: diff.diffRatio,
                passed: verdict.passed,
                excess: verdict.excess,
                dimensionsMatch: diff.dimensionsMatch,
                referenceHeight: referencePng.pageHeight,
                generatedHeight: generatedPng.pageHeight,
                referencePng: referencePngPath,
                generatedPng: generatedPngPath,
                diffPng: diffPngPath,
            });
        }

        const { allPassed } = summarizeVerdicts(breakpoints);

        const report: SuiteReport = {
            projectName: config.projectName,
            derivation: `derivation:${hashOf(config.document)}`,
            reference: config.referenceUrl ? 'external-url' : 'local-render',
            referenceUrl: config.referenceUrl,
            breakpoints,
            allPassed,
        };

        await writeFile(join(runDir, 'report.json'), JSON.stringify(report, null, 2));
        await writeFile(join(runDir, 'report.md'), renderMarkdown(report));
        return report;
    } finally {
        await Promise.all(servers.map((server) => server.close()));
    }
}

/** Run a command in a directory and throw with output on failure. */
async function runInDir(cwd: string, command: string, args: string[]): Promise<void> {
    // Windows: package-manager entry points are `.cmd` shims that can only be
    // launched through the shell (spawnSync on the shim itself → EINVAL).
    const cmd = process.platform === 'win32' ? 'cmd.exe' : command;
    const cmdArgs = process.platform === 'win32' ? ['/c', command, ...args] : args;
    const result = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8', timeout: 300_000 });
    if (result.error) {
        throw new Error(`\`${command} ${args.join(' ')}\` could not be started in ${cwd}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        const tail = (result.stdout || result.stderr || '').split('\n').slice(-20).join('\n');
        throw new Error(`\`${command} ${args.join(' ')}\` failed in ${cwd}:\n${tail}`);
    }
}

/** A stable content hash of the source document for the report. */
function hashOf(document: FramerDocument): string {
    return createHash('sha256').update(JSON.stringify(document)).digest('hex').slice(0, 16);
}

/** Render the suite report as Markdown. */
export function renderMarkdown(report: SuiteReport): string {
    const lines: string[] = [];
    lines.push(`# Visual Regression — ${report.projectName}`);
    lines.push('');
    lines.push(`- Derivation: \`${report.derivation}\``);
    lines.push(`- Reference: ${report.reference}${report.referenceUrl ? ` (${report.referenceUrl})` : ''}`);
    lines.push(`- Overall: ${report.allPassed ? '✅ PASS' : '❌ FAIL'}`);
    lines.push('');
    lines.push('| Breakpoint | Width | Diff % | Tolerance | Verdict | Dimensions |');
    lines.push('| --- | ---: | ---: | ---: | --- | --- |');
    for (const bp of report.breakpoints) {
        lines.push(
            `| ${bp.name} | ${bp.width}px | ${(bp.diffRatio * 100).toFixed(2)}% | ${(bp.tolerance * 100).toFixed(1)}% | ${bp.passed ? '✅' : '❌'} | ${bp.dimensionsMatch ? 'match' : `drift (${bp.referenceHeight}→${bp.generatedHeight}px)`} |`,
        );
    }
    lines.push('');
    for (const bp of report.breakpoints) {
        if (!bp.dimensionsMatch) {
            lines.push(
                `> ⚠️ **${bp.name}** page height drifted: reference ${bp.referenceHeight}px vs generated ${bp.generatedHeight}px. A height drift counts toward the diff.`,
            );
        }
        if (bp.diffPng) lines.push(`- ${bp.name} diff: \`${bp.diffPng}\``);
    }
    return lines.join('\n');
}
