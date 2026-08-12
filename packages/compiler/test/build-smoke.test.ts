/**
 * Generated-project build smoke test.
 *
 * Compiles a small document, writes the generated React project to disk, and
 * runs the project's REAL build (`pnpm install` + `tsc -b` + `vite build`).
 * The generated tsconfig is strict with `noUnusedLocals`/`noUnusedParameters`,
 * so this catches the whole class of "compiles as JSX but fails the strict
 * build" regressions — unused imports (TS6133), unused destructured props,
 * invalid JSX expressions — that unit tests on generated strings miss.
 *
 * The document exercises the strict-build-sensitive paths: a leaf image root
 * with a `<picture>` swap (className merge), a frame with a swappable image
 * fill (tokens import + base-fill CSS), a text leaf root, and a gradient
 * frame (tokens import actually used).
 *
 * Runs in the DEFAULT suite (no VR_BROWSER gate) so CI catches these. A
 * content-hash cache skips re-install/re-build when the generated output has
 * not changed, keeping repeated local runs fast.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { FramerDocument } from '@framer/compiler-parser';

import { compileFramerDocument } from '../src/index';

/** The cache root for the smoke build (gitignored). */
const CACHE_DIR = join(process.cwd(), '.vr-build-smoke-test');

/** Run a command in a directory, throwing with output tail on failure. */
function runInDir(cwd: string, command: string, args: string[]): void {
    // Windows: package-manager entry points are `.cmd` shims that can only be
    // launched through the shell (spawnSync on the shim itself → EINVAL).
    const cmd = process.platform === 'win32' ? 'cmd.exe' : command;
    const cmdArgs = process.platform === 'win32' ? ['/c', command, ...args] : args;
    const result = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8', timeout: 300_000 });
    if (result.error) {
        throw new Error(`\`${command} ${args.join(' ')}\` could not be started in ${cwd}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        const tail = (result.stdout || result.stderr || '').split('\n').slice(-25).join('\n');
        throw new Error(`\`${command} ${args.join(' ')}\` failed in ${cwd}:\n${tail}`);
    }
}

/** The strict-build-sensitive document: leaf roots, a swappable image fill, a gradient. */
function smokeDocument(): FramerDocument {
    const bytes = (v: number): Uint8Array => new Uint8Array([v, v, v]);
    return {
        id: 'doc_build_smoke',
        name: 'Build Smoke',
        breakpoints: [
            { name: 'tablet', minWidth: 768 },
            { name: 'desktop', minWidth: 1024 },
        ],
        nodes: [
            {
                id: 'photo',
                type: 'Image',
                name: 'Photo',
                frame: { x: 0, y: 0, width: 300, height: 200 },
                layout: { strategy: 'auto' },
                style: {},
                image: {
                    src: 'assets/images/photo.png',
                    name: 'photo',
                    alt: 'A',
                    mimeType: 'image/png',
                    data: bytes(1),
                },
                children: [],
                responsive: {
                    desktop: {
                        image: {
                            src: 'assets/images/photo-desktop.png',
                            name: 'photo-desktop',
                            mimeType: 'image/png',
                            data: bytes(2),
                        },
                    },
                },
            },
            {
                id: 'banner',
                type: 'Frame',
                name: 'Banner',
                frame: { x: 0, y: 0, width: 400, height: 120 },
                layout: { strategy: 'auto' },
                style: {
                    fills: [
                        {
                            type: 'image',
                            image: {
                                src: 'assets/images/banner.png',
                                name: 'banner',
                                mimeType: 'image/png',
                                data: bytes(3),
                            },
                        },
                    ],
                },
                children: [],
                responsive: {
                    tablet: {
                        image: {
                            src: 'assets/images/banner-tablet.png',
                            name: 'banner-tablet',
                            mimeType: 'image/png',
                            data: bytes(4),
                        },
                    },
                },
            },
            {
                id: 'tagline',
                type: 'Text',
                name: 'Tagline',
                frame: { x: 0, y: 0, width: 200, height: 40 },
                layout: { strategy: 'auto' },
                style: {},
                text: { runs: [], style: { fontSize: 24 } },
                children: [],
            },
            {
                id: 'hero',
                type: 'Frame',
                name: 'Hero',
                frame: { x: 0, y: 0, width: 800, height: 300 },
                layout: { strategy: 'auto' },
                style: {
                    fills: [
                        {
                            type: 'linear',
                            gradient: {
                                angle: 135,
                                stops: [
                                    { position: 0, color: '#6366f1' },
                                    { position: 1, color: '#8b5cf6' },
                                ],
                            },
                        },
                    ],
                },
                children: [],
            },
        ],
    };
}

