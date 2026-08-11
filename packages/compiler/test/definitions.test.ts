/**
 * Definition/instance separation:
 *   - one implementation file per component definition
 *   - instances render as references (props + slot content), never duplicated
 *   - source components without a master body synthesize prop-driven content
 *     instead of silently dropping it
 *   - named slot content renders at its slot position; default (children)
 *     content passes through the children slot
 */

import { describe, expect, it } from 'vitest';

import type { DesignComponentNode, DesignDocument, DesignNode } from '@framer/compiler-ast';
import { findFile, generateProject } from '@framer/compiler-generators';
import { mockFramerDocument, parseFramerDocument } from '@framer/compiler-parser';

import { compileFramerDocument, optimizeDocument, separateComponents } from '../src/index';

/** A minimal frame node builder. */
function frameNode(id: string, name: string, children: DesignNode[], style: DesignNode['style'] = {}): DesignNode {
    return {
        type: 'frame',
        id,
        name,
        frame: { x: 0, y: 0, width: 100, height: 100 },
        layout: { style: { strategy: 'flex' }, position: { mode: 'static' }, sizing: { widthMode: 'fixed', heightMode: 'fixed' }, spacing: {} },
        style,
        constraints: { horizontal: 'left', vertical: 'top' },
        children,
    };
}

/** A minimal text node builder. */
function textNode(id: string, name: string, text: string): DesignNode {
    return {
        type: 'text',
        id,
        name,
        frame: { x: 0, y: 0, width: 100, height: 30 },
        layout: { style: { strategy: 'auto' }, position: { mode: 'static' }, sizing: { widthMode: 'auto', heightMode: 'auto' }, spacing: {} },
        style: {},
        constraints: { horizontal: 'left', vertical: 'top' },
        children: [],
        text: { text, style: {} },
    };
}

/** A minimal component instance builder. */
function instanceNode(id: string, name: string, componentId: string, props: Record<string, unknown>, children: DesignNode[] = [], slots?: Record<string, DesignNode[]>): DesignComponentNode {
    return {
        type: 'component',
        id,
        name,
        frame: { x: 0, y: 0, width: 60, height: 60 },
        layout: { style: { strategy: 'auto' }, position: { mode: 'static' }, sizing: { widthMode: 'auto', heightMode: 'auto' }, spacing: {} },
        style: {},
        constraints: { horizontal: 'left', vertical: 'top' },
        componentId,
        componentName: name,
        props,
        slots,
        children,
    };
}

function makeDocument(nodes: DesignNode[]): DesignDocument {
    return {
        version: '1.0.0',
        name: 'Defs Doc',
        nodes,
        assets: [],
        fonts: [],
        breakpoints: [],
    };
}

describe('definition model', () => {
    it('models one definition per component identity with a props interface and body', () => {
        const doc = optimizeDocument(parseFramerDocument(mockFramerDocument));
        const separated = separateComponents(doc);

        expect(separated.components).toBeDefined();
        const names = separated.components!.map((c) => c.name);
        // One definition per reusable component — never one per instance.
        expect(names.filter((n) => n === 'FeatureCard')).toHaveLength(1);
        expect(names.filter((n) => n === 'TestimonialCard')).toHaveLength(1);

        const featureCard = separated.components!.find((c) => c.name === 'FeatureCard')!;
        expect(featureCard.id).toBe('component_feature_card');
        expect(featureCard.props).toMatchObject({ title: { type: 'string' }, description: { type: 'string' } });
        expect(featureCard.defaults).toMatchObject({ title: 'Compiler First' });
        // The body renders the props — nothing is dropped.
        expect(featureCard.body.children.length).toBeGreaterThan(0);
    });

    it('is deterministic across runs', () => {
        const a = separateComponents(parseFramerDocument(mockFramerDocument));
        const b = separateComponents(parseFramerDocument(mockFramerDocument));
        expect(a.components).toEqual(b.components);
    });

    it('keeps a shared template as the single definition body', () => {
        const doc = optimizeDocument(parseFramerDocument(mockFramerDocument));
        const separated = separateComponents(doc);
        const testimonial = separated.components!.find((c) => c.name === 'TestimonialCard')!;
        // The body is the extracted template — prop-marked text nodes inside.
        expect(testimonial.body).toBeDefined();
        expect(testimonial.props).toMatchObject({ quote: { type: 'string' }, author: { type: 'string' } });
    });
});

