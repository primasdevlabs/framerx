/**
 * Export validation: the exporter must never knowingly ship broken code.
 */

import { describe, expect, it } from 'vitest';

import type { DesignDocument, DesignNode } from '@framer/compiler-ast';
import type { VirtualFile } from '@framer/compiler-generators';

import { compile, compileFramerDocument, ExportValidationError } from '../src/index';
import { validateExport } from '../src/validate';

/** A minimal well-formed project file set. */
function makeFiles(overrides: VirtualFile[] = []): VirtualFile[] {
    return [
        { path: 'package.json', content: JSON.stringify({ name: 'x', version: '0.1.0', private: true }) },
        { path: 'src/App.tsx', content: `import { Hero } from './sections/Hero';\nexport default function App() { return <Hero />; }\n` },
        { path: 'src/sections/Hero.tsx', content: `export function Hero() { return <div className="w-4">hi</div>; }\n` },
        { path: 'src/tokens.ts', content: `export const colors = {} as const;\n` },
        ...overrides,
    ];
}

describe('validateExport', () => {
    it('accepts a well-formed project', async () => {
        const result = await validateExport(makeFiles());
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('rejects duplicate output paths', async () => {
        const files = makeFiles([{ path: 'src/App.tsx', content: '// duplicated path\n' }]);
        const result = await validateExport(files);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes('Duplicate output file'))).toBe(true);
    });

    it('rejects duplicate imports in a file', async () => {
        const files = makeFiles([
            {
                path: 'src/sections/Bad.tsx',
                content: `import { Hero } from './Hero';\nimport { Hero } from './Hero';\n`,
            },
            { path: 'src/sections/Hero.tsx', content: `export function Hero() { return null; }\n` },
        ]);
        const result = await validateExport(files);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes("Duplicate import: Hero from './Hero'"))).toBe(true);
    });

    it('rejects imports that do not resolve to a generated file', async () => {
        const files = makeFiles([
            { path: 'src/sections/Bad.tsx', content: `import { Missing } from './Missing';\nexport function Bad() { return <Missing />; }\n` },
        ]);
        const result = await validateExport(files);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes("'./Missing'"))).toBe(true);
    });

    it('rejects files with syntax errors', async () => {
        const files = makeFiles([{ path: 'src/sections/Broken.tsx', content: `export function Broken( { return <div>; }\n` }]);
        const result = await validateExport(files);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.stage === 'codegen' && e.message.includes('Syntax error'))).toBe(true);
    });

    it('rejects asset references that point at missing files', async () => {
        const files = makeFiles([
            { path: 'src/sections/Img.tsx', content: `export function Img() { return <img src="../assets/images/missing.png" />; }\n` },
        ]);
        const result = await validateExport(files);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.stage === 'assets' && e.message.includes('missing.png'))).toBe(true);
    });

    it('rejects an invalid package.json', async () => {
        const files = makeFiles([{ path: 'package.json', content: '{ not json' }]);
        const result = await validateExport(files);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.path === 'package.json')).toBe(true);
    });

    it('warns (but does not fail) on remote references', async () => {
        const files = makeFiles([
            { path: 'src/sections/Remote.tsx', content: `export function Remote() { return <img src="https://cdn.example/x.png" />; }\n` },
        ]);
        const result = await validateExport(files);
        expect(result.valid).toBe(true);
        expect(result.warnings.some((w) => w.message.includes('https://cdn.example/x.png'))).toBe(true);
    });

    it('warns on remote URLs inside generated CSS url() references (responsive.css)', async () => {
        // A frame-fill image swap whose alternate has no local bytes falls back
        // to the raw remote URL in background-image: url(...) — that must be
        // reported exactly like a remote JSX src.
        const files = makeFiles([
            {
                path: 'src/styles/responsive.css',
                content: `@media (min-width: 768px) {\n    .fx-rsp-abc {\n        background-image: url("https://cdn.example/hero-tablet.png");\n    }\n}\n`,
            },
        ]);
        const result = await validateExport(files);
        expect(result.valid).toBe(true);
        expect(result.warnings.some((w) => w.message.includes('https://cdn.example/hero-tablet.png'))).toBe(true);
        expect(result.warnings.some((w) => w.stage === 'assets')).toBe(true);
    });

    it('does not warn on local CSS url() references', async () => {
        const files = makeFiles([
            { path: 'src/assets/images/hero-tablet.png', content: '', binary: true, data: new Uint8Array([1]) },
            {
                path: 'src/styles/responsive.css',
                content: `.fx-rsp-abc { background-image: url("../assets/images/hero-tablet.png"); }\n`,
            },
        ]);
        const result = await validateExport(files);
        expect(result.valid).toBe(true);
        expect(result.warnings.filter((w) => w.message.includes('hero-tablet.png'))).toEqual([]);
    });

    it('reports statistics', async () => {
        const result = await validateExport(makeFiles());
        expect(result.statistics.files).toBeGreaterThanOrEqual(4);
        expect(result.statistics.components).toBeGreaterThanOrEqual(0);
    });
});

