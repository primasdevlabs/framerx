/**
 * Instance props on master-backed components.
 *
 * A real Framer instance can only pass props its definition exposes. When a
 * master-backed component instance passes props, the generated component's
 * props interface must include them (the JSX would otherwise fail the
 * generated project's strict TypeScript build). The props appear in the
 * interface but are NOT destructured — the master body has no marker for
 * them, and an unused destructured variable fails `noUnusedLocals`.
 */

import { describe, expect, it } from 'vitest';

import type { FramerDocument, FramerNode } from '@framer/compiler-parser';
import { compileFramerDocument } from '../src/index';

/** A master-backed component with a text child; instances pass extra props. */
function makeFixture(): FramerDocument {
    const master: FramerNode = {
        id: 'master_badge',
        type: 'Frame',
        name: 'Badge Master',
        frame: { x: 0, y: 0, width: 200, height: 48 },
        layout: {
            strategy: 'flex',
            direction: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: { top: 8, right: 16, bottom: 8, left: 16 },
            sizing: { widthMode: 'hug', heightMode: 'fixed' },
        },
        style: { fills: [{ type: 'solid', color: '#6366f1', visible: true }], radius: 24 },
        children: [
            {
                id: 'master_badge_label',
                type: 'Text',
                name: 'Label',
                frame: { x: 0, y: 0, width: 120, height: 24 },
                layout: { strategy: 'auto' },
                style: {},
                text: {
                    text: 'Badge',
                    style: { fontFamily: 'Inter', fontSize: 14, fontWeight: 600, color: '#ffffff' },
                },
                children: [],
            },
        ],
    };

    const instance: FramerNode = {
        id: 'badge_1',
        type: 'Component',
        name: 'Badge',
        frame: { x: 0, y: 0, width: 200, height: 48 },
        layout: { strategy: 'auto' },
        component: {
            id: 'cmp_badge',
            name: 'Badge',
            master,
            props: { label: 'New', tone: 'primary', count: 3 },
        },
        children: [],
    };

    return {
        id: 'instance-props-fixture',
        name: 'Instance props',
        version: '1.0.0',
        nodes: [
            // The instance sits inside a regular frame section (as in the fat
            // fixture) so the generator renders it as a JSX reference.
            {
                id: 'section_badges',
                type: 'Frame',
                name: 'Badges Section',
                frame: { x: 0, y: 0, width: 1440, height: 200 },
                layout: {
                    strategy: 'flex',
                    direction: 'row',
                    alignItems: 'flex-start',
                    justifyContent: 'flex-start',
                    gap: 16,
                    padding: { top: 24, right: 24, bottom: 24, left: 24 },
                    sizing: { widthMode: 'fill', heightMode: 'fixed' },
                },
                style: {},
                children: [instance],
            },
        ],
    };
}

describe('instance props on master-backed components', () => {
    it('adds instance-passed props to the definition props interface', async () => {
        const result = await compileFramerDocument(makeFixture(), { projectName: 'InstanceProps' });
        const file = result.files.find((f) => f.path === 'src/components/Badge.tsx')!;
        expect(file).toBeDefined();
        // The instance-passed props are typed into the interface.
        expect(file.content).toContain('label?: string;');
        expect(file.content).toContain('tone?: string;');
        expect(file.content).toContain('count?: number;');
    });

    it('does not destructure instance-only props (unused vars break the build)', async () => {
        const result = await compileFramerDocument(makeFixture(), { projectName: 'InstanceProps' });
        const file = result.files.find((f) => f.path === 'src/components/Badge.tsx')!;
        // The body has no markers for these props, so they must stay out of
        // the destructuring — destructuring them unused fails noUnusedLocals.
        expect(file.content).not.toContain('{ className, label, tone, count');
        expect(file.content).toMatch(/export function Badge\(\{ className \}/);
    });

    it('instance JSX still passes the props (fidelity: nothing dropped)', async () => {
        const result = await compileFramerDocument(makeFixture(), { projectName: 'InstanceProps' });
        const section = result.files.find((f) => f.path.startsWith('src/sections/'))!;
        expect(section.content).toContain('label="New"');
        expect(section.content).toContain('tone="primary"');
        expect(section.content).toContain('count={3}');
    });
});
