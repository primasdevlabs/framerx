/**
 * Design AST → React app/page generation.
 */

import type { DesignDocument } from '@framer/compiler-ast';
import { DEFAULT_PROJECT_NAME, sanitizeComponentName } from '@framer/compiler-shared';

import type { VirtualFile } from '../types';

/**
 * Generate the main App.tsx file for the project.
 *
 * `sectionNames` are the deduplicated output names assigned by
 * generateProject; when omitted they derive from the root node names.
 */
export function generateApp(document: DesignDocument, sectionNames?: string[]): VirtualFile {
    const sections = sectionNames ?? document.nodes.map((node) => sanitizeComponentName(node.name));
    const sectionImports = sections
        .map((sectionName) => `import { ${sectionName} } from './sections/${sectionName}';`)
        .join('\n');
    // Each section gets a stable anchor class (`section-<kebab-case>`). The
    // generated sections MERGE a consumer className into their root element's
    // baked-in classes, so this lands on the rendered root — usable for
    // anchoring, scroll-margin styling, and per-section hooks.
    const sectionElements = sections
        .map((sectionName) => `            <${sectionName} className="${sectionClassName(sectionName)}" />`)
        .join('\n');

    const content = `${sectionImports}

export default function App() {
    return (
        <main className="min-h-screen bg-white">
${sectionElements}
        </main>
    );
}
`;

    return {
        path: 'src/App.tsx',
        content,
    };
}

/** The anchor class for a section output name (`HeroImage` → `section-hero-image`). */
function sectionClassName(sectionName: string): string {
    const kebab = sectionName
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `section-${kebab}`;
}

/**
 * Generate the main.tsx entry point file.
 *
 * Responsive styles are imported AFTER the base stylesheet so generated media
 * rules win at their tiers (later in the cascade, same specificity).
 */
export function generateMainEntry(includeResponsive = false, includeFonts = false): VirtualFile {
    const responsiveImport = includeResponsive ? "\nimport './styles/responsive.css';" : '';
    const fontImport = includeFonts ? "\nimport './styles/fonts.css';" : '';
    const content = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';${fontImport}${responsiveImport}
import App from './App';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
`;

    return {
        path: 'src/main.tsx',
        content,
    };
}

/** Generate the index.css file. */
export function generateIndexCss(): VirtualFile {
    const content = `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

img {
    max-width: 100%;
    height: auto;
}

/*
 * Responsive image swaps render as <picture><source …/><img …/></picture>.
 * The <picture> box is removed from layout (display: contents) so the <img>
 * stays the flex item / positioned element — exactly as it was without the
 * wrapper — while the <source media> elements pick the tier's image.
 */
picture {
    display: contents;
}
`;

    return {
        path: 'src/styles/index.css',
        content,
    };
}

/** Generate the vite-env.d.ts type declaration file. */
export function generateViteEnv(): VirtualFile {
    const content = `/// <reference types="vite/client" />
`;

    return {
        path: 'src/vite-env.d.ts',
        content,
    };
}

/** Generate the index.html file without silently substituting external fonts. */
export function generateIndexHtml(projectName: string, _fonts: string[] = []): VirtualFile {
    const title = projectName || DEFAULT_PROJECT_NAME;

    const content = `<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(title)}</title>
    </head>
    <body>
        <div id="root"></div>
        <script type="module" src="/src/main.tsx"></script>
    </body>
</html>
`;

    return {
        path: 'index.html',
        content,
    };
}

/** Escape HTML for safe inclusion in an HTML document. */
function escapeHtml(value: string): string {
    const amp = '\u0026';
    return value
        .replace(/&/g, `${amp}amp;`)
        .replace(/</g, `${amp}lt;`)
        .replace(/>/g, `${amp}gt;`)
        .replace(/"/g, `${amp}quot;`);
}
