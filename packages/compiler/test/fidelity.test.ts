/**
 * Fidelity & reconstruction:
 *   - exact values survive (no rounding into approximate Tailwind buckets)
 *   - colliding section names never produce duplicate files or imports
 *   - component slot/instance content flows into the generated code
 */

import { describe, expect, it } from 'vitest';

import type { DesignDocument, DesignNode } from '@framer/compiler-ast';
import { findFile, generateProject } from '@framer/compiler-generators';
import { mockFramerDocument, parseFramerDocument } from '@framer/compiler-parser';

import { compileFramerDocument } from '../src/index';

/** A minimal text node builder. */
function textNode(id: string, name: string, text: string, style: Record<string, unknown> = {}): DesignNode {
    return {
        type: 'text',
        id,
        name,
        frame: { x: 0, y: 0, width: 100, height: 30 },
        layout: {
            style: { strategy: 'auto' },
            position: { mode: 'static' },
            sizing: { widthMode: 'auto', heightMode: 'auto' },
            spacing: {},
        },
        style: {},
        constraints: { horizontal: 'left', vertical: 'top' },
        children: [],
        text: { text, style },
    };
}

/** A minimal container node builder. */
function frameNode(id: string, name: string, children: DesignNode[], style: DesignNode['style'] = {}): DesignNode {
    return {
        type: 'frame',
        id,
        name,
        frame: { x: 0, y: 0, width: 100, height: 100 },
        layout: {
            style: { strategy: 'auto' },
            position: { mode: 'static' },
            sizing: { widthMode: 'auto', heightMode: 'auto' },
            spacing: {},
        },
        style,
        constraints: { horizontal: 'left', vertical: 'top' },
        children,
    };
}

function makeDocument(nodes: DesignNode[]): DesignDocument {
    return {
        version: '1.0.0',
        name: 'Fidelity Doc',
        nodes,
        assets: [],
        fonts: [],
        breakpoints: [],
    };
}

describe('exact value fidelity', () => {
    it('does not round line heights into approximate Tailwind buckets', () => {
        const doc = makeDocument([
            frameNode('root', 'Text Section', [
                textNode('t1', 'Heading', 'Hello', { fontSize: 32, lineHeight: 1.1 }),
                textNode('t2', 'Body', 'World', { fontSize: 14, lineHeight: 1.32, letterSpacing: 0.03 }),
            ]),
        ]);
        const project = generateProject(doc);
        const section = findFile(project, 'src/sections/TextSection.tsx');

        // 1.1 → leading-[1.1], never leading-tight (1.25).
        expect(section!.content).toContain('leading-[1.1]');
        expect(section!.content).not.toContain('leading-tight');
        // 1.32 → exact arbitrary; 0.03em → exact arbitrary, never tracking-wide (0.025em).
        expect(section!.content).toContain('leading-[1.32]');
        expect(section!.content).toContain('tracking-[0.03em]');
        expect(section!.content).not.toContain('tracking-wide');
    });

    it('keeps exact border widths (no rounding to whole pixels)', () => {
        const doc = makeDocument([
            frameNode('root', 'Border Section', [], {
                strokes: [{ fill: { type: 'solid', color: '#94a3b8' }, width: 1.5, align: 'inside' }],
            }),
        ]);
        const project = generateProject(doc);
        const section = findFile(project, 'src/sections/BorderSection.tsx');

        expect(section!.content).toContain('border-[1.5px]');
        expect(section!.content).not.toContain('border border-1');
    });

    it('keeps fractional spacing precision in arbitrary values', () => {
        // 37.625px does not exist in the default scale → exact arbitrary value.
        const doc = makeDocument([frameNode('root', 'Size Section', [], { fills: [] })]);
        // Override the root's width to a fractional value.
        doc.nodes[0].frame = { ...doc.nodes[0].frame, width: 37.625 };
        doc.nodes[0].layout.sizing = { widthMode: 'fixed', heightMode: 'auto' };

        const project = generateProject(doc);
        const section = findFile(project, 'src/sections/SizeSection.tsx');
        expect(section!.content).toContain('w-[37.625px]');
    });
});

