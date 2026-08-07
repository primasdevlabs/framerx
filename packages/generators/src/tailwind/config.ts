/**
 * Tailwind configuration file generation.
 *
 * The theme extends the Tailwind defaults with the design tokens extracted
 * from the document (see tokens.ts) — the exact values the class generator
 * prefers: non-palette colors (`color-1`), off-scale radii (`rounded-20`),
 * and off-scale spacing/sizes (`py-15`, `w-95`). Palette colors and default
 * scales resolve through Tailwind's built-in theme, so they need no entry.
 */

import type { DesignDocument } from '@framer/compiler-ast';
import { DEFAULT_FONT_SIZES, toKebabCase } from '@framer/compiler-shared';
import type { VirtualFile } from '../types';

import { extractTokens, walkEmittedTrees, type DesignTokens } from './tokens';

/** Generate the tailwind.config.ts file. */
export function generateTailwindConfig(document: DesignDocument, tokens: DesignTokens = extractTokens(document)): VirtualFile {
    const fontFamilies = extractFontFamilies(document);

    const content = `import type { Config } from 'tailwindcss';

const config: Config = {
    content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
    theme: {
        extend: {
            colors: ${formatObject(tokens.colors)},
            fontSize: ${formatObject(formatFontSizes(extractFontSizes(document)))},
            borderRadius: ${formatObject(formatRadius(tokens.radii))},
            spacing: ${formatObject(formatSpacing(tokens.spacing))},
            fontFamily: ${formatObject(fontFamilies)},
        },
    },
    plugins: [],
};

export default config;
`;

    return {
        path: 'tailwind.config.ts',
        content,
    };
}

/** Extract unique font sizes from emitted nodes (incl. component templates). */
function extractFontSizes(document: DesignDocument): number[] {
    const sizes = new Set<number>();
    walkEmittedTrees(document, (node) => {
        if (node.type === 'text' && node.text.style.fontSize !== undefined) {
            sizes.add(node.text.style.fontSize);
        }
    });
    return Array.from(sizes).sort((a, b) => a - b);
}

/** Extract font families from emitted nodes (incl. component templates). */
function extractFontFamilies(document: DesignDocument): Record<string, string> {
    const families: Record<string, string> = {};
    walkEmittedTrees(document, (node) => {
        if (node.type === 'text' && node.text.style.fontFamily) {
            const key = toKebabCase(node.text.style.fontFamily);
            families[key] = node.text.style.fontFamily;
        }
    });
    return families;
}

/**
 * Format font sizes as a Tailwind extension object.
 * Only real scale keys are emitted; arbitrary sizes (`text-[64px]`) resolve
 * without a theme entry.
 */
function formatFontSizes(sizes: number[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const size of sizes) {
        const key = Object.entries(DEFAULT_FONT_SIZES).find(([, v]) => v === size)?.[0];
        if (key !== undefined) result[key] = `${size}px`;
    }
    return result;
}

/** Format radius tokens as a Tailwind extension object (`'20': '20px'`). */
function formatRadius(radii: Record<string, number>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(radii)) {
        result[key] = `${value}px`;
    }
    return result;
}

/** Format spacing tokens as a Tailwind extension object (`'15': '60px'`). */
function formatSpacing(values: Record<string, number>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
        result[key] = `${value}px`;
    }
    return result;
}

/** Format an object as a TypeScript object literal. */
function formatObject(obj: Record<string, unknown>): string {
    if (Object.keys(obj).length === 0) return '{}';
    const entries = Object.entries(obj)
        .map(([key, value]) => {
            const k = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `'${key}'`;
            const v = typeof value === 'string' ? `'${value.replace(/'/g, "\\'")}'` : String(value);
            return `    ${k}: ${v},`;
        })
        .join('\n');
    return `{\n${entries}\n  }`;
}
