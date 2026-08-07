/**
 * Tests for the Phase 2 component extraction pass:
 *   repeated subtrees → reusable component + prop-driven instances.
 */

import { describe, expect, it } from 'vitest';

import type { DesignComponentNode, DesignDocument, DesignNode } from '@framer/compiler-ast';
import { findFile, generateProject } from '@framer/compiler-generators';
import { mockFramerDocument, parseFramerDocument } from '@framer/compiler-parser';

import { compile, compileFramerDocument, extractComponents } from '../src/index';

/** A minimal card subtree builder (frame + accent bar + title + body). */
function cardNode(id: string, title: string, body: string, accent = '#6366f1'): DesignNode {
    return {
        type: 'frame',
        id,
        name: 'Info Card',
        frame: { x: 0, y: 0, width: 320, height: 200 },
        layout: {
            style: { strategy: 'flex' },
            position: { mode: 'static' },
            sizing: { widthMode: 'fixed', heightMode: 'fixed' },
            spacing: {},
        },
        style: { fills: [{ type: 'solid', color: '#ffffff', visible: true }], radius: 12 },
        constraints: { horizontal: 'left', vertical: 'top' },
        children: [
            {
                type: 'frame',
                id: `${id}_accent`,
                name: 'Accent',
                frame: { x: 0, y: 0, width: 48, height: 8 },
                layout: {
                    style: { strategy: 'flex' },
                    position: { mode: 'static' },
                    sizing: { widthMode: 'fixed', heightMode: 'fixed' },
                    spacing: {},
                },
                style: { fills: [{ type: 'solid', color: accent, visible: true }], radius: 9999 },
                constraints: { horizontal: 'left', vertical: 'top' },
                children: [],
            },
            {
                type: 'text',
                id: `${id}_title`,
                name: 'Title',
                frame: { x: 0, y: 0, width: 320, height: 32 },
                layout: {
                    style: { strategy: 'auto' },
                    position: { mode: 'static' },
                    sizing: { widthMode: 'auto', heightMode: 'auto' },
                    spacing: {},
                },
                style: {},
                constraints: { horizontal: 'left', vertical: 'top' },
                text: { text: title, style: { fontSize: 18, fontWeight: 700 } },
                children: [],
            },
            {
                type: 'text',
                id: `${id}_body`,
                name: 'Description',
                frame: { x: 0, y: 40, width: 320, height: 80 },
                layout: {
                    style: { strategy: 'auto' },
                    position: { mode: 'static' },
                    sizing: { widthMode: 'auto', heightMode: 'auto' },
                    spacing: {},
                },
                style: {},
                constraints: { horizontal: 'left', vertical: 'top' },
                text: { text: body, style: { fontSize: 14 } },
                children: [],
            },
        ],
    };
}

/** A minimal section container (root nodes are not extraction candidates). */
function sectionNode(id: string, children: DesignNode[]): DesignNode {
    return {
        type: 'frame',
        id,
        name: 'Cards Section',
        frame: { x: 0, y: 0, width: 1200, height: 200 },
        layout: {
            style: { strategy: 'flex' },
            position: { mode: 'static' },
            sizing: { widthMode: 'fill', heightMode: 'auto' },
            spacing: {},
        },
        style: {},
        constraints: { horizontal: 'left', vertical: 'top' },
        children,
    };
}

/** Build a minimal design document. */
function makeDocument(...nodes: DesignNode[]): DesignDocument {
    return {
        version: '1.0.0',
        name: 'Test Doc',
        nodes,
        assets: [],
        fonts: [],
        breakpoints: [],
    };
}

