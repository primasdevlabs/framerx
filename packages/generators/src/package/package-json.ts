/**
 * Generated project package.json.
 */

import { DEFAULT_PROJECT_NAME, sanitizeFileName } from '@framer/compiler-shared';

import type { VirtualFile } from '../types';

/** Generate the package.json file for the generated project. */
export function generatePackageJson(projectName: string): VirtualFile {
    const name = sanitizeFileName(projectName || DEFAULT_PROJECT_NAME);

    const content = JSON.stringify(
        {
            name: `@generated/${name}`,
            version: '0.1.0',
            private: true,
            type: 'module',
            scripts: {
                dev: 'vite',
                build: 'tsc -b && vite build',
                preview: 'vite preview',
                lint: 'eslint .',
                format: 'prettier --write "src/**/*.{ts,tsx,css}"',
            },
            dependencies: {
                react: '^19.0.0',
                'react-dom': '^19.0.0',
                motion: '^12.0.0',
            },
            devDependencies: {
                '@types/react': '^19.0.0',
                '@types/react-dom': '^19.0.0',
                '@vitejs/plugin-react': '^4.3.0',
                autoprefixer: '^10.4.0',
                eslint: '^9.0.0',
                '@eslint/js': '^9.0.0',
                'eslint-plugin-react-hooks': '^5.0.0',
                'eslint-plugin-react-refresh': '^0.4.0',
                'typescript-eslint': '^8.0.0',
                postcss: '^8.4.0',
                prettier: '^3.3.0',
                tailwindcss: '^3.4.0',
                typescript: '^5.5.0',
                vite: '^6.0.0',
            },
        },
        null,
        4,
    );

    return {
        path: 'package.json',
        content: `${content}\n`,
    };
}