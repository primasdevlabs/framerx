/**
 * Responsive behavior: extracted from the source document (never assumed
 * Tailwind sm/md/lg) and emitted as CSS media queries at the document's own
 * breakpoints.
 */

import { describe, expect, it } from 'vitest';

import type { DesignDocument, DesignNode } from '@framer/compiler-ast';
import { findFile, generateProject } from '@framer/compiler-generators';
import { mockFramerDocument, parseFramerDocument } from '@framer/compiler-parser';

import { compileFramerDocument } from '../src/index';
import { validateExport } from '../src/validate';

/** A minimal container node with an explicit id/name. */
function node(id: string, name: string, children: DesignNode[] = []): DesignNode {
    return {
        type: 'frame',
        id,
        name,
        frame: { x: 0, y: 0, width: 100, height: 100 },
        layout: { style: { strategy: 'flex' }, position: { mode: 'static' }, sizing: { widthMode: 'fixed', heightMode: 'fixed' }, spacing: {} },
        style: {},
        constraints: { horizontal: 'left', vertical: 'top' },
        children,
    };
}

/** Build a design document with the given breakpoints and nodes. */
function documentWith(breakpoints: DesignDocument['breakpoints'], nodes: DesignNode[]): DesignDocument {
    return {
        version: '1.0.0',
        name: 'Responsive Doc',
        nodes,
        assets: [],
        fonts: [],
        breakpoints,
    };
}

describe('responsive extraction', () => {
    it('uses the source document breakpoints, not Tailwind defaults', () => {
        const doc = parseFramerDocument(mockFramerDocument);

        expect(doc.breakpoints).toEqual([
            { name: 'mobile', minWidth: 0 },
            { name: 'tablet', minWidth: 768 },
            { name: 'desktop', minWidth: 1024 },
        ]);
        // Never the assumed Tailwind scale.
        expect(doc.breakpoints.map((bp) => bp.name)).not.toContain('sm');
    });

    it('extracts per-breakpoint overrides into the node layout', () => {
        const doc = parseFramerDocument(mockFramerDocument);

        // Hero frame: tablet padding override.
        const hero = doc.nodes[0];
        expect(hero.layout.responsive?.breakpoints?.tablet?.spacing?.padding).toEqual({ top: 56, right: 24, bottom: 56, left: 24 });

        // Heading text: tablet font-size override (normalized).
        const heading = hero.children[0];
        expect(heading.layout.responsive?.breakpoints?.tablet?.style?.fontSize).toBe(48);

        // Nodes without responsive behavior carry none.
        const cards = doc.nodes[1];
        expect(cards.children[0].layout.responsive).toBeUndefined();
    });

    it('falls back to the default breakpoints when the source defines none', () => {
        const doc = parseFramerDocument({ id: 'doc', name: 'No BPs', nodes: [] });
        expect(doc.breakpoints.length).toBeGreaterThan(0);
        expect(doc.breakpoints[0].name).toBe('sm');
    });
});

