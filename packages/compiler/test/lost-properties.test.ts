/**
 * Lost-property regression tests.
 *
 * The Phase-1 Source Property Coverage diagnostic surfaced three properties
 * as "lost" on the mock document:
 *
 *   - text.italic       (47 sources — biggest leak, plugin/parser dropped it)
 *   - animation.tap     (3 sources — covered by the same Framer animations
 *                        array but emitted as `whileHover` instead of `whileTap`)
 *   - component.props   (2 sources — drop in the AST-preservation of props)
 *
 * These tests build small, focused fixtures that exercise each property
 * end-to-end and assert the coverage diagnostic classifies them as 'emitted'.
 */

import { describe, expect, it } from 'vitest';

import { collectCoverage, SOURCE_PROPERTIES } from '../src/coverage';
import { compileFramerDocument } from '../src/index';
import { parseFramerDocument } from '@framer/compiler-parser';
import type { DesignDocument, DesignNode, FramerDocument, FramerInteraction, FramerNode } from '@framer/compiler-parser';

const PROPERTY_IDS = ['text.italic', 'animation.tap', 'component.props'] as const;

/**
 * Build a small FramerDocument that exercises the three formerly-lost
 * properties: an italic text run, a tap-trigger animation, and a component
 * with non-empty controls. Each surface is intentionally minimal so the
 * failure of any single property is easy to localize.
 */
function makeLostPropertiesFixture(): FramerDocument {
    const tapNode: FramerNode = {
        id: 'n_tap',
        type: 'Frame',
        name: 'Tap Target',
        frame: { x: 0, y: 0, width: 200, height: 80 },
        layout: { strategy: 'auto' },
        style: { fills: [{ type: 'solid', color: '#0f172a', visible: true }] },
        interactions: [
            {
                type: 'tap',
                trigger: 'tap',
                animation: {
                    type: 'tween',
                    duration: 0.15,
                    properties: { scale: 0.95 },
                },
            } satisfies FramerInteraction,
        ],
    };

    const italicNode: FramerNode = {
        id: 'n_italic',
        type: 'Text',
        name: 'Italic Label',
        frame: { x: 0, y: 0, width: 200, height: 32 },
        layout: { strategy: 'auto' },
        text: {
            text: 'lorem ipsum',
            style: { fontFamily: 'Inter', fontSize: 16, italic: true },
        },
    };

    const componentNode: FramerNode = {
        id: 'n_component',
        type: 'Component',
        name: 'Primary Button',
        frame: { x: 0, y: 0, width: 200, height: 60 },
        layout: { strategy: 'auto' },
        component: {
            id: 'cmp_primary_button',
            name: 'PrimaryButton',
            props: {
                label: 'Get started',
                tone: 'primary',
                size: 'md',
            },
        },
        text: { text: 'Get started', style: { fontFamily: 'Inter', fontSize: 16 } },
    };

    return {
        id: 'lost-props-fixture',
        name: 'Lost Properties Fixture',
        version: '1.0.0',
        nodes: [tapNode, italicNode, componentNode],
    };
}

describe('text.italic — preserved + emitted', () => {
    it('reaches the Design AST when the source style has italic: true', () => {
        const ast = parseFramerDocument(makeLostPropertiesFixture());
        const italicNode = ast.nodes.find((node) => node.id === 'n_italic');
        expect(italicNode?.type).toBe('text');
        if (italicNode?.type !== 'text') return;
        expect(italicNode.text.style.italic).toBe(true);
    });

    it('is emitted as the Tailwind `italic` class in the generated section', async () => {
        const result = await compileFramerDocument(makeLostPropertiesFixture(), { projectName: 'italic' });
        // The italic node is the only text node in the fixture; the generator
        // emits a section file named after the source node, so find the file
        // that renders text with `italic` either inline or as a class.
        const allSectionContents = result.files
            .filter((f) => f.path.startsWith('src/sections/') && f.path.endsWith('.tsx'))
            .map((f) => f.content)
            .join('\n');
        expect(allSectionContents).toMatch(/\bitalic\b/);
    });
});

describe('animation.tap — preserved + emitted', () => {
    it('reaches the AST with trigger="tap" inside animations.animations', () => {
        const ast = parseFramerDocument(makeLostPropertiesFixture());
        const tapNode = ast.nodes.find((node) => node.id === 'n_tap');
        expect(tapNode?.type).toBe('frame');
        expect(tapNode?.animations?.animations).toBeDefined();
        const tapAnimation = tapNode?.animations?.animations.find((animation) => animation.trigger === 'tap');
        expect(tapAnimation).toBeDefined();
        expect(tapAnimation?.properties).toMatchObject({ scale: 0.95 });
    });

    it('is emitted as the Motion `whileTap` prop in the generated section', async () => {
        const result = await compileFramerDocument(makeLostPropertiesFixture(), { projectName: 'tap' });
        const sectionFile = result.files.find((f) => f.path.startsWith('src/sections/') && f.path.endsWith('.tsx'));
        expect(sectionFile).toBeDefined();
        expect(sectionFile?.content).toMatch(/whileTap/);
    });

    it('does NOT misclassify a tap animation as a hover animation', async () => {
        const result = await compileFramerDocument(makeLostPropertiesFixture(), { projectName: 'tap-no-hover' });
        const sectionFile = result.files.find((f) => f.path.startsWith('src/sections/') && f.path.endsWith('.tsx'));
        // The fixture has NO hover interaction; whileHover must not leak.
        const motionProps = sectionFile?.content.match(/while(Hover|Tap|InView|Focus)/g) ?? [];
        expect(motionProps).toEqual(['whileTap']);
    });
});

