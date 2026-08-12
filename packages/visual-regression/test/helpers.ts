/**
 * Shared helpers for the opt-in build/browser e2e tests (VR_BROWSER=1).
 *
 * These tests compile a FramerDocument into a generated React project, run
 * `pnpm install` + `pnpm build` inside it, and then verify the PRODUCTION
 * build (`dist/`) — either served in a real browser or scanned on disk. They
 * are skipped by default because they need a working pnpm + network/cache
 * (and, for the browser ones, a Chrome install).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { compileFramerDocument } from '@framer/compiler';
import type { FramerDocument } from '@framer/compiler-parser';

import { encodePng } from '../src/compare/png';
import { runInDir } from '../src/run';

/** A 4x4 solid-color PNG — real bytes a browser can decode and render. */
export function solidPng(color: [number, number, number]): Buffer {
    const size = 4;
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i += 1) {
        data[i * 4] = color[0];
        data[i * 4 + 1] = color[1];
        data[i * 4 + 2] = color[2];
        data[i * 4 + 3] = 255;
    }
    return encodePng({ width: size, height: size, data });
}

/**
 * Compile a document into a generated React project, write it to disk, and
 * run `pnpm install` + `pnpm build` inside it. Returns the generated project
 * directory and the production build directory.
 */
export async function buildGeneratedProject(
    document: FramerDocument,
    projectName: string,
    runDir: string,
): Promise<{ generatedDir: string; distDir: string }> {
    const generatedDir = join(runDir, 'generated');
    const compiled = await compileFramerDocument(document, { projectName });
    await mkdir(generatedDir, { recursive: true });
    for (const file of compiled.files) {
        const target = join(generatedDir, file.path);
        await mkdir(join(target, '..'), { recursive: true });
        await writeFile(target, file.binary && file.data ? file.data : file.content);
    }
    // The generated project gets its OWN pnpm workspace marker so `pnpm
    // install` inside it resolves react/motion/tailwind independently
    // instead of being absorbed by the monorepo workspace above it.
    await writeFile(join(generatedDir, 'pnpm-workspace.yaml'), 'packages:\n  - "**"\n');
    await runInDir(generatedDir, 'pnpm', ['install', '--prefer-offline']);
    await runInDir(generatedDir, 'pnpm', ['build']);

    return { generatedDir, distDir: join(generatedDir, 'dist') };
}
