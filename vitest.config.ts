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
        },
    },
    test: {
        environment: 'node',
        include: ['packages/**/test/**/*.test.ts'],
    },
});