describe('extractComponents', () => {
    it('extracts repeated identical subtrees into a single component', () => {
        const doc = makeDocument(
            sectionNode('s', [
                cardNode('a', 'Card A', 'Body A'),
                cardNode('b', 'Card B', 'Body B'),
                cardNode('c', 'Card C', 'Body C'),
            ]),
        );
        const extracted = extractComponents(doc);

        // All three cards become component instances of the same component.
        const components = extracted.nodes.flatMap((n) => collectNodesOfType(n));
        expect(components).toHaveLength(3);
        expect(components.every((c) => c.componentName === 'InfoCard')).toBe(true);
        expect(components.every((c) => c.componentId === 'component-info-card')).toBe(true);

        // Props hold each instance's text values.
        expect(components[0].props).toEqual({ title: 'Card A', description: 'Body A' });
        expect(components[1].props).toEqual({ title: 'Card B', description: 'Body B' });

        // The template is attached and carries prop markers.
        const template = components[0].template!;
        expect(collectPropMarkers(template)).toEqual(['title', 'description']);
    });

    it('extracts exact duplicates (identical text still becomes props)', () => {
        const doc = makeDocument(
            sectionNode('s', [
                cardNode('a', 'Same', 'Same'),
                cardNode('b', 'Same', 'Same'),
            ]),
        );
        const extracted = extractComponents(doc);

        const components = extracted.nodes.flatMap((n) => collectNodesOfType(n));
        expect(components).toHaveLength(2);
        expect(components[0].props).toEqual({ title: 'Same', description: 'Same' });
    });

    it('treats fill structure differences as variants (solid vs gradient)', () => {
        const a = cardNode('a', 'Card A', 'Body A');
        const b = cardNode('b', 'Card B', 'Body B');
        b.style = {
            fills: [
                {
                    type: 'linear',
                    angle: 90,
                    stops: [
                        { position: 0, color: '#111827' },
                        { position: 1, color: '#000000' },
                    ],
                    visible: true,
                },
            ],
            radius: 12,
        };

        const extracted = extractComponents(makeDocument(sectionNode('s', [a, b])));
        const components = extracted.nodes.flatMap((n) => collectNodesOfType(n));
        // Solid vs gradient is now a variant dimension, not a grouping boundary.
        expect(components).toHaveLength(2);
        const template = components[0].template!;
        expect(template.metadata?.custom?.variant).toBeDefined();
    });

    it('does not extract subtrees whose layout structure differs', () => {
        const a = cardNode('a', 'Card A', 'Body A');
        const b = cardNode('b', 'Card B', 'Body B');
        b.layout = { ...b.layout, style: { strategy: 'auto' } };

        const extracted = extractComponents(makeDocument(sectionNode('s', [a, b])));
        expect(extracted.nodes.flatMap((n) => collectNodesOfType(n))).toHaveLength(0);
    });

    it('does not extract cards shifted to different positions (grid items)', () => {
        const at = (x: number): DesignNode => {
            const node = cardNode(`card_${x}`, 'Same', 'Same');
            return { ...node, frame: { ...node.frame, x } };
        };
        const extracted = extractComponents(makeDocument(sectionNode('s', [at(0), at(484), at(888)])));

        const components = extracted.nodes.flatMap((n) => collectNodesOfType(n));
        expect(components).toHaveLength(3);
        expect(components[0].componentName).toBe('InfoCard');
    });

    it('never extracts single occurrences', () => {
        const extracted = extractComponents(makeDocument(sectionNode('s', [cardNode('a', 'Only', 'Once')])));
        expect(extracted.nodes.flatMap((n) => collectNodesOfType(n))).toHaveLength(0);
    });

    it('prefers larger (parent) duplicates over nested child duplicates', () => {
        // Two wrapper groups, each wrapping two identical cards → the wrappers
        // are extracted, and the nested cards must not also be extracted.
        const card = (id: string, title: string): DesignNode => cardNode(id, title, `${title} body`);
        const wrapper = (id: string, children: DesignNode[]): DesignNode => ({
            type: 'group',
            id,
            name: 'Card Grid',
            frame: { x: 0, y: 0, width: 680, height: 200 },
            layout: {
                style: { strategy: 'flex' },
                position: { mode: 'static' },
                sizing: { widthMode: 'auto', heightMode: 'auto' },
                spacing: {},
            },
            style: {},
            constraints: { horizontal: 'left', vertical: 'top' },
            children,
        });

        const doc = makeDocument(
            sectionNode('s', [
                wrapper('w1', [card('c1', 'One'), card('c2', 'Two')]),
                wrapper('w2', [card('c3', 'Three'), card('c4', 'Four')]),
            ]),
        );
        const extracted = extractComponents(doc);

        const components = extracted.nodes.flatMap((n) => collectNodesOfType(n));
        // The two wrappers (CardGrid) are extracted; the four cards inside are covered.
        expect(components).toHaveLength(2);
        expect(components.every((c) => c.componentName === 'CardGrid')).toBe(true);
    });

    it('is deterministic across runs', () => {
        const doc = makeDocument(
            sectionNode('s', [
                cardNode('a', 'Card A', 'Body A'),
                cardNode('b', 'Card B', 'Body B'),
            ]),
        );
        const first = extractComponents(doc);
        const second = extractComponents(doc);
        expect(first.nodes).toEqual(second.nodes);
    });

    it('renames prop keys that collide with reserved names (className, children…)', () => {
        // A text node named 'Class Name' must not produce a 'className' prop
        // (it would duplicate the base interface and break the generated code).
        const withTextNamed = (id: string, value: string): DesignNode => {
            const node = cardNode(id, value, 'Body');
            const title = node.children.find((child) => child.type === 'text')!;
            title.name = 'Class Name';
            return node;
        };
        const extracted = extractComponents(
            makeDocument(sectionNode('s', [withTextNamed('a', 'One'), withTextNamed('b', 'Two')])),
        );

        const components = extracted.nodes.flatMap((n) => collectNodesOfType(n));
        expect(components).toHaveLength(2);
        expect(Object.keys(components[0].props!)).toEqual(['classNameText', 'description']);
        expect(collectPropMarkers(components[0].template!)).toEqual(['classNameText', 'description']);
    });

    it('does not clash with component names already declared in the document', () => {
        // A repeated subtree named 'Feature Card' + an existing FeatureCard component.
        const card = (id: string, title: string): DesignNode => {
            const node = cardNode(id, title, 'Body');
            node.name = 'Feature Card';
            return node;
        };
        const existing: DesignComponentNode = {
            ...card('existing', 'Existing'),
            type: 'component',
            componentId: 'component_feature_card',
            componentName: 'FeatureCard',
            props: { title: 'Compiler First', description: 'A true compiler pipeline.' },
            children: [],
        };
        const doc = makeDocument(
            sectionNode('s', [card('a', 'One'), card('b', 'Two')]),
            sectionNode('t', [existing]),
        );
        const extracted = extractComponents(doc);

        const components = extracted.nodes.flatMap((n) => collectNodesOfType(n));
        const extractedCard = components.find((c) => c.id === 'a')!;
        expect(extractedCard.componentName).toBe('FeatureCard2');
        expect(extractedCard.componentId).toBe('component-feature-card2');
    });

    it('extracts a varying nested fill color as a prop (accent)', () => {
        const extracted = extractComponents(
            makeDocument(sectionNode('s', [
                cardNode('a', 'Card A', 'Body A', '#10b981'),
                cardNode('b', 'Card B', 'Body B', '#3b82f6'),
                cardNode('c', 'Card C', 'Body C', '#8b5cf6'),
            ])),
        );

        const components = extracted.nodes.flatMap((n) => collectNodesOfType(n));
        expect(components).toHaveLength(3);

        // The varying color becomes the 'accent' prop; constant styles do not.
        expect(components[0].props).toEqual({ accent: '#10b981', title: 'Card A', description: 'Body A' });
        expect(components[1].props).toEqual({ accent: '#3b82f6', title: 'Card B', description: 'Body B' });

        // The accent bar in the template carries the styleProps marker.
        const template = components[0].template!;
        const accentBar = template.children.find((c) => c.id === 'a_accent')!;
        expect(accentBar.metadata?.custom?.styleProps).toEqual({ backgroundColor: 'accent' });
        // The root keeps its (constant) background as a static style — no marker.
        expect(template.metadata?.custom?.styleProps).toBeUndefined();
    });

    it('extracts a varying root background color as the backgroundColor prop', () => {
        const card = (id: string, color: string): DesignNode => ({
            ...cardNode(id, 'T', 'B'),
            style: { fills: [{ type: 'solid', color, visible: true }], radius: 12 },
        });
        const extracted = extractComponents(makeDocument(sectionNode('s', [card('a', '#111827'), card('b', '#f8fafc')])));

        const components = extracted.nodes.flatMap((n) => collectNodesOfType(n));
        expect(components[0].props).toMatchObject({ backgroundColor: '#111827' });
        expect(components[1].props).toMatchObject({ backgroundColor: '#f8fafc' });
        expect(components[0].template!.metadata?.custom?.styleProps).toEqual({ backgroundColor: 'backgroundColor' });
    });

    it('extracts varying radius and size as numeric props', () => {
        const card = (id: string, radius: number, width: number): DesignNode => ({
            ...cardNode(id, 'T', 'B'),
            frame: { ...cardNode(id, 'T', 'B').frame, width },
            style: { fills: [{ type: 'solid', color: '#ffffff', visible: true }], radius },
        });
        const extracted = extractComponents(makeDocument(sectionNode('s', [card('a', 12, 380), card('b', 24, 360)])));

        const components = extracted.nodes.flatMap((n) => collectNodesOfType(n));
        expect(components[0].props).toMatchObject({ radius: 12, width: 380 });
        expect(components[1].props).toMatchObject({ radius: 24, width: 360 });
        expect(components[0].template!.metadata?.custom?.styleProps).toMatchObject({ radius: 'radius', width: 'width' });
    });

    it('extracts filled vs outlined buttons into a component with a variant prop', () => {
        const filled: DesignNode = {
            ...cardNode('f', 'Primary', 'Body'),
            name: 'Primary Button',
            style: { fills: [{ type: 'solid', color: '#6366f1', visible: true }], radius: 12 },
        };
        const outlined: DesignNode = {
            ...cardNode('o', 'Secondary', 'Body'),
            name: 'Secondary Button',
            style: { strokes: [{ fill: { type: 'solid', color: '#94a3b8' }, width: 1, align: 'inside' }], radius: 12 },
        };
        const extracted = extractComponents(makeDocument(sectionNode('s', [filled, outlined])));

        const components = extracted.nodes.flatMap((n) => collectNodesOfType(n));
        expect(components).toHaveLength(2);

        // Variant values derive from the member root names (kebab-case).
        expect(components[0].props!.variant).toBe('primary-button');
        expect(components[1].props!.variant).toBe('secondary-button');

        // The template root is variant-marked with the canonical value as default.
        const template = components[0].template!;
        expect(template.metadata?.custom?.variant).toMatchObject({
            propName: 'variant',
            default: 'primary-button',
        });
    });

    it('renders gradient variant members as per-variant backgrounds', () => {
        const solid = cardNode('a', 'Card A', 'Body A');
        const gradient = cardNode('b', 'Card B', 'Body B');
        gradient.style = {
            fills: [{
                type: 'linear',
                angle: 90,
                stops: [
                    { position: 0, color: '#111827' },
                    { position: 1, color: '#eef2f7' },
                ],
                visible: true,
            }],
            radius: 12,
        };

        const extracted = extractComponents(makeDocument(sectionNode('s', [solid, gradient])));
        const project = generateProject({
            version: '1.0.0',
            name: 'VariantGrad',
            nodes: extracted.nodes,
            assets: [],
            fonts: [],
            breakpoints: [],
        });
        const file = project.files.find((f) => f.path === 'src/components/InfoCard.tsx')!;
        expect(file).toBeDefined();

        // The solid member stays class-driven; the gradient member gets a
        // per-variant inline background with token-module stop references.
        expect(file.content).toContain('const variantBackgroundMap: Record<string, string>');
        expect(file.content).toContain("'info-card2': `linear-gradient(90deg, ${colors.gray900} 0%, ${colors.color1} 100%)`");
        expect(file.content).toContain("'info-card': 'bg-white'");
        expect(file.content).toContain("import { colors } from '../tokens';");
        expect(file.content).toContain('${variantBackgroundMap[variant] ?? undefined}');
    });

    it('deduplicates colliding variant values', () => {
        const a = { ...cardNode('a', 'One', 'Body'), name: 'Same Name', style: { fills: [{ type: 'solid', color: '#111827', visible: true }] } };
        const b = { ...cardNode('b', 'Two', 'Body'), name: 'Same Name', style: { strokes: [{ fill: { type: 'solid', color: '#94a3b8' }, width: 1, align: 'inside' }] } };
        const extracted = extractComponents(makeDocument(sectionNode('s', [a, b])));

        const components = extracted.nodes.flatMap((n) => collectNodesOfType(n));
        expect(components[0].props!.variant).toBe('same-name');
        expect(components[1].props!.variant).toBe('same-name2');
    });

    it('extracts varying gradient stops as a gradient prop', () => {
        const card = (id: string, color1: string, color2: string): DesignNode => {
            const node = cardNode(id, 'T', 'B');
            node.style = {
                fills: [{
                    type: 'linear',
                    angle: 135,
                    stops: [
                        { position: 0, color: color1 },
                        { position: 1, color: color2 },
                    ],
                    visible: true,
                }],
                radius: 12,
            };
            return node;
        };
        const extracted = extractComponents(makeDocument(sectionNode('s', [
            card('a', '#6366f1', '#8b5cf6'),
            card('b', '#10b981', '#0ea5e9'),
        ])));

        const components = extracted.nodes.flatMap((n) => collectNodesOfType(n));
        expect(components).toHaveLength(2);
        // Each instance carries its own gradient (stops keep their positions)
        // instead of silently keeping the canonical member's.
        expect(components[0].props).toMatchObject({
            gradient: {
                angle: 135,
                stops: [
                    { color: '#6366f1', position: 0 },
                    { color: '#8b5cf6', position: 1 },
                ],
            },
            title: 'T',
            description: 'B',
        });
        expect(components[1].props!.gradient).toEqual({
            angle: 135,
            stops: [
                { color: '#10b981', position: 0 },
                { color: '#0ea5e9', position: 1 },
            ],
        });
        // The template root is marked so the generator renders from the prop.
        expect(components[0].template!.metadata?.custom?.styleProps).toEqual({ gradient: 'gradient' });
    });

    it('extracts a varying nested gradient as a prop (accentGradient)', () => {
        const card = (id: string, color1: string, color2: string): DesignNode => {
            const node = cardNode(id, 'T', 'B');
            const bar = node.children[0];
            bar.name = 'Accent Gradient';
            bar.style = {
                fills: [{
                    type: 'linear',
                    angle: 90,
                    stops: [
                        { position: 0, color: color1 },
                        { position: 1, color: color2 },
                    ],
                    visible: true,
                }],
                radius: 9999,
            };
            return node;
        };
        const extracted = extractComponents(makeDocument(sectionNode('s', [
            card('a', '#6366f1', '#8b5cf6'),
            card('b', '#10b981', '#0ea5e9'),
        ])));

        const components = extracted.nodes.flatMap((n) => collectNodesOfType(n));
        expect(components).toHaveLength(2);
        // The nested bar's gradient becomes its own prop, named after the node.
        expect(components[0].props!.accentGradient).toEqual({
            angle: 90,
            stops: [
                { color: '#6366f1', position: 0 },
                { color: '#8b5cf6', position: 1 },
            ],
        });
        expect(components[1].props!.accentGradient).toEqual({
            angle: 90,
            stops: [
                { color: '#10b981', position: 0 },
                { color: '#0ea5e9', position: 1 },
            ],
        });
        // The nested template bar carries the gradient marker.
        const template = components[0].template!;
        const bar = template.children.find((c) => c.id === 'a_accent')!;
        expect(bar.metadata?.custom?.styleProps).toEqual({ gradient: 'accentGradient' });
        // The root keeps its constant background static — no marker.
        expect(template.metadata?.custom?.styleProps).toBeUndefined();
    });

    it('keeps constant gradients as static backgrounds (no prop)', () => {
        const card = (id: string): DesignNode => {
            const node = cardNode(id, 'T', 'B');
            node.style = {
                fills: [{
                    type: 'linear',
                    angle: 135,
                    stops: [
                        { position: 0, color: '#6366f1' },
                        { position: 1, color: '#8b5cf6' },
                    ],
                    visible: true,
                }],
                radius: 12,
            };
            return node;
        };
        const extracted = extractComponents(makeDocument(sectionNode('s', [card('a'), card('b')])));

        const components = extracted.nodes.flatMap((n) => collectNodesOfType(n));
        expect(components).toHaveLength(2);
        // Identical gradients are constant → no gradient prop, no marker.
        expect(components[0].props).toEqual({ title: 'T', description: 'B' });
        expect(components[0].template!.metadata?.custom?.styleProps).toBeUndefined();
    });

    it('does not turn constant style values into props', () => {
        const extracted = extractComponents(
            makeDocument(sectionNode('s', [
                cardNode('a', 'Same', 'Same', '#10b981'),
                cardNode('b', 'Same', 'Same', '#10b981'),
            ])),
        );

        const components = extracted.nodes.flatMap((n) => collectNodesOfType(n));
        expect(components[0].props).toEqual({ title: 'Same', description: 'Same' });
        expect(collectPropMarkers(components[0].template!)).toEqual(['title', 'description']);
    });

    it('does not extract slot-bearing subtrees (slot content cannot be passed)', () => {
        const withSlot = (id: string, text: string): DesignNode => ({
            type: 'frame',
            id,
            name: 'Slot Card',
            frame: { x: 0, y: 0, width: 320, height: 200 },
            layout: {
                style: { strategy: 'flex' },
                position: { mode: 'static' },
                sizing: { widthMode: 'fixed', heightMode: 'fixed' },
                spacing: {},
            },
            style: {},
            constraints: { horizontal: 'left', vertical: 'top' },
            children: [
                { type: 'slot', id: `${id}_slot`, name: 'content', slotName: 'content', frame: { x: 0, y: 0, width: 0, height: 0 }, layout: { style: { strategy: 'auto' } }, style: {}, constraints: { horizontal: 'left', vertical: 'top' }, children: [] },
                { ...cardNode(`${id}_label`, text, 'Body').children[0], id: `${id}_label` },
            ],
        });
        const extracted = extractComponents(makeDocument(sectionNode('s', [withSlot('a', 'One'), withSlot('b', 'Two')])));
        expect(extracted.nodes.flatMap((n) => collectNodesOfType(n))).toHaveLength(0);
    });
});

