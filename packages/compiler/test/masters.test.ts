/**
 * Component masters (definitions) fetched through the plugin SDK:
 *   - the master body becomes the single definition implementation
 *   - named slot positions come from the master, not appended at the end
 *   - per-slot content renders at the master's slot position
 *   - the synthesized-body fallback is never used when a master exists
 */

import { describe, expect, it } from 'vitest';

import type { FramerDocument, FramerNode } from '@framer/compiler-parser';
import { findFile, generateProject } from '@framer/compiler-generators';
import { parseFramerDocument } from '@framer/compiler-parser';

import { compileFramerDocument, separateComponents } from '../src/index';

/** A Framer frame node. */
function framerFrame(id: string, name: string, children: FramerNode[], style: Record<string, unknown> = {}): FramerNode {
    return {
        id,
        type: 'Frame',
        name,
        frame: { x: 0, y: 0, width: 320, height: 200 },
        layout: {
            strategy: 'flex',
            direction: 'column',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            gap: 12,
            padding: { top: 24, right: 24, bottom: 24, left: 24 },
            sizing: { widthMode: 'fixed', heightMode: 'fixed' },
        },
        style,
        children,
    };
}

/** A Framer text node. */
function framerText(id: string, name: string, text: string): FramerNode {
    return {
        id,
        type: 'Text',
        name,
        frame: { x: 0, y: 0, width: 200, height: 32 },
        layout: { strategy: 'auto' },
        style: {},
        text: { text, style: { fontFamily: 'Inter', fontSize: 18 } },
        children: [],
    };
}

/** A Framer slot placeholder (as found inside a master body). */
function framerSlot(id: string, name: string): FramerNode {
    return {
        id,
        type: 'Slot',
        name,
        frame: { x: 0, y: 0, width: 0, height: 0 },
        layout: { strategy: 'auto' },
        style: {},
        children: [],
    };
}

/** A Framer slot placeholder with default content and/or per-slot props. */
function framerSlotWithDefault(id: string, name: string, children: FramerNode[], props?: Record<string, unknown>): FramerNode {
    return {
        id,
        type: 'Slot',
        name,
        frame: { x: 0, y: 0, width: 0, height: 0 },
        layout: { strategy: 'auto' },
        style: {},
        children,
        ...(props ? { props } : {}),
    };
}

/** A Framer component instance. */
function framerComponent(id: string, componentId: string, name: string, master: FramerNode, extra: Partial<FramerNode['component']> = {}): FramerNode {
    return {
        id,
        type: 'Component',
        name,
        frame: { x: 0, y: 0, width: 320, height: 200 },
        layout: { strategy: 'auto' },
        style: {},
        component: {
            id: componentId,
            name,
            master,
            ...extra,
        },
        children: [],
    };
}

/** The master: title → Content slot → footer (slot in the MIDDLE). */
const cardMaster: FramerNode = framerFrame('master_card', 'Card Master', [
    framerText('m_title', 'Title', 'Card Title'),
    framerSlot('m_slot', 'Content'),
    framerText('m_footer', 'Footer', 'Card Footer'),
]);

/** A document with one Card instance backed by its master. */
function makeDocument(instances: FramerNode[]): FramerDocument {
    return {
        id: 'doc_masters',
        name: 'Masters Doc',
        version: '1.0.0',
        nodes: [
            framerFrame('root', 'Cards Section', instances),
        ],
    };
}