/**
 * A stable hash of the generated project's SOURCE (never node_modules/dist —
 * those change on every install/build and would defeat the cache).
 */
async function projectHash(projectDir: string): Promise<string> {
    const hash = createHash('sha256');
    const files = await readDirFiles(projectDir);
    for (const file of files.sort()) {
        hash.update(file);
        hash.update(await readFile(file));
    }
    return hash.digest('hex');
}

/** Recursively list every file under a directory, skipping build artifacts. */
async function readDirFiles(dir: string): Promise<string[]> {
    const { readdir } = await import('node:fs/promises');
    const out: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await readDirFiles(full)));
        else out.push(full);
    }
    return out;
}

describe('generated project strict build (smoke)', () => {
    it('compiles, installs, and builds a generated project without strict-build failures', async () => {
        const projectName = 'BuildSmoke';
        const runDir = join(CACHE_DIR, projectName);
        const generatedDir = join(runDir, 'generated');
        const distDir = join(generatedDir, 'dist');
        const hashFile = join(runDir, 'build.hash');

        const compiled = await compileFramerDocument(smokeDocument(), { projectName });
        await mkdir(generatedDir, { recursive: true });
        for (const file of compiled.files) {
            const target = join(generatedDir, file.path);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, file.binary && file.data ? file.data : file.content);
        }

        // Skip re-install/re-build when the generated output is unchanged
        // (keeps repeated local runs fast — the regression guard still
        // fires the moment any generated file changes).
        const hash = await projectHash(generatedDir);
        const distExists = existsSync(join(distDir, 'index.html'));
        let built = distExists && existsSync(hashFile) && (await readFile(hashFile, 'utf8')) === hash;
        if (!built) {
            // The generated project gets its OWN pnpm workspace marker so
            // `pnpm install` resolves react/vite/tailwind independently
            // instead of being absorbed by the monorepo above it.
            await writeFile(join(generatedDir, 'pnpm-workspace.yaml'), 'packages:\n  - "**"\n');
            runInDir(generatedDir, 'pnpm', ['install', '--prefer-offline']);
            runInDir(generatedDir, 'pnpm', ['build']);
            await writeFile(hashFile, hash);
            built = true;
        }
        expect(built, 'generated project was built').toBe(true);

        // The production build shipped: entry HTML + a real JS bundle.
        const indexHtml = await readFile(join(distDir, 'index.html'), 'utf8');
        expect(indexHtml).toContain('/assets/index-');
        expect(existsSync(join(distDir, 'assets'))).toBe(true);
        // The local images made it into dist/ (public/ copy).
        expect(existsSync(join(distDir, 'assets', 'images', 'photo.png'))).toBe(true);
        expect(existsSync(join(distDir, 'assets', 'images', 'banner.png'))).toBe(true);

        // The strict build itself is the assertion: any unused import,
        // unused destructured prop, or broken JSX expression fails it.
        const section = compiled.files.find((f) => f.path === 'src/sections/Photo.tsx');
        expect(section).toBeDefined();
        expect(section!.content).toContain('className={`');
    }, 300_000);
});
