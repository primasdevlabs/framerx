/**
 * Golden fixture for master-backed definition/instance separation.
 *
 * The fixture exercises nested masters, named slots with default content,
 * per-slot props, and multiple instances sharing one master body. These tests
 * pin the end-to-end generated project so the master pipeline can never
 * silently regress.
 */

import { describe, expect, it } from 'vitest';

import { masterBackedDocument, parseFramerDocument } from '@framer/compiler-parser';

import { compileFramerDocument, separateComponents } from '../src/index';

describe('golden master-backed document', () => {
    it('compiles to a valid project with all instances as references', async () => {
        const result = await compileFramerDocument(masterBackedDocument, { projectName: 'MasterGolden' });

        expect(result.diagnostics.validation.valid).toBe(true);
        // Two component definitions (Card, Button), one implementation each.
        expect(result.diagnostics.componentsFromMasters).toBe(2);
        expect(result.diagnostics.componentsSynthesized).toBe(0);
        expect(result.files.find((f) => f.path === 'src/components/Card.tsx')).toBeDefined();
        expect(result.files.find((f) => f.path === 'src/components/Button.tsx')).toBeDefined();

        const section = result.files.find((f) => f.path === 'src/sections/CardGridSection.tsx')!;
        // card_1, card_2, and the standalone Button are all references.
        expect(section.content).toContain('<Card');
        expect(section.content).toContain('<Button');
        // card_2 passes no Icon content — the Card body falls back to the
        // master's default Button for that slot.
        const card = result.files.find((f) => f.path === 'src/components/Card.tsx')!;
        expect(card.content).toContain('{icon ??');
        expect(card.content).toContain('{content ??');
        expect(card.content).toContain('Default card body');
        // The Button nested inside the Card's slot default content is imported
        // by the Card file, never by the section that just renders <Card />.
        expect(card.content).toContain("import { Button } from './Button';");
        expect(section.content).not.toContain("from './Button'");
    });

    it('shares one master body object per component across instances', () => {
        const doc = parseFramerDocument(masterBackedDocument);
        const section = doc.nodes[0];
        const cardA = section.children.find((c) => c.id === 'card_1')!;
        const cardB = section.children.find((c) => c.id === 'card_2')!;

        expect(cardA.type).toBe('component');
        expect(cardA.template).toBeDefined();
        expect(cardA.template).toBe(cardB.template);
    });

    it('keeps the master slot positions between real body nodes', () => {
        const doc = parseFramerDocument(masterBackedDocument);
        const separated = separateComponents(doc);
        const card = separated.components!.find((c) => c.name === 'Card')!;

        // The body is the master: title → Icon slot → Content slot → footer,
        // with the default content and per-slot props intact.
        const bodyChildren = card.body.children.map((c) => `${c.type}:${c.id}`);
        expect(bodyChildren).toEqual([
            'text:master_card_title',
            'slot:master_icon_slot',
            'slot:master_content_slot',
            'text:master_card_footer',
        ]);
        expect(card.bodySource).toBe('master');
        const iconSlot = card.slots.find((slot) => slot.name === 'Icon')!;
        expect(iconSlot.props).toEqual({ size: 'md' });
        // The Icon slot's default content is a Button instance.
        const iconNode = card.body.children[1];
        expect(iconNode.children[0].type).toBe('component');
        expect(iconNode.children[0].componentId).toBe('component_button');
    });

    it('matches the golden snapshot of the generated project', async () => {
        const result = await compileFramerDocument(masterBackedDocument, { projectName: 'MasterGolden' });

        const snapshot = result.files
            .map((file) => ({
                path: file.path,
                content: file.binary || file.data ? `[binary ${file.path}]` : file.content,
            }))
            .sort((a, b) => a.path.localeCompare(b.path));
        expect(snapshot).toMatchSnapshot();
    });
});