describe('extraction pipeline', () => {
    it('extracts the repeated testimonial cards from the mock document', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });

        // One extracted component file, with prop interpolation.
        const card = findFile({ name: 'Demo', files: result.files, nodes: result.nodes }, 'src/components/TestimonialCard.tsx');
        expect(card).toBeDefined();
        expect(card!.content).toContain('quote?: string;');
        expect(card!.content).toContain('author?: string;');
        expect(card!.content).toContain('{quote}');
        expect(card!.content).toContain('{author}');
        expect(card!.content).toContain('export function TestimonialCard({ className, quote, author }');

        // The section renders instances with prop overrides.
        const section = result.files.find((f) => f.path === 'src/sections/TestimonialsSection.tsx');
        expect(section).toBeDefined();
        expect(section!.content).toContain("import { TestimonialCard } from '../components/TestimonialCard';");
        expect(section!.content).toContain('quote="FramerX turned our design handoff into a one-click build."');
        expect(section!.content).toContain('author="Marcus Rivera, Staff Engineer"');
        expect((section!.content.match(/<TestimonialCard/g) ?? []).length).toBe(3);
    });

    it('does not emit duplicate JSX for the extracted cards', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });

        const section = result.files.find((f) => f.path === 'src/sections/TestimonialsSection.tsx');
        const quotes = section!.content.match(/FramerX turned|reads like our team|shipped our redesign/g);
        expect(quotes).toHaveLength(3);

        // The literal card structure appears exactly once — in the component file.
        const cardFiles = result.files.filter((f) => f.path.includes('TestimonialCard'));
        expect(cardFiles).toHaveLength(1);
    });

    it('extracts style props (accent colors) as inline styles', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });

        const card = findFile({ name: 'Demo', files: result.files, nodes: result.nodes }, 'src/components/StatCard.tsx');
        expect(card).toBeDefined();
        expect(card!.content).toContain('accent?: ColorValue;');
        expect(card!.content).toContain('style={{ backgroundColor: accent }}');
        // The accent bar's own background class is omitted (prop-driven).
        expect(card!.content).not.toContain('bg-[#10b981]');

        const section = result.files.find((f) => f.path === 'src/sections/MetricsSection.tsx');
        expect(section).toBeDefined();
        expect(section!.content).toContain("import { StatCard } from '../components/StatCard';");
        // Accent prop values reference the tokens module, not literal hex.
        expect(section!.content).toContain('accent={colors.emerald500}');
        expect(section!.content).toContain('accent={colors.violet500}');
        // Template-bearing instances pass only props — no redundant className.
        expect(section!.content).not.toMatch(/<StatCard[^>]*className=/);
    });

    it('extracts the hero buttons into a variant component with class switching', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });

        const button = result.files.find((f) => f.path === 'src/components/PrimaryButton.tsx');
        expect(button).toBeDefined();
        // The variant prop is typed as a union, defaulting to the canonical value.
        expect(button!.content).toContain("variant?: 'primary-button' | 'secondary-button';");
        expect(button!.content).toContain("variant = 'primary-button'");
        // Class record switches filled vs outlined.
        expect(button!.content).toContain("const variantClassMap: Record<string, string>");
        expect(button!.content).toContain("'primary-button': 'bg-indigo-500'");
        expect(button!.content).toContain("'secondary-button': 'border border-slate-400'");
        expect(button!.content).toContain('${variantClassMap[variant] ?? \'\'}');
        // Shared motion (hover) stays in the component.
        expect(button!.content).toContain('whileHover');

        const hero = result.files.find((f) => f.path === 'src/sections/HeroSection.tsx');
        expect(hero!.content).toContain('variant="primary-button"');
        expect(hero!.content).toContain('variant="secondary-button"');
        // The literal button markup appears once — in the component file.
        expect(hero!.content).not.toContain('bg-[#6366f1]');
    });

    it('renders gradient props with token references and typed props', () => {
        const card = (id: string, color1: string, color2: string): DesignNode => {
            const node = cardNode(id, 'T', 'B');
            node.style = {
                fills: [{
                    type: 'linear',
                    angle: 135,
                    stops: [
                        { position: 0, color: color1 },
                        { position: 1, color: color2 },
                    ],
                    visible: true,
                }],
                radius: 12,
            };
            return node;
        };
        const doc = makeDocument(
            sectionNode('s', [
                card('a', '#6366f1', '#8b5cf6'),
                card('b', '#10b981', '#0ea5e9'),
            ]),
        );
        const extracted = extractComponents(doc);
        const project = generateProject({
            version: '1.0.0',
            name: 'Gradients',
            nodes: extracted.nodes,
            assets: [],
            fonts: [],
            breakpoints: [],
        });

        // The component types the prop from the tokens module and renders the
        // background from it (stops interpolated directly — no token refs in
        // this file, so no unused colors import).
        const file = project.files.find((f) => f.path === 'src/components/InfoCard.tsx')!;
        expect(file).toBeDefined();
        expect(file.content).toContain("import { type GradientValue } from '../tokens';");
        expect(file.content).toContain('gradient?: GradientValue;');
        expect(file.content).toContain('background: `linear-gradient(${gradient.angle ?? 0}deg, ${gradient.stops.map((s) => `${s.color} ${Math.round(s.position * 1000) / 10}%`).join(\', \')})`');
        expect(file.content).not.toContain("import { colors }");

        // Instances pass object literals whose stops are token-referenced
        // color/position pairs.
        const section = project.files.find((f) => f.path === 'src/sections/CardsSection.tsx')!;
        expect(section).toBeDefined();
        expect(section!.content).toContain('gradient={{ stops: [{ color: colors.indigo500, position: 0 }, { color: colors.violet500, position: 1 }], angle: 135 }}');
        expect(section!.content).toContain('gradient={{ stops: [{ color: colors.emerald500, position: 0 }, { color: colors.sky500, position: 1 }], angle: 135 }}');
        expect(section!.content).toContain("import { colors } from '../tokens';");

        // The tokens module exports the GradientValue type and names the stops.
        const tokensFile = project.files.find((f) => f.path === 'src/tokens.ts')!;
        expect(tokensFile.content).toContain('export type GradientValue');
        expect(tokensFile.content).toContain("sky500: '#0ea5e9'");
    });

    it('renders radial gradient props with center references', () => {
        const card = (id: string, cx: number, cy: number, color2: string): DesignNode => {
            const node = cardNode(id, 'T', 'B');
            node.style = {
                fills: [{
                    type: 'radial',
                    center: { x: cx, y: cy },
                    radius: 0.5,
                    stops: [
                        { position: 0, color: '#6366f1' },
                        { position: 1, color: color2 },
                    ],
                    visible: true,
                }],
                radius: 12,
            };
            return node;
        };
        const doc = makeDocument(
            sectionNode('s', [
                card('a', 0.3, 0.7, '#8b5cf6'),
                card('b', 0.6, 0.2, '#10b981'),
            ]),
        );
        const extracted = extractComponents(doc);
        const project = generateProject({
            version: '1.0.0',
            name: 'Radials',
            nodes: extracted.nodes,
            assets: [],
            fonts: [],
            breakpoints: [],
        });

        // The component renders the radial background from the prop's center
        // and stop positions.
        const file = project.files.find((f) => f.path === 'src/components/InfoCard.tsx')!;
        expect(file).toBeDefined();
        expect(file.content).toContain('background: `radial-gradient(circle at ${(gradient.center?.x ?? 0.5) * 100}% ${(gradient.center?.y ?? 0.5) * 100}%, ${gradient.stops.map((s) => `${s.color} ${Math.round(s.position * 1000) / 10}%`).join(\', \')})`');

        // Instances pass centers and token-referenced stop color/position pairs.
        const section = project.files.find((f) => f.path === 'src/sections/CardsSection.tsx')!;
        expect(section).toBeDefined();
        expect(section!.content).toContain('gradient={{ stops: [{ color: colors.indigo500, position: 0 }, { color: colors.violet500, position: 1 }], center: { x: 0.3, y: 0.7 } }}');
        expect(section!.content).toContain('gradient={{ stops: [{ color: colors.indigo500, position: 0 }, { color: colors.emerald500, position: 1 }], center: { x: 0.6, y: 0.2 } }}');
    });

    it('carries non-even stop positions for exact fidelity', () => {
        const card = (id: string, midColor: string): DesignNode => {
            const node = cardNode(id, 'T', 'B');
            node.style = {
                fills: [{
                    type: 'linear',
                    angle: 135,
                    stops: [
                        { position: 0, color: '#6366f1' },
                        // 0.125 is a common stop that whole-percent rounding
                        // would corrupt (12.5% → 13%).
                        { position: 0.125, color: midColor },
                        { position: 1, color: '#8b5cf6' },
                    ],
                    visible: true,
                }],
                radius: 12,
            };
            return node;
        };
        const doc = makeDocument(sectionNode('s', [card('a', '#10b981'), card('b', '#0ea5e9')]));
        const extracted = extractComponents(doc);
        const components = extracted.nodes.flatMap((n) => collectNodesOfType(n));

        // A non-even middle stop survives extraction with its position.
        expect(components[0].props!.gradient).toEqual({
            angle: 135,
            stops: [
                { color: '#6366f1', position: 0 },
                { color: '#10b981', position: 0.125 },
                { color: '#8b5cf6', position: 1 },
            ],
        });

        const project = generateProject({
            version: '1.0.0',
            name: 'Fidelity',
            nodes: extracted.nodes,
            assets: [],
            fonts: [],
            breakpoints: [],
        });
        const section = project.files.find((f) => f.path === 'src/sections/CardsSection.tsx')!;
        expect(section!.content).toContain('gradient={{ stops: [{ color: colors.indigo500, position: 0 }, { color: colors.emerald500, position: 0.125 }, { color: colors.violet500, position: 1 }], angle: 135 }}');

        // The component renders each stop at its own percentage with one
        // decimal of precision (12.5%, not 13%).
        const file = project.files.find((f) => f.path === 'src/components/InfoCard.tsx')!;
        expect(file.content).toContain('Math.round(s.position * 1000) / 10');
    });

    it('renders radius and size props as valid inline styles', async () => {
        const card = (id: string, radius: number, width: number): DesignNode => ({
            ...cardNode(id, 'T', 'B'),
            frame: { ...cardNode(id, 'T', 'B').frame, width },
            style: { fills: [{ type: 'solid', color: '#ffffff', visible: true }], radius },
        });
        const doc = makeDocument(
            sectionNode('s', [card('a', 12, 380), card('b', 24, 360)]),
        );
        const extracted = extractComponents(doc);
        const project = generateProject({
            version: '1.0.0',
            name: 'Styles',
            nodes: extracted.nodes,
            assets: [],
            fonts: [],
            breakpoints: [],
        });
        const file = project.files.find((f) => f.path === 'src/components/InfoCard.tsx')!;
        expect(file).toBeDefined();
        // The slot must map to the real CSS property (radius → borderRadius)
        // and be typed as a number; the static classes are omitted.
        expect(file.content).toContain('style={{ borderRadius: radius, width: width }}');
        expect(file.content).toContain('radius?: RadiusValue;');
        expect(file.content).toContain('width?: SpacingValue;');
        expect(file.content).not.toContain('rounded-2xl');
        expect(file.content).not.toContain('w-[380px]');

        // Instances pass token references, not raw numbers.
        const section = project.files.find((f) => f.path === 'src/sections/CardsSection.tsx');
        expect(section).toBeDefined();
        expect(section!.content).toContain('radius={radii[12]} width={spacing[95]}');
        expect(section!.content).toContain('radius={radii[24]} width={spacing[90]}');
    });

    it('can disable extraction via compile options', async () => {
        const result = await compileFramerDocument(mockFramerDocument, {
            projectName: 'demo',
            extractComponents: false,
        });

        const card = result.files.find((f) => f.path === 'src/components/TestimonialCard.tsx');
        expect(card).toBeUndefined();
        const section = result.files.find((f) => f.path === 'src/sections/TestimonialsSection.tsx');
        expect(section!.content).not.toContain('TestimonialCard');
    });

    it('still compiles a plain AST end-to-end', async () => {
        const doc = parseFramerDocument(mockFramerDocument);
        const result = await compile(doc, { projectName: 'extracted', zip: true });

        expect(result.name).toBe('Extracted');
        expect(result.zip).toBeDefined();
        expect(result.files.some((f) => f.path === 'src/components/TestimonialCard.tsx')).toBe(true);
    });
});

/** Collect component nodes beneath a node. */
function collectNodesOfType(node: DesignNode): DesignComponentNode[] {
    const out: DesignComponentNode[] = [];
    const visit = (n: DesignNode): void => {
        if (n.type === 'component') out.push(n);
        for (const child of n.children) visit(child);
    };
    visit(node);
    return out;
}

/** Collect the prop markers found in a template. */
function collectPropMarkers(node: DesignNode): string[] {
    const out: string[] = [];
    const visit = (n: DesignNode): void => {
        const prop = n.metadata?.custom?.prop;
        if (typeof prop === 'string') out.push(prop);
        for (const child of n.children) visit(child);
    };
    visit(node);
    return out;
}