describe('responsive CSS generation', () => {
    it('emits media queries at the document breakpoints with exact values', () => {
        const project = generateProject(parseFramerDocument(mockFramerDocument));

        const css = findFile(project, 'src/styles/responsive.css');
        expect(css).toBeDefined();

        // Tablet tier only (the mock defines no desktop overrides).
        expect(css!.content).toContain('@media (min-width: 768px)');
        expect(css!.content).not.toContain('@media (min-width: 1024px)');
        // No assumed Tailwind breakpoints.
        expect(css!.content).not.toContain('min-width: 640px');

        // The hero padding and heading font-size overrides are present.
        expect(css!.content).toContain('padding-top: 56px');
        expect(css!.content).toContain('padding-bottom: 56px');
        expect(css!.content).toContain('font-size: 48px');
        // The cards grid gap override too.
        expect(css!.content).toContain('gap: 16px');

        // Deterministic class names (hashed from source ids).
        expect(css!.content).toMatch(/\.fx-rsp-[a-f0-9]{12}/);
    });

    it('is imported after the base stylesheet so media rules win', () => {
        const project = generateProject(parseFramerDocument(mockFramerDocument));
        const main = findFile(project, 'src/main.tsx');
        expect(main!.content).toContain("import './styles/index.css';");
        expect(main!.content).toContain("import './styles/responsive.css';");
        // Responsive comes after the base import.
        expect(main!.content.indexOf('responsive.css')).toBeGreaterThan(main!.content.indexOf('index.css'));
    });

    it('appends the responsive class to nodes with responsive behavior', () => {
        const project = generateProject(parseFramerDocument(mockFramerDocument));
        const hero = findFile(project, 'src/sections/HeroSection.tsx');

        expect(hero!.content).toMatch(/className=\{className \?\? "[^"]*fx-rsp-[a-f0-9]{12}/);
    });

    it('keeps fractional values exact in media queries', () => {
        const withOverride: DesignNode = {
            ...node('w-375', 'Wide Card'),
            layout: {
                ...node('w-375', 'Wide Card').layout,
                responsive: {
                    breakpoints: {
                        desktop: {
                            sizing: { width: 37.625, height: 300 },
                        },
                    },
                },
            },
        };
        const project = generateProject(documentWith([{ name: 'desktop', minWidth: 1024 }], [withOverride]));
        const css = findFile(project, 'src/styles/responsive.css');

        expect(css!.content).toContain('width: 37.625px');
        expect(css!.content).toContain('height: 300px');
        expect(css!.content).toContain('@media (min-width: 1024px)');
    });

    it('uses non-standard breakpoint widths from the source', () => {
        const withOverride: DesignNode = {
            ...node('w', 'Col'),
            layout: {
                ...node('w', 'Col').layout,
                responsive: { breakpoints: { large: { sizing: { width: 500 } } } },
            },
        };
        const project = generateProject(documentWith([{ name: 'large', minWidth: 900 }], [withOverride]));
        const css = findFile(project, 'src/styles/responsive.css');

        expect(css!.content).toContain('@media (min-width: 900px)');
        expect(css!.content).toContain('width: 500px');
    });

    it('emits hideOn as display:none and visible:false overrides', () => {
        const hidden: DesignNode = {
            ...node('hidden-node', 'Sidebar'),
            layout: {
                ...node('hidden-node', 'Sidebar').layout,
                responsive: {
                    breakpoints: { tablet: { visible: false } },
                    hideOn: ['mobile'],
                },
            },
        };
        const project = generateProject(documentWith([{ name: 'mobile', minWidth: 0 }, { name: 'tablet', minWidth: 768 }], [hidden]));
        const css = findFile(project, 'src/styles/responsive.css');

        expect(css!.content).toContain('display: none');
        expect(css!.content).toContain('@media (min-width: 768px)');
    });

    it('does not emit responsive.css when nothing is responsive', () => {
        const project = generateProject(documentWith([], [node('plain', 'Plain')]));
        expect(findFile(project, 'src/styles/responsive.css')).toBeUndefined();
        const main = findFile(project, 'src/main.tsx');
        expect(main!.content).not.toContain('responsive.css');
    });
});

describe('responsive end-to-end', () => {
    it('compiles the mock with responsive styles and passes validation', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'rsp-demo' });

        const css = result.files.find((f) => f.path === 'src/styles/responsive.css');
        expect(css).toBeDefined();
        expect(css!.content).toContain('@media (min-width: 768px)');

        expect(result.diagnostics.validation.valid).toBe(true);
        expect(result.diagnostics.errors).toBe(0);
    });

    it('is deterministic across exports', async () => {
        const a = await compileFramerDocument(mockFramerDocument, { projectName: 'rsp-demo' });
        const b = await compileFramerDocument(mockFramerDocument, { projectName: 'rsp-demo' });

        const cssA = a.files.find((f) => f.path === 'src/styles/responsive.css')!.content;
        const cssB = b.files.find((f) => f.path === 'src/styles/responsive.css')!.content;
        expect(cssA).toBe(cssB);
    });

    it('validates responsive classes end-to-end', async () => {
        // A real Framer document with responsive behavior compiles and passes.
        const result = await compileFramerDocument(
            {
                id: 'doc_r',
                name: 'Responsive Doc',
                breakpoints: [{ name: 'tablet', minWidth: 768 }],
                nodes: [
                    {
                        id: 'r_node',
                        type: 'Frame',
                        name: 'Responsive Row',
                        frame: { x: 0, y: 0, width: 100, height: 100 },
                        layout: { strategy: 'flex' },
                        style: {},
                        responsive: { tablet: { sizing: { width: 200 } } },
                        children: [],
                    },
                ],
            },
            { projectName: 'r' },
        );
        expect(result.diagnostics.validation.valid).toBe(true);
        const css = result.files.find((f) => f.path === 'src/styles/responsive.css');
        expect(css).toBeDefined();
        expect(css!.content).toContain('@media (min-width: 768px)');

        // A code file using a responsive class with no stylesheet fails.
        const bad = await validateExport([
            { path: 'package.json', content: JSON.stringify({ name: 'x' }) },
            { path: 'src/App.tsx', content: 'export function App() { return <div className="fx-rsp-aaaaaaaaaaaa" />; }\n' },
        ]);
        expect(bad.valid).toBe(false);
        expect(bad.errors.some((e) => e.stage === 'responsive')).toBe(true);
    });
});
