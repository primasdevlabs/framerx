/**
 * Tests for the Framer SDK adapter (SDK nodes → FramerDocument).
 */

import { describe, expect, it } from 'vitest';

import { extractFramerDocument } from '../src/parser/document';
import { parseLayout } from '../src/parser/layout';
import { parseSdkNode } from '../src/parser/node';
import { getFramerApi } from '../src/parser/sdk';
import type { SdkNode } from '../src/parser/sdk-types';
import { parseBorderRadius, parseStyle } from '../src/parser/style';

/** Build a minimal fake SDK node. */
function fakeNode(overrides: Partial<SdkNode> = {}): SdkNode {
    return {
        id: 'n1',
        name: 'Node',
        getChildren: async () => [],
        getRect: async () => ({ x: 0, y: 0, width: 100, height: 200 }),
        ...overrides,
    };
}

describe('parseLayout', () => {
    it('maps a stack to a flex layout', () => {
        const layout = parseLayout(
            fakeNode({
                layout: 'stack',
                stackDirection: 'horizontal',
                stackDistribution: 'space-between',
                stackAlignment: 'center',
                gap: '12px',
                padding: '16px 24px',
            }),
        );

        expect(layout.strategy).toBe('flex');
        expect(layout.direction).toBe('row');
        expect(layout.justifyContent).toBe('space-between');
        expect(layout.alignItems).toBe('center');
        expect(layout.gap).toBe(12);
        expect(layout.padding).toEqual({ top: 16, right: 24, bottom: 16, left: 24 });
    });

    it('maps sizing modes from CSS lengths', () => {
        const layout = parseLayout(fakeNode({ width: 'fit-content', height: '50%' }));

        expect(layout.sizing?.widthMode).toBe('hug');
        expect(layout.sizing?.heightMode).toBe('fill');
    });

    it('maps absolute position with offsets', () => {
        const layout = parseLayout(fakeNode({ position: 'absolute', left: '10px', top: '20px', zIndex: 5 }));

        expect(layout.strategy).toBe('absolute');
        expect(layout.position).toBe('absolute');
        expect(layout.offsets).toMatchObject({ left: 10, top: 20 });
        expect(layout.zIndex).toBe(5);
    });
});

describe('parseStyle', () => {
    it('maps background, border, radius, and opacity', () => {
        const style = parseStyle(
            fakeNode({
                backgroundColor: '#0f172a',
                border: { width: '1px', color: '#94a3b8', style: 'solid' },
                borderRadius: '8px',
                opacity: 0.5,
            }),
        );

        expect(style.fills?.[0]).toMatchObject({ type: 'solid', color: '#0f172a' });
        expect(style.strokes?.[0]).toMatchObject({ width: 1 });
        expect(style.radius).toBe(8);
        expect(style.opacity).toBe(0.5);
    });

    it('parses per-corner border radius shorthands', () => {
        expect(parseBorderRadius('12px 8px 6px 4px')).toEqual({
            topLeft: 12,
            topRight: 8,
            bottomRight: 6,
            bottomLeft: 4,
        });
    });

    it('resolves named color styles to their light value', () => {
        const style = parseStyle(fakeNode({ backgroundColor: { light: '#ffffff', dark: '#000000' } }));
        expect(style.fills?.[0]).toMatchObject({ color: '#ffffff' });
    });
});

describe('parseSdkNode', () => {
    it('maps a text node', async () => {
        const node = await parseSdkNode(
            fakeNode({
                id: 't1',
                name: 'Heading',
                getText: async () => 'Hello Framer',
                font: { family: 'Inter', weight: 700, style: 'normal' },
                inlineTextStyle: { fontSize: 32, color: '#ffffff' },
            }),
        );

        expect(node.type).toBe('Text');
        expect(node.text?.text).toBe('Hello Framer');
        expect(node.text?.style.fontFamily).toBe('Inter');
        expect(node.text?.style.fontWeight).toBe(700);
        expect(node.text?.style.fontSize).toBe(32);
    });

    it('maps an SVG node', async () => {
        const node = await parseSdkNode(fakeNode({ id: 'v1', name: 'Icon', svg: '<svg/>' }));
        expect(node.type).toBe('Vector');
        expect(node.vector?.svg).toBe('<svg/>');
    });

    it('maps a component instance with props', async () => {
        const node = await parseSdkNode(
            fakeNode({
                id: 'c1',
                name: 'Feature Card',
                componentIdentifier: 'comp_feature_card',
                componentName: 'FeatureCard',
                controls: { title: 'Compiler First', count: 3 },
            }),
        );

        expect(node.type).toBe('Component');
        expect(node.component?.id).toBe('comp_feature_card');
        expect(node.component?.name).toBe('FeatureCard');
        expect(node.component?.props).toEqual({ title: 'Compiler First', count: 3 });
    });

    it('maps an image frame with a background image', async () => {
        const node = await parseSdkNode(
            fakeNode({ id: 'i1', name: 'Hero Image', backgroundImage: { url: 'https://cdn.example.com/hero.png', altText: 'Hero' } }),
        );

        expect(node.type).toBe('Image');
        expect(node.image?.src).toBe('https://cdn.example.com/hero.png');
        expect(node.image?.alt).toBe('Hero');
    });

    it('recursively parses children and captures the frame', async () => {
        const node = await parseSdkNode(
            fakeNode({
                name: 'Parent',
                getChildren: async () => [
                    fakeNode({ id: 'child', name: 'Child', getText: async () => 'hi' }),
                ],
            }),
        );

        expect(node.children).toHaveLength(1);
        expect(node.children[0].type).toBe('Text');
        expect(node.frame).toEqual({ x: 0, y: 0, width: 100, height: 200 });
    });
});

describe('extractFramerDocument', () => {
    it('walks the canvas root → pages → nodes', async () => {
        const api = {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'My Site',
                getChildren: async () => [
                    {
                        id: 'page1',
                        name: 'Home',
                        getChildren: async () => [
                            fakeNode({ id: 'frame1', name: 'Hero Section', getChildren: async () => [] }),
                        ],
                    },
                ],
            }),
        };

        const document = await extractFramerDocument(api as never);

        expect(document.id).toBe('root');
        expect(document.name).toBe('My Site');
        expect(document.nodes).toHaveLength(1);
        expect(document.nodes[0].name).toBe('Hero Section');
        expect(document.nodes[0].source?.platform).toBe('framer');
    });
});

describe('sdk bridge', () => {
    it('returns null when no Framer engine is present', async () => {
        // In Node the handshake is skipped, so the throwing Proxy is detected.
        expect(await getFramerApi()).toBeNull();
    });
});
