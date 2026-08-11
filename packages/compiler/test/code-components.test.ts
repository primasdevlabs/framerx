/**
 * Code components — real source fetched through the SDK (`getCodeFiles`).
 *
 * A code component has no canvas master: its definition is the actual source,
 * emitted verbatim as the implementation instead of a synthesized
 * approximation. These tests pin the full path:
 *   - the definition is marked 'code' (never 'synthesized', never a warning)
 *   - the real file is emitted at its project path with addPropertyControls
 *     machinery stripped
 *   - sections/instances reference it with the correct import form (named vs
 *     default export) and pass real props + children
 *   - the transitive relative-import closure is emitted too
 *   - bare imports become package.json dependencies (reported when unknown)
 */

import { describe, expect, it } from 'vitest';

import type { FramerDocument, FramerNode } from '@framer/compiler-parser';

import { compileFramerDocument } from '../src/index';

/** A Framer code-component instance carrying its real source. */
function codeInstance(
    id: string,
    componentId: string,
    name: string,
    code: NonNullable<NonNullable<FramerNode['component']>['code']>,
    props?: Record<string, unknown>,
    children: FramerNode[] = [],
): FramerNode {
    return {
        id,
        type: 'Component',
        name,
        frame: { x: 0, y: 0, width: 320, height: 200 },
        layout: { strategy: 'auto' },
        style: {},
        component: { id: componentId, name, props, code },
        children,
    };
}

/** A frame node (the section root). */
function sectionRoot(id: string, name: string, children: FramerNode[]): FramerNode {
    return {
        id,
        type: 'Frame',
        name,
        frame: { x: 0, y: 0, width: 1440, height: 900 },
        layout: { strategy: 'flex', direction: 'column', alignItems: 'flex-start' },
        style: {},
        children,
    };
}

/** A text node (instance children). */
function textNode(id: string, name: string, text: string): FramerNode {
    return {
        id,
        type: 'Text',
        name,
        frame: { x: 0, y: 0, width: 200, height: 32 },
        layout: { strategy: 'auto' },
        style: {},
        text: { text, style: { fontFamily: 'Inter', fontSize: 16 } },
        children: [],
    };
}

const phosphorCode = {
    source: `import { motion } from 'framer-motion'
import { addPropertyControls, ControlType } from 'framer'

export function Phosphor({ icon, size = 24 }: { icon: string; size?: number }) {
    return <motion.svg width={size} height={size}>{icon}</motion.svg>
}

addPropertyControls(Phosphor, {
    icon: { type: ControlType.String, title: 'Icon' },
    size: { type: ControlType.Number, title: 'Size', defaultValue: 24 },
})
`,
    fileName: 'Phosphor.tsx',
    path: 'code/Phosphor.tsx',
    exportName: 'Phosphor',
    isDefaultExport: false,
};

/** A document with a code-backed Phosphor instance in a Hero section. */
function makeDocument(instances: FramerNode[]): FramerDocument {
    return {
        id: 'doc_code',
        name: 'Code Components Doc',
        version: '1.0.0',
        nodes: [sectionRoot('root', 'Hero Section', instances)],
    };
}