describe('compile validation wiring', () => {
    it('throws ExportValidationError when the generated project is invalid', async () => {
        // An image node whose src points at a non-existent local asset path
        // generates a broken reference → validation must block the export.
        const brokenImage: DesignNode = {
            type: 'image',
            id: 'img_broken',
            name: 'Broken Image',
            frame: { x: 0, y: 0, width: 100, height: 100 },
            layout: { style: { strategy: 'auto' }, position: { mode: 'static' }, sizing: { widthMode: 'fixed', heightMode: 'fixed' }, spacing: {} },
            style: {},
            constraints: { horizontal: 'left', vertical: 'top' },
            children: [],
            asset: { id: 'asset_broken', type: 'image', src: '../assets/images/nope.png', name: 'nope' },
        };
        const document: DesignDocument = {
            version: '1.0.0',
            name: 'Broken Doc',
            nodes: [brokenImage],
            assets: [],
            fonts: [],
            breakpoints: [],
        };

        await expect(compile(document, { projectName: 'broken' })).rejects.toBeInstanceOf(ExportValidationError);
    });

    it('passes validation for the mock document and reports diagnostics', async () => {
        const result = await compileFramerDocument({ id: 'doc', name: 'Diagnostics', nodes: [], version: '1.0.0' }, { projectName: 'diag' });

        expect(result.diagnostics).toBeDefined();
        expect(result.diagnostics.errors).toBe(0);
        expect(result.diagnostics.generatedFiles).toBeGreaterThan(10);
        expect(result.diagnostics.assetsDiscovered).toBe(0);
        expect(result.diagnostics.validation.valid).toBe(true);
    });

    it('counts components, instances, nodes and assets for a real document', async () => {
        const result = await compileFramerDocument(
            {
                id: 'doc_real',
                name: 'Real',
                version: '1.0.0',
                nodes: [
                    {
                        id: 'root',
                        type: 'Frame',
                        name: 'Root Section',
                        frame: { x: 0, y: 0, width: 100, height: 100 },
                        layout: { strategy: 'auto' },
                        style: {},
                        children: [
                            {
                                id: 'instance_1',
                                type: 'Component',
                                name: 'Card',
                                frame: { x: 0, y: 0, width: 50, height: 50 },
                                layout: { strategy: 'auto' },
                                style: {},
                                component: { id: 'comp_card', name: 'Card', props: { title: 'One' } },
                                children: [],
                            },
                            {
                                id: 'instance_2',
                                type: 'Component',
                                name: 'Card',
                                frame: { x: 60, y: 0, width: 50, height: 50 },
                                layout: { strategy: 'auto' },
                                style: {},
                                component: { id: 'comp_card', name: 'Card', props: { title: 'Two' } },
                                children: [],
                            },
                        ],
                    },
                ],
            },
            { projectName: 'counts' },
        );

        expect(result.diagnostics.componentInstances).toBe(2);
        expect(result.diagnostics.uniqueComponents).toBe(1);
        expect(result.diagnostics.nodesDiscovered).toBe(3);
        expect(result.diagnostics.validation.valid).toBe(true);
    });
});