describe('one implementation per definition', () => {
    it('generates a single FeatureCard implementation with prop-driven content', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });

        const cardFiles = result.files.filter((f) => f.path === 'src/components/FeatureCard.tsx');
        expect(cardFiles).toHaveLength(1);
        const card = cardFiles[0];
        // The previously-lost content renders from props — never an empty div.
        expect(card.content).toContain('title?: string;');
        expect(card.content).toContain('description?: string;');
        expect(card.content).toContain('{title}');
        expect(card.content).toContain('{description}');

        // Both instances are references with their own prop values.
        const section = result.files.find((f) => f.path === 'src/sections/FeaturesSection.tsx')!;
        expect(section.content).toContain('<FeatureCard title="Compiler First" description="A true compiler pipeline, not a simple exporter." />');
        expect(section.content).toContain('<FeatureCard title="Platform Agnostic" description="The core compiler never depends on Framer APIs." />');
        expect((section.content.match(/<FeatureCard/g) ?? []).length).toBe(2);
        // The card body exists exactly once — in the component file.
        expect(section.content).not.toContain('{title}');
    });

    it('emits one file for extracted components and reference instances', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });

        const cardFiles = result.files.filter((f) => f.path === 'src/components/TestimonialCard.tsx');
        expect(cardFiles).toHaveLength(1);
        const section = result.files.find((f) => f.path === 'src/sections/TestimonialsSection.tsx')!;
        expect((section.content.match(/<TestimonialCard/g) ?? []).length).toBe(3);
    });
});

describe('slot content', () => {
    it('passes instance children through the default slot', () => {
        const doc = makeDocument([
            frameNode('root', 'Badge Section', [
                instanceNode('instance', 'Badge', 'comp_badge', { label: 'New' }, [textNode('child_label', 'Label', 'Custom child')]),
            ]),
        ]);
        const project = generateProject(doc);

        // The section renders the reference with the child inside the element.
        const section = findFile(project, 'src/sections/BadgeSection.tsx')!;
        expect(section.content).toContain('<Badge');
        expect(section.content).toContain('Custom child');
        expect((section.content.match(/Custom child/g) ?? []).length).toBe(1);

        // The implementation is a single file with a children slot position.
        const badge = findFile(project, 'src/components/Badge.tsx')!;
        expect(badge.content).toContain('children?: ReactNode;');
        expect(badge.content).toContain('{children}');
    });

    it('renders named slot content at its slot position', () => {
        const button = instanceNode('slot_button', 'Button', 'comp_button', {});
        const doc = makeDocument([
            frameNode('root', 'Card Section', [
                instanceNode('card_instance', 'Card', 'comp_card', {}, [], { content: [button] }),
            ]),
        ]);
        const project = generateProject(doc);

        // The implementation declares the named slot and renders it.
        const card = findFile(project, 'src/components/Card.tsx')!;
        expect(card.content).toContain('content?: ReactNode;');
        expect(card.content).toContain('{content}');

        // The instance passes the slot content as a JSX expression prop.
        const section = findFile(project, 'src/sections/CardSection.tsx')!;
        expect(section.content).toContain('content={<Button />}');
        expect(section.content).toContain("import { Button } from '../components/Button';");
        expect(section.content).toContain("import { Card } from '../components/Card';");

        // The slot content's own component is generated too.
        expect(findFile(project, 'src/components/Button.tsx')).toBeDefined();
    });

    it('generates the definition for a component nested inside another body', () => {
        // A Card whose canonical body contains a Button instance.
        const button = instanceNode('inner_button', 'Button', 'comp_button', { label: 'Go' });
        const doc = makeDocument([
            frameNode('root', 'Card Section', [
                instanceNode('card_a', 'Card', 'comp_card', { title: 'A' }, [button]),
                instanceNode('card_b', 'Card', 'comp_card', { title: 'B' }, []),
            ]),
        ]);
        const project = generateProject(doc);

        // The Card body renders {children} at its slot; the inner Button is a
        // separate definition file that Card's body imports.
        const card = findFile(project, 'src/components/Card.tsx')!;
        expect(card).toBeDefined();
        expect(card.content).toContain("import { Button } from './Button';");
        expect(findFile(project, 'src/components/Button.tsx')).toBeDefined();
    });

    it('warns when instance children have no slot position to render into', () => {
        // A template-bearing component (extraction-style) whose body has no
        // slot nodes, with an instance that carries children.
        const template: DesignNode = frameNode('tpl', 'Card', [textNode('tpl_t', 'Title', 'Static')]);
        const doc = makeDocument([
            frameNode('root', 'Cards', [
                {
                    ...instanceNode('a', 'Card', 'comp_card', { title: 'A' }),
                    template,
                    children: [textNode('a_extra', 'Extra', 'Instance child')],
                },
                {
                    ...instanceNode('b', 'Card', 'comp_card', { title: 'B' }),
                    template,
                    children: [],
                },
            ]),
        ]);
        const project = generateProject(doc);
        const warnings = project.warnings ?? [];
        expect(warnings.some((w) => w.message.includes('no children slot'))).toBe(true);
    });
});

describe('slot content end-to-end', () => {
    it('compiles a slot-bearing document into a valid project', async () => {
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

        // The generated project is valid (syntax + references) and complete.
        expect(result.diagnostics.validation.valid).toBe(true);
        const section = result.files.find((f) => f.path === 'src/sections/SlotSection.tsx')!;
        expect(section.content).toContain('content={<Button />}');
        expect(result.files.find((f) => f.path === 'src/components/Card.tsx')).toBeDefined();
        expect(result.files.find((f) => f.path === 'src/components/Button.tsx')).toBeDefined();
    });
});