describe('code-component definitions', () => {
    it('marks the definition as code-backed — never synthesized, never warned', async () => {
        const result = await compileFramerDocument(
            makeDocument([codeInstance('p1', 'comp_phosphor', 'Phosphor', phosphorCode)]),
            { projectName: 'code-demo' },
        );

        // No synthesized-body warning — the real source was used.
        const synthesized = result.diagnostics.validation.warnings.find((w) => w.message.includes('synthesized'));
        expect(synthesized).toBeUndefined();
        expect(result.diagnostics.componentsFromCode).toBe(1);
        expect(result.diagnostics.componentsSynthesized).toBe(0);
    });

    it('emits the real source at its project path, stripped of addPropertyControls', async () => {
        const result = await compileFramerDocument(
            makeDocument([codeInstance('p1', 'comp_phosphor', 'Phosphor', phosphorCode)]),
            { projectName: 'code-demo' },
        );

        const file = result.files.find((f) => f.path === 'src/code/Phosphor.tsx');
        expect(file).toBeDefined();
        // The real implementation survives.
        expect(file!.content).toContain('export function Phosphor');
        expect(file!.content).toContain("from 'framer-motion'");
        // The Framer-runtime machinery is stripped.
        expect(file!.content).not.toContain('addPropertyControls');
        expect(file!.content).not.toContain("from 'framer'");
        expect(file!.content).not.toContain('ControlType');
    });

    it('references code components with the named-export import form and real props', async () => {
        const result = await compileFramerDocument(
            makeDocument([codeInstance('p1', 'comp_phosphor', 'Phosphor', phosphorCode, { icon: 'house', size: 32 })]),
            { projectName: 'code-demo' },
        );

        const section = result.files.find((f) => f.path === 'src/sections/HeroSection.tsx')!;
        // The import points at the code file, not src/components.
        expect(section.content).toContain("import { Phosphor } from '../code/Phosphor';");
        // The instance renders with its real prop values.
        expect(section.content).toContain('<Phosphor icon="house" size={32} />');
    });

    it('uses the default-import form for default-export code components', async () => {
        const result = await compileFramerDocument(
            makeDocument([
                codeInstance('t1', 'comp_ticker', 'Ticker', {
                    source: `export default function Ticker({ text }: { text: string }) {\n    return <div>{text}</div>\n}\n`,
                    fileName: 'Ticker.tsx',
                    path: 'code/Ticker.tsx',
                    exportName: 'Ticker',
                    isDefaultExport: true,
                }),
            ]),
            { projectName: 'code-demo' },
        );

        const section = result.files.find((f) => f.path === 'src/sections/HeroSection.tsx')!;
        expect(section.content).toContain("import Ticker from '../code/Ticker';");
        expect(section.content).toContain('<Ticker');
    });

    it('passes instance children through to code components', async () => {
        const result = await compileFramerDocument(
            makeDocument([
                codeInstance('c1', 'comp_card', 'Card', {
                    source: `export function Card({ children }: { children?: React.ReactNode }) {\n    return <div className=\"card\">{children}</div>\n}\n`,
                    fileName: 'Card.tsx',
                    path: 'code/Card.tsx',
                    exportName: 'Card',
                    isDefaultExport: false,
                }, {}, [textNode('child', 'Body', 'Inside the card')]),
            ]),
            { projectName: 'code-demo' },
        );

        const section = result.files.find((f) => f.path === 'src/sections/HeroSection.tsx')!;
        expect(section.content).toContain('<Card>');
        expect(section.content).toContain('Inside the card');
        expect(section.content).toContain('</Card>');
        // No "carries children but no children slot" warning — the real source
        // decides where children render.
        const warning = result.diagnostics.validation.warnings.find((w) => w.message.includes('carries children'));
        expect(warning).toBeUndefined();
    });

    it('emits the transitive relative-import closure of the code file', async () => {
        const result = await compileFramerDocument(
            makeDocument([
                codeInstance('p1', 'comp_phosphor', 'Phosphor', {
                    source: `import { Icon } from './Icon'\n\nexport function Phosphor() {\n    return <Icon />\n}\n`,
                    fileName: 'Phosphor.tsx',
                    path: 'code/Phosphor.tsx',
                    exportName: 'Phosphor',
                    isDefaultExport: false,
                    dependencies: [
                        { path: 'code/Icon.tsx', source: `export function Icon() {\n    return <svg />\n}\n` },
                    ],
                }),
            ]),
            { projectName: 'code-demo' },
        );

        expect(result.files.find((f) => f.path === 'src/code/Phosphor.tsx')).toBeDefined();
        const icon = result.files.find((f) => f.path === 'src/code/Icon.tsx');
        expect(icon).toBeDefined();
        expect(icon!.content).toContain('export function Icon');
        expect(result.diagnostics.validation.valid).toBe(true);
    });

    it('collects bare imports into package.json and reports unknown dependencies', async () => {
        const result = await compileFramerDocument(
            makeDocument([
                codeInstance('p1', 'comp_phosphor', 'Phosphor', {
                    source: `import { motion } from 'framer-motion'\nimport confetti from 'canvas-confetti'\n\nexport function Phosphor() {\n    return <motion.div />\n}\n`,
                    fileName: 'Phosphor.tsx',
                    path: 'code/Phosphor.tsx',
                    exportName: 'Phosphor',
                    isDefaultExport: false,
                }),
            ]),
            { projectName: 'code-demo' },
        );

        const pkg = result.files.find((f) => f.path === 'package.json')!;
        const json = JSON.parse(pkg.content) as { dependencies: Record<string, string> };
        // Known motion library pinned; unknown one added as '*' and reported.
        expect(json.dependencies['framer-motion']).toBe('^12.0.0');
        expect(json.dependencies['canvas-confetti']).toBe('*');
        const warning = result.diagnostics.validation.warnings.find((w) => w.message.includes('unknown dependencies'));
        expect(warning).toBeDefined();
        expect(warning!.message).toContain('canvas-confetti');
    });

    it('is deterministic across exports', async () => {
        const doc = makeDocument([codeInstance('p1', 'comp_phosphor', 'Phosphor', phosphorCode)]);
        const a = await compileFramerDocument(doc, { projectName: 'code-demo' });
        const b = await compileFramerDocument(doc, { projectName: 'code-demo' });

        expect(a.files.map((f) => f.content)).toEqual(b.files.map((f) => f.content));
    });
});