describe('unique output names', () => {
    it('deduplicates colliding section names without duplicate files or imports', () => {
        const doc = makeDocument([
            frameNode('a', 'Hero', [textNode('a1', 'A', 'First')]),
            frameNode('b', 'Hero', [textNode('b1', 'B', 'Second')]),
        ]);
        const project = generateProject(doc);

        expect(findFile(project, 'src/sections/Hero.tsx')).toBeDefined();
        expect(findFile(project, 'src/sections/Hero2.tsx')).toBeDefined();

        const app = findFile(project, 'src/App.tsx');
        expect(app!.content).toContain("import { Hero } from './sections/Hero';");
        expect(app!.content).toContain("import { Hero2 } from './sections/Hero2';");
        // No duplicate import of the same module.
        expect((app!.content.match(/from '\.\/sections\/Hero';/g) ?? []).length).toBe(1);
    });

    it('emits no duplicate output paths for the mock document', () => {
        const project = generateProject(parseFramerDocument(mockFramerDocument));
        const paths = project.files.map((file) => file.path);
        expect(new Set(paths).size).toBe(paths.length);
    });
});

describe('component reconstruction', () => {
    it('passes instance children into the component element', () => {
        const instance: DesignNode = {
            type: 'component',
            id: 'instance',
            name: 'Badge',
            frame: { x: 0, y: 0, width: 60, height: 30 },
            layout: {
                style: { strategy: 'auto' },
                position: { mode: 'static' },
                sizing: { widthMode: 'auto', heightMode: 'auto' },
                spacing: {},
            },
            style: {},
            constraints: { horizontal: 'left', vertical: 'top' },
            componentId: 'comp_badge',
            componentName: 'Badge',
            props: { label: 'New' },
            children: [textNode('child_label', 'Label', 'Custom child')],
        };
        const doc = makeDocument([frameNode('root', 'Badge Section', [instance])]);
        const project = generateProject(doc);

        const section = findFile(project, 'src/sections/BadgeSection.tsx');
        expect(section).toBeDefined();
        // The instance's children are rendered inside the component element —
        // they are never silently dropped.
        expect(section!.content).toContain('<Badge');
        expect(section!.content).toContain('Custom child');
    });

    it('walks slot content so its components and assets are collected', async () => {
        const result = await compileFramerDocument(
            {
                id: 'doc_slot',
                name: 'Slot Doc',
                version: '1.0.0',
                nodes: [
                    {
                        id: 'root',
                        type: 'Frame',
                        name: 'Slot Section',
                        frame: { x: 0, y: 0, width: 100, height: 100 },
                        layout: { strategy: 'auto' },
                        style: {},
                        children: [
                            {
                                id: 'card_instance',
                                type: 'Component',
                                name: 'Card',
                                frame: { x: 0, y: 0, width: 60, height: 60 },
                                layout: { strategy: 'auto' },
                                style: {},
                                component: {
                                    id: 'comp_card',
                                    name: 'Card',
                                    slots: {
                                        content: [
                                            {
                                                id: 'slot_button',
                                                type: 'Component',
                                                name: 'Button',
                                                frame: { x: 0, y: 0, width: 40, height: 20 },
                                                layout: { strategy: 'auto' },
                                                style: {},
                                                component: { id: 'comp_button', name: 'Button', props: {} },
                                                children: [],
                                            },
                                        ],
                                    },
                                },
                                children: [],
                            },
                        ],
                    },
                ],
            },
            { projectName: 'slot-demo' },
        );

        // The slot content's component is collected and generated.
        const button = result.files.find((f) => f.path === 'src/components/Button.tsx');
        expect(button).toBeDefined();
    });
});