describe('master-driven definitions', () => {
    it('shares ONE parsed master body object across all instances', () => {
        const doc = parseFramerDocument(makeDocument([
            framerComponent('card_1', 'comp_card', 'Card', cardMaster),
            framerComponent('card_2', 'comp_card', 'Card', cardMaster),
        ]));

        const [a, b] = doc.nodes[0].children;
        expect(a.type).toBe('component');
        expect(b.type).toBe('component');
        // The same master parses once — instances share the identical body.
        expect(a.template).toBeDefined();
        expect(a.template).toBe(b.template);
    });

    it('marks master-backed definitions and carries per-slot props', () => {
        const iconMaster = framerFrame('master_badge', 'Badge Master', [
            framerText('b_title', 'Title', 'Badge'),
            framerSlotWithDefault('b_icon_slot', 'Icon', [framerText('b_icon_default', 'Icon', '★')], { size: 'md' }),
        ]);
        const doc = parseFramerDocument(makeDocument([
            framerComponent('badge_1', 'comp_badge', 'Badge', iconMaster),
        ]));
        const separated = separateComponents(doc);

        const definition = separated.components!.find((c) => c.name === 'Badge')!;
        // Real master body → not the synthesized fallback.
        expect(definition.bodySource).toBe('master');
        // The slot keeps its per-slot props (the placeholder's controls).
        const iconSlot = definition.slots.find((slot) => slot.name === 'Icon');
        expect(iconSlot).toMatchObject({ nodeId: 'b_icon_slot' });
        expect(iconSlot!.props).toEqual({ size: 'md' });
    });

    it('renders the master slot default content when no content is passed', async () => {
        const master = framerFrame('master_badge', 'Badge Master', [
            framerText('b_title', 'Title', 'Badge'),
            framerSlotWithDefault('b_content_slot', 'Content', [framerText('b_default', 'Body', 'Default body text')]),
        ]);
        const result = await compileFramerDocument(
            makeDocument([framerComponent('badge_1', 'comp_badge', 'Badge', master)]),
            { projectName: 'masters' },
        );

        const badge = result.files.find((f) => f.path === 'src/components/Badge.tsx')!;
        // The slot prop falls back to the master's default content.
        expect(badge.content).toContain('{content ??');
        expect(badge.content).toContain('Default body text');
        // The definition body keeps its master position (title before slot).
        const titleAt = badge.content.indexOf('Badge');
        const slotAt = badge.content.indexOf('{content ??');
        expect(titleAt).toBeGreaterThanOrEqual(0);
        expect(slotAt).toBeGreaterThan(titleAt);
    });

    it('lets passed content override the master default', async () => {
        const master = framerFrame('master_badge', 'Badge Master', [
            framerSlotWithDefault('b_content_slot', 'Content', [framerText('b_default', 'Body', 'Default body text')]),
        ]);
        const passed: FramerNode = {
            id: 'passed_body',
            type: 'Text',
            name: 'Body',
            frame: { x: 0, y: 0, width: 200, height: 32 },
            layout: { strategy: 'auto' },
            style: {},
            text: { text: 'Passed content wins', style: {} },
            children: [],
        };
        const result = await compileFramerDocument(
            makeDocument([
                framerComponent('badge_1', 'comp_badge', 'Badge', master, {
                    slots: { Content: [passed] },
                }),
            ]),
            { projectName: 'masters' },
        );

        const section = result.files.find((f) => f.path === 'src/sections/CardsSection.tsx')!;
        expect(section.content).toContain('content={<p');
        expect(section.content).toContain('Passed content wins');
    });

    it('warns and reports the count when a body falls back to synthesis', async () => {
        // A source component with NO master body — the honest-limit fallback.
        const standalone: FramerNode = {
            id: 'card_1',
            type: 'Component',
            name: 'Card',
            frame: { x: 0, y: 0, width: 320, height: 200 },
            layout: { strategy: 'auto' },
            style: {},
            component: { id: 'comp_card', name: 'Card', props: { title: 'Hi' } },
            children: [],
        };
        const result = await compileFramerDocument(makeDocument([standalone]), { projectName: 'masters' });

        const warning = result.diagnostics.validation.warnings.find((w) => w.message.includes('no master body'));
        expect(warning).toBeDefined();
        expect(result.diagnostics.componentsSynthesized).toBe(1);
        expect(result.diagnostics.componentsFromMasters).toBe(0);
    });

    it('parses the master as the instance template (the definition body)', () => {
        const doc = parseFramerDocument(makeDocument([
            framerComponent('card_1', 'comp_card', 'Card', cardMaster),
        ]));

        const instance = doc.nodes[0].children[0];
        expect(instance.type).toBe('component');
        expect(instance.template).toBeDefined();
        // The body is the master: title, Content slot, footer — in order.
        const bodyChildren = instance.template!.children.map((c) => `${c.type}:${c.id}`);
        expect(bodyChildren).toEqual(['text:m_title', 'slot:m_slot', 'text:m_footer']);
        // The slot placeholder keeps its name ('Content') — a real position.
        const slot = instance.template!.children[1];
        expect(slot.type).toBe('slot');
        expect(slot.slotName).toBe('Content');
    });

    it('uses the master body — not the synthesized fallback — as the definition', () => {
        const doc = parseFramerDocument(makeDocument([
            framerComponent('card_1', 'comp_card', 'Card', cardMaster),
            framerComponent('card_2', 'comp_card', 'Card', cardMaster, { props: { title: 'Two' } }),
        ]));
        const separated = separateComponents(doc);

        const definition = separated.components!.find((c) => c.name === 'Card')!;
        expect(definition.body.children.map((c) => c.id)).toEqual(['m_title', 'm_slot', 'm_footer']);
        // The slot position is the master's — in the middle, not appended.
        expect(definition.slots).toHaveLength(1);
        expect(definition.slots[0]).toMatchObject({ nodeId: 'm_slot', name: 'Content' });
        // Master-driven bodies render their static content — no prop synthesis.
        expect(definition.body.children[0].type).toBe('text');
        expect(definition.body.children[2].type).toBe('text');
    });

    it('renders per-slot content at the master slot position', async () => {
        const button: FramerNode = {
            id: 'slot_button',
            type: 'Component',
            name: 'Button',
            frame: { x: 0, y: 0, width: 40, height: 20 },
            layout: { strategy: 'auto' },
            style: {},
            component: { id: 'comp_button', name: 'Button', props: {} },
            children: [],
        };
        const result = await compileFramerDocument(
            makeDocument([
                framerComponent('card_1', 'comp_card', 'Card', cardMaster, {
                    slots: { Content: [button] },
                }),
            ]),
            { projectName: 'masters' },
        );

        const card = result.files.find((f) => f.path === 'src/components/Card.tsx')!;
        expect(card).toBeDefined();
        // The slot prop is declared and rendered.
        expect(card.content).toContain('content?: ReactNode;');
        expect(card.content).toContain('{content}');
        // The slot renders BETWEEN the master's title and footer — the master
        // position, never an appended end.
        const titleAt = card.content.indexOf('Card Title');
        const slotAt = card.content.indexOf('{content}');
        const footerAt = card.content.indexOf('Card Footer');
        expect(titleAt).toBeGreaterThanOrEqual(0);
        expect(footerAt).toBeGreaterThan(slotAt);
        expect(slotAt).toBeGreaterThan(titleAt);

        // The instance passes the content as the named slot prop.
        const section = result.files.find((f) => f.path === 'src/sections/CardsSection.tsx')!;
        expect(section.content).toContain('content={<Button />}');
        expect(result.files.find((f) => f.path === 'src/components/Button.tsx')).toBeDefined();
    });

    it('warns when instance slot content has no matching master slot', async () => {
        const button: FramerNode = {
            id: 'slot_button',
            type: 'Component',
            name: 'Button',
            frame: { x: 0, y: 0, width: 40, height: 20 },
            layout: { strategy: 'auto' },
            style: {},
            component: { id: 'comp_button', name: 'Button', props: {} },
            children: [],
        };
        const result = await compileFramerDocument(
            makeDocument([
                framerComponent('card_1', 'comp_card', 'Card', cardMaster, {
                    slots: { Header: [button] },
                }),
            ]),
            { projectName: 'masters' },
        );

        const warning = result.diagnostics.validation.warnings.find((w) => w.message.includes("slot content 'Header'"));
        expect(warning).toBeDefined();
        expect(warning!.message).toContain('no slot with that name');
    });

    it('is deterministic across exports', async () => {
        const doc = makeDocument([
            framerComponent('card_1', 'comp_card', 'Card', cardMaster),
        ]);
        const a = await compileFramerDocument(doc, { projectName: 'masters' });
        const b = await compileFramerDocument(doc, { projectName: 'masters' });

        expect(a.files.map((f) => f.content)).toEqual(b.files.map((f) => f.content));
    });

    it('generates a valid project end-to-end', async () => {
        const result = await compileFramerDocument(
            makeDocument([framerComponent('card_1', 'comp_card', 'Card', cardMaster)]),
            { projectName: 'masters' },
        );
        expect(result.diagnostics.validation.valid).toBe(true);
        const project = { name: 'Masters', files: result.files, nodes: result.nodes };
        expect(findFile(project, 'src/components/Card.tsx')).toBeDefined();
        // The section renders the instance as a reference.
        expect(result.files.find((f) => f.path === 'src/sections/CardsSection.tsx')!.content).toContain('<Card');
    });
});
