/**
 * Probe: shared-module bundle → real generated project → real build.
 *
 * Fetches an actual published module bundle from Framer's CDN (the same bytes
 * a live export would resolve), attaches it to a module-backed instance, runs
 * the full compiler, writes the project to disk with its own workspace marker,
 * and executes `pnpm install` + `npm run build` (tsc -b && vite build) — the
 * real "does the exported project build" bar.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { rmSync } from 'node:fs';

import { compileFramerDocument } from '../../compiler/src/index';
import type { FramerDocument, FramerNode } from '../../parser/src/index';
import { resolveModuleClosure } from '../../plugin/src/parser/modules';

const OUT = resolve(__dirname, '../../.vr-tmp/module-probe');

/** A fetch-based module fetcher (the default used by real extractions). */
async function fetchModuleText(url: string): Promise<string | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.text();
    } catch {
        return null;
    }
}

async function main(): Promise<void> {
    const tickerUrl = 'https://framerusercontent.com/modules/B2xAlJLcN0gOnt11mSPw/plhC5PVnCMllW5QXjFK5/Ticker.js';

    // 1. Resolve the bundle + its remote-import closure (real fetch).
    const closure = await resolveModuleClosure(tickerUrl, fetchModuleText);
    if (!closure) {
        console.error('✗ could not fetch module bundle');
        process.exit(1);
    }
    console.log(`fetched entry ${closure.entryPath} + ${closure.dependencies.length} dep(s)`);

    // 2. Attach it to a module-backed instance in a realistic document.
    const instance: FramerNode = {
        id: 'inst_ticker',
        type: 'Component',
        name: 'Ticker',
        frame: { x: 0, y: 0, width: 400, height: 80 },
        layout: { strategy: 'flex', direction: 'row', alignItems: 'center' },
        style: {},
        component: {
            id: `module:${tickerUrl}:default`,
            name: 'Ticker',
            props: { text: 'NEW · FEATURE · SHIP', speed: 40 },
            code: {
                source: closure.entrySource,
                fileName: closure.entryPath.split('/').pop() ?? 'Ticker.js',
                path: closure.entryPath,
                exportName: 'default',
                isDefaultExport: true,
                dependencies: closure.dependencies,
                isModule: true,
            },
        },
        children: [
            {
                id: 'inst_ticker_child',
                type: 'Text',
                name: 'Item',
                frame: { x: 0, y: 0, width: 120, height: 24 },
                layout: { strategy: 'auto' },
                style: {},
                text: { text: 'Framer X', style: { fontFamily: 'Inter', fontSize: 16, fontWeight: 700 } },
            },
        ],
    };

    const document: FramerDocument = {
        id: 'doc_module_probe',
        name: 'Module Probe',
        version: '1.0.0',
        nodes: [
            {
                id: 'root_section',
                type: 'Frame',
                name: 'Ticker Section',
                frame: { x: 0, y: 0, width: 1440, height: 120 },
                layout: { strategy: 'flex', direction: 'column', alignItems: 'flex-start' },
                style: {},
                children: [instance],
            },
        ],
        metadata: {
            platform: 'framer',
            extraction: {
                masters: { status: 'ok', count: 0 },
                codeFiles: { status: 'empty', reason: 'getCodeFiles resolved but returned no component code files.' },
                modules: { status: 'ok', count: 1 },
            },
        },
    };

    // 3. Compile.
    const result = await compileFramerDocument(document, { projectName: 'ModuleProbe' });
    const warnings = result.diagnostics.validation.warnings;
    console.log(`compiled: ${result.files.length} files, ${warnings.length} warnings, valid=${result.diagnostics.validation.valid}`);
    for (const warning of warnings) console.log(`  ⚠ ${warning.message.slice(0, 140)}`);

    // 4. Write the project (with its own workspace marker so pnpm resolves
    //    deps independently of the monorepo).
    rmSync(OUT, { recursive: true, force: true });
    for (const file of result.files) {
        const target = join(OUT, file.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.binary && file.data ? Buffer.from(file.data) : file.content);
    }
    writeFileSync(join(OUT, 'pnpm-workspace.yaml'), 'packages:\n  - "**"\n');
    console.log(`project written to ${OUT}`);

    // 5. Real build.
    const execFile = (await import('node:child_process')).execFileSync;
    const run = (cmd: string, args: string[]) => {
        console.log(`$ ${cmd} ${args.join(' ')}`);
        execFile(cmd, args, { cwd: OUT, stdio: 'inherit', shell: process.platform === 'win32' });
    };
    console.log('pnpm install …');
    run('pnpm', ['install', '--prefer-offline']);
    console.log('npm run build (tsc -b && vite build) …');
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']);

    console.log('✅ real module bundle compiled AND built successfully');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