describe('positioning fidelity', () => {
    /** A container with an absolutely positioned child (free-form design). */
    function freeForm(): DesignNode {
        return {
            type: 'frame',
            id: 'artboard',
            name: 'Artboard',
            frame: { x: 0, y: 0, width: 1200, height: 800 },
            layout: {
                style: { strategy: 'auto' },
                position: { mode: 'static' },
                sizing: { widthMode: 'fixed', heightMode: 'fixed' },
                spacing: {},
            },
            style: {},
            constraints: { horizontal: 'left', vertical: 'top' },
            children: [
                {
                    type: 'frame',
                    id: 'badge',
                    name: 'Badge',
                    frame: { x: 100, y: 60, width: 200, height: 48 },
                    layout: {
                        style: { strategy: 'absolute' },
                        position: { mode: 'absolute', left: 100, top: 60 },
                        sizing: { widthMode: 'fixed', heightMode: 'fixed' },
                        spacing: {},
                    },
                    style: {},
                    constraints: { horizontal: 'left', vertical: 'top' },
                    children: [],
                },
                {
                    type: 'frame',
                    id: 'card',
                    name: 'Card',
                    frame: { x: 300, y: 200, width: 600, height: 400 },
                    layout: {
                        style: { strategy: 'absolute' },
                        position: { mode: 'absolute', left: 300, top: 200 },
                        sizing: { widthMode: 'fixed', heightMode: 'fixed', maxWidth: 640, minHeight: 200 },
                        spacing: {},
                    },
                    style: {},
                    constraints: { horizontal: 'left', vertical: 'top' },
                    children: [],
                },
            ],
        };
    }

    it('emits offsets and a positioning context so free-form designs do not collapse', () => {
        const project = generateProject(makeDocument([freeForm()]));
        const section = findFile(project, 'src/sections/Artboard.tsx');
        expect(section).toBeDefined();

        // The container becomes the positioning context for its absolute children.
        expect(section!.content).toContain('relative');
        // Each absolute child lands at its exact designed position.
        expect(section!.content).toContain('absolute left-[100px] top-[60px]');
        expect(section!.content).toContain('absolute left-[300px] top-[200px]');
    });

    it('emits min/max sizing constraints (fill-but-cap and min sizes)', () => {
        const project = generateProject(makeDocument([freeForm()]));
        const section = findFile(project, 'src/sections/Artboard.tsx');
        expect(section!.content).toContain('max-w-[640px]');
        expect(section!.content).toContain('min-h-[200px]');
    });

    it('does not add a positioning context to containers without absolute children', () => {
        const doc = makeDocument([frameNode('root', 'Stack Section', [textNode('t', 'Label', 'Hi')])]);
        const project = generateProject(doc);
        const section = findFile(project, 'src/sections/StackSection.tsx');
        expect(section!.content).not.toContain('absolute');
    });
});

