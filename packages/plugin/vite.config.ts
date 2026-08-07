import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import framer from 'vite-plugin-framer';

/**
 * FramerX Compiler plugin — Vite configuration.
 *
 * `vite-plugin-framer` adapts the bundle for the Framer plugin runtime
 * (dev shell, HTTPS, and packaging). `vite dev` also works standalone:
 * the app detects the absence of the Framer engine and runs in demo mode
 * with a mock document — set VITE_FRAMER_STANDALONE=1 to force it.
 *
 * The workspace aliases bundle the compiler packages from source so the
 * plugin is self-contained and does not depend on their dist output.
 */

/** Build a source alias for a workspace package. */
function alias(pkg: string): string {
    return fileURLToPath(new URL(`../${pkg}/src/index.ts`, import.meta.url));
}

export default defineConfig({
    plugins: [react(), framer()],
    resolve: {
        alias: {
            '@framer/compiler-ast': alias('ast'),
            '@framer/compiler-shared': alias('shared'),
            '@framer/compiler-parser': alias('parser'),
            '@framer/compiler-generators': alias('generators'),
            '@framer/compiler-formatter': alias('formatter'),
            '@framer/compiler-zip': alias('zip'),
            '@framer/compiler': alias('compiler'),
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
    },
});
