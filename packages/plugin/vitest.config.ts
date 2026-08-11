/**
 * Plugin test configuration.
 *
 * This package also ships a `vite.config.ts` (for the plugin build), which
 * vitest would otherwise pick up as its config and silently fall back to the
 * 5s default test timeout. This file takes precedence (`vitest.config.*` is
 * checked before `vite.config.*`), scopes tests to this package, and applies
 * the 20s integration-test timeout so the full-pipeline exporter tests never
 * flake on a loaded machine. The @framer aliases mirror the root
 * `vitest.config.ts` so tests run against source, not stale dist output.
 */
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/** Build a source alias for a workspace package. */
function alias(pkg: string): string {
    return fileURLToPath(new URL(`../${pkg}/src/index.ts`, import.meta.url));
}

export default defineConfig({
    resolve: {
        alias: {
            '@framer/compiler-ast': alias('ast'),
            '@framer/compiler-shared': alias('shared'),
            '@framer/compiler-parser': alias('parser'),
            '@framer/compiler-generators': alias('generators'),
            '@framer/compiler-formatter': alias('formatter'),
            '@framer/compiler-zip': alias('zip'),
        },
    },
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts'],
        testTimeout: 20000,
    },
});