describe('leaf-root className merge', () => {
    /** A minimal image node builder (leaf root). */
    function imageNode(id: string, name: string): DesignNode {
        return {
            type: 'image',
            id,
            name,
            frame: { x: 0, y: 0, width: 100, height: 80 },
            layout: {
                style: { strategy: 'auto' },
                position: { mode: 'static' },
                sizing: { widthMode: 'fixed', heightMode: 'fixed' },
                spacing: {},
            },
            style: {},
            constraints: { horizontal: 'left', vertical: 'top' },
            asset: { src: 'assets/images/photo.png', name: 'photo' },
            objectFit: 'cover',
            children: [],
        };
    }

    /** A minimal vector node builder (leaf root). */
    function vectorNode(id: string, name: string): DesignNode {
        return {
            type: 'vector',
            id,
            name,
            frame: { x: 0, y: 0, width: 24, height: 24 },
            layout: {
                style: { strategy: 'auto' },
                position: { mode: 'static' },
                sizing: { widthMode: 'fixed', heightMode: 'fixed' },
                spacing: {},
            },
            style: {},
            constraints: { horizontal: 'left', vertical: 'top' },
            pathData: 'M0 0 L24 24',
            children: [],
        };
    }

    it('merges a consumer className into an image leaf root instead of dropping it', () => {
        const project = generateProject(makeDocument([imageNode('img_root', 'Hero Image')]));
        const section = findFile(project, 'src/sections/HeroImage.tsx');
        expect(section).toBeDefined();

        // The prop is destructured (previously skipped for leaf roots)…
        expect(section!.content).toContain('export function HeroImage({ className }: HeroImageProps)');
        // …and MERGED into the img's own classes (baked classes survive).
        expect(section!.content).toMatch(
            /<img[^>]*className=\{\`[^`]*object-cover\$\{className \? \` \$\{className\}\` : ''\}\`}/,
        );
        expect(section!.content).not.toContain('className="');
    });

    it('merges a consumer className into a text leaf root', () => {
        const project = generateProject(
            makeDocument([textNode('txt_root', 'Tagline', 'Hello world', { fontSize: 14 })]),
        );
        const section = findFile(project, 'src/sections/Tagline.tsx');
        expect(section).toBeDefined();

        expect(section!.content).toContain('export function Tagline({ className }: TaglineProps)');
        expect(section!.content).toMatch(
            /<p[^>]*className=\{\`[^`]*\$\{className \? \` \$\{className\}\` : ''\}\`}>Hello world<\/p>/,
        );
    });

    it('merges a consumer className into a vector leaf root', () => {
        const project = generateProject(makeDocument([vectorNode('vec_root', 'Icon')]));
        const section = findFile(project, 'src/sections/Icon.tsx');
        expect(section).toBeDefined();

        expect(section!.content).toContain('export function Icon({ className }: IconProps)');
        expect(section!.content).toMatch(/<svg[^>]*className=\{\`[^`]*\$\{className \? \` \$\{className\}\` : ''\}\`}/);
    });

    it('keeps nested (non-root) leaves static — no consumer prop merge inside containers', () => {
        const project = generateProject(
            makeDocument([frameNode('root', 'Gallery', [imageNode('nested_img', 'Thumb')])]),
        );
        const section = findFile(project, 'src/sections/Gallery.tsx');
        expect(section).toBeDefined();

        // The nested img keeps a static class string — there is no className
        // prop on the section to merge into it.
        expect(section!.content).toMatch(/<img[^>]*className="[^"]*object-cover"/);
        // Only the section ROOT carries the consumer prop (a root with no
        // baked classes passes it through directly).
        expect(section!.content).toMatch(/<div className=\{\`|className=\{className\}>/);
        expect((section!.content.match(/\$\{className \?/g) ?? []).length).toBe(0);
    });

    it('merges a consumer className into a container root (never replaces its layout classes)', () => {
        // A flex frame with a solid fill produces real baked classes.
        const hero = {
            ...frameNode('root', 'Hero', [textNode('t', 'Label', 'Hi')]),
            layout: {
                style: { strategy: 'flex' },
                position: { mode: 'static' },
                sizing: { widthMode: 'fixed', heightMode: 'fixed' },
                spacing: {},
            },
            style: { fills: [{ type: 'solid', color: '#f8fafc' }] },
        };
        const project = generateProject(makeDocument([hero]));
        const section = findFile(project, 'src/sections/Hero.tsx');
        expect(section).toBeDefined();

        // The root div keeps its baked classes AND appends the consumer's —
        // replacement would silently drop the layout classes.
        expect(section!.content).toMatch(/className=\{\`[^`]*flex[^`]*\$\{className \? \` \$\{className\}\` : ''\}\`}/);
        expect(section!.content).not.toContain('className={className ??');
    });

    it('passes a section-specific anchor className from App into every section', () => {
        const project = generateProject(
            makeDocument([frameNode('root', 'Hero', [textNode('t', 'Label', 'Hi')]), imageNode('img2', 'Hero Image')]),
        );
        const app = findFile(project, 'src/App.tsx');
        expect(app).toBeDefined();

        // Kebab-cased anchor classes, one per section, passed as className.
        expect(app!.content).toContain('<Hero className="section-hero" />');
        expect(app!.content).toContain('<HeroImage className="section-hero-image" />');
        // The section components accept the prop and merge it into their roots.
        const hero = findFile(project, 'src/sections/Hero.tsx');
        expect(hero!.content).toContain('export function Hero({ className }: HeroProps)');
        const heroImage = findFile(project, 'src/sections/HeroImage.tsx');
        expect(heroImage!.content).toContain('export function HeroImage({ className }: HeroImageProps)');
    });
});
