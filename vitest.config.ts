import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/** Build a source alias for a workspace package. */
function alias(pkg: string): string {
    return fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));
}

export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    resolve: {
        alias: {
            '@framer/compiler-ast': alias('ast'),
            '@framer/compiler-shared': alias('shared'),
            '@framer/compiler-parser': alias('parser'),
            '@framer/compiler-generators': alias('generators'),
            '@framer/compiler-formatter': alias('formatter'),
            '@framer/compiler-zip': alias('zip'),
            '@framer/visual-regression': alias('visual-regression'),
        },
    },
    test: {
        environment: 'node',
        include: ['packages/**/test/**/*.test.ts'],
        // Integration tests run the full pipeline (generate → format →
        // validate → ZIP) two or three times per test; on loaded developer
        // machines concurrent workers push those well past the 5s default.
        testTimeout: 20000,
    },
});