describe('component.props — preserved + emitted as JSX', () => {
    it('reaches the AST with the controls dict intact', () => {
        const ast = parseFramerDocument(makeLostPropertiesFixture());
        const componentNode = ast.nodes.find((node) => node.id === 'n_component');
        expect(componentNode?.type).toBe('component');
        if (componentNode?.type !== 'component') return;
        expect(componentNode.props).toMatchObject({
            label: 'Get started',
            tone: 'primary',
            size: 'md',
        });
    });

    it('appears as JSX attribute names on the rendered component', async () => {
        const result = await compileFramerDocument(makeLostPropertiesFixture(), { projectName: 'props' });
        // The component definition file lands in src/components/PrimaryButton.tsx
        const componentFile = result.files.find((f) => f.path.startsWith('src/components/PrimaryButton') && f.path.endsWith('.tsx'));
        expect(componentFile).toBeDefined();
        const content = componentFile?.content ?? '';
        // Props become destructured argument types / destructured bindings in the impl.
        expect(content).toMatch(/label/);
        expect(content).toMatch(/tone/);
        expect(content).toMatch(/size/);
    });
});

describe('coverage classification on the lost-properties fixture', () => {
    it('classifies text.italic, animation.tap, and component.props as `emitted`', async () => {
        const source = makeLostPropertiesFixture();
        const result = await compileFramerDocument(source, { projectName: 'cov-lost' });
        const coverage = result.diagnostics.coverage!;
        const byId = new Map(coverage.properties.map((entry) => [entry.id, entry] as const));

        for (const id of PROPERTY_IDS) {
            const entry = byId.get(id);
            expect(entry, `coverage missing ${id}`).toBeDefined();
            expect(entry?.discovered, `${id} should be discovered on source`).toBe(true);
            expect(entry?.preserved, `${id} should be preserved into the AST`).toBe(true);
            expect(entry?.emitted, `${id} should be emitted in generated code`).toBe(true);
            expect(entry?.stage).toBe('emitted');
        }
    });

    it('also drives the summary `lost` count to zero on a fixture that exercises only these properties', async () => {
        const source = makeLostPropertiesFixture();
        const result = await compileFramerDocument(source, { projectName: 'cov-summary' });
        // Only these three properties should be the freshly-loss-cleared delta.
        // The rest of the surface still has unrelated lost count = 0 on this
        // minimal fixture (its non-exercised properties report 0 discovered).
        const coverage = result.diagnostics.coverage!;
        const sourceOnlyDiscovery = collectCoverage({ source, ast: parseFramerDocument(source), files: result.files });
        // On this minimal fixture, every property that exists should either be
        // unsupported (registered but never exercised) or emitted.
        const trulyLost = coverage.properties.filter((p) => p.stage === 'lost').map((p) => p.id);
        expect(trulyLost, `unexpected lost properties: ${trulyLost.join(', ')}`).toEqual([]);
        // Sanity: the discovery count for each of the three targets is at least 1.
        for (const id of PROPERTY_IDS) {
            const disc = sourceOnlyDiscovery.properties.find((p) => p.id === id);
            expect(disc?.discoveredCount ?? 0).toBeGreaterThan(0);
        }
    });

    it('keeps the per-trigger animation paths distinct (hover, tap, mount, viewport)', () => {
        // The fix replaced `interactions[].animation` (a single shared bucket)
        // with predicate-keyed paths. Each trigger gets its own SourceProperty
        // entry with its own discovery + emission check.
        const ids = SOURCE_PROPERTIES.map((p) => p.id);
        expect(ids).toContain('animation.hover');
        expect(ids).toContain('animation.tap');
        expect(ids).toContain('animation.mount');
        expect(ids).toContain('animation.viewport');
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('parity: source vs AST on the lost-properties fixture', () => {
    it('shows the same node count before and after the parser pass', () => {
        const source = makeLostPropertiesFixture();
        const ast = parseFramerDocument(source);
        expect(ast.nodes.length).toBe(source.nodes.length);
        // Functional sanity for downstream consumers.
        walkNodes(ast.nodes, (node: DesignNode) => {
            expect(node.id).toBeTruthy();
        });
    });
});

/** Walk every node in a Design AST. */
function walkNodes(nodes: DesignNode[], visit: (node: DesignNode) => void): void {
    const recurse = (node: DesignNode): void => {
        visit(node);
        for (const child of node.children) recurse(child);
    };
    for (const node of nodes) recurse(node);
}
