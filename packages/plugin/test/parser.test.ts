/**
 * Tests for the Framer SDK adapter (SDK nodes → FramerDocument).
 */

import { describe, expect, it } from 'vitest';

import { extractFramerDocument } from '../src/parser/document';
import { parseLayout } from '../src/parser/layout';
import { parseSdkNode, type ParseContext } from '../src/parser/node';
import type { ModuleTextFetcher } from '../src/parser/modules';
import { connectToFramer, getFramerApi, isInFramerIframe } from '../src/parser/sdk';
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

/** A minimal structural fake of the Framer API surface used by the walker. */
interface FakeApi {
    getCanvasRoot(): Promise<{
        id: string;
        name: string;
        getChildren(): Promise<unknown[]>;
    }>;
    getNodesWithType?(type: string): Promise<unknown[]>;
    getCodeFiles?(): Promise<unknown[]>;
    getFonts?(): Promise<unknown[]>;
}

/**
 * A permissive view of an extraction status record. The real type is a
 * discriminated union keyed by `status`; tests read fields across every
 * variant (`count`, `failed`, `reason`, …) without narrowing, so this local
 * structural type keeps the assertions type-safe without weakening the
 * production type.
 */
interface StatusRecord {
    status: string;
    count?: number;
    failed?: number;
    reason?: string;
    unresolved?: number;
    unsupported?: number;
}

/** A permissive view of a runtime capability probe record. */
interface CapabilityRecord {
    available: boolean;
    reason?: string;
}

/** The extraction records the parser writes (the subset these tests read). */
interface ExtractionRecord {
    [key: string]: unknown;
    masters?: StatusRecord;
    codeFiles?: StatusRecord;
    fonts?: StatusRecord;
    modules?: StatusRecord;
    replicas?: StatusRecord;
    unmatchedInstances?: Array<{ id: string }>;
    images?: StatusRecord;
    capabilities?: Record<string, CapabilityRecord | undefined>;
}

/** Read a field off a document's extraction record (test helper). */
function extractionField(document: { metadata?: Record<string, unknown> }, key: string): unknown {
    return (document.metadata?.extraction as ExtractionRecord | undefined)?.[key];
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

    it('defaults a stack cross-axis alignment to start — never stretch', () => {
        // Framer's alignment is start | center | end; a null alignment (the
        // designer never touched it) is start, and stretch is expressed by the
        // child's own fill sizing. Mapping null to stretch would blow every
        // default-stack child up to fill the cross axis.
        const layout = parseLayout(
            fakeNode({
                layout: 'stack',
                stackDirection: 'vertical',
                gap: '12px',
            }),
        );

        expect(layout.strategy).toBe('flex');
        expect(layout.alignItems).toBe('flex-start');
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
        expect(node.text?.style?.fontFamily).toBe('Inter');
        expect(node.text?.style?.fontWeight).toBe(700);
        expect(node.text?.style?.fontSize).toBe(32);
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
            fakeNode({
                id: 'i1',
                name: 'Hero Image',
                backgroundImage: { url: 'https://cdn.example.com/hero.png', altText: 'Hero' },
            }),
        );

        expect(node.type).toBe('Image');
        expect(node.image?.src).toBe('https://cdn.example.com/hero.png');
        expect(node.image?.alt).toBe('Hero');
    });

    it('recursively parses children and captures the frame', async () => {
        const node = await parseSdkNode(
            fakeNode({
                name: 'Parent',
                getChildren: async () => [fakeNode({ id: 'child', name: 'Child', getText: async () => 'hi' })],
            }),
        );

        expect(node.children).toHaveLength(1);
        expect(node.children?.[0].type).toBe('Text');
        expect(node.frame).toEqual({ x: 0, y: 0, width: 100, height: 200 });
    });

    it('degrades gracefully when a node cannot be read — one bad node never kills the document', async () => {
        const node = await parseSdkNode(
            fakeNode({
                id: 'bad',
                name: 'Bad Node',
                getRect: async () => {
                    throw new Error('rect failed');
                },
                width: '120px',
                height: '60px',
                getChildren: async () => {
                    throw new Error('children failed');
                },
            }),
        );

        expect(node.id).toBe('bad');
        // Frame falls back to the width/height attributes.
        expect(node.frame).toEqual({ x: 0, y: 0, width: 120, height: 60 });
        // Unwalkable children degrade to none.
        expect(node.children).toBeUndefined();
    });

    it('reclassifies a node whose getText is rejected (e.g. engine says it is not a text node)', async () => {
        const node = await parseSdkNode(
            fakeNode({
                id: 't_fail',
                name: 'Heading',
                getText: async () => {
                    throw new Error('node is not a text node');
                },
                getChildren: async () => [
                    fakeNode({ id: 'nested', name: 'Nested', getText: async () => 'nested text' }),
                ],
            }),
        );

        // Not a phantom text node: it degrades to a container and its
        // children still load instead of failing the whole extraction.
        expect(node.type).toBe('Frame');
        expect(node.text).toBeUndefined();
        expect(node.children?.map((c) => c.id)).toEqual(['nested']);
        expect(node.children?.[0].type).toBe('Text');
    });
});

describe('image asset bytes (ImageAsset.getData)', () => {
    it('prefers getData() raw bytes + mimeType over the URL', async () => {
        const node = await parseSdkNode(
            fakeNode({
                id: 'i1',
                name: 'Hero',
                backgroundImage: {
                    url: 'https://cdn.test/hero.png',
                    altText: 'Hero',
                    getData: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }),
                },
            }),
        );

        expect(node.type).toBe('Image');
        expect(node.image?.data).toEqual(new Uint8Array([1, 2, 3]));
        expect(node.image?.mimeType).toBe('image/png');
        // The image fill carries the same resolved bytes + mimeType.
        const fill = node.style?.fills?.find((f) => f.type === 'image');
        expect(fill?.type === 'image' ? fill.image?.data : undefined).toEqual(new Uint8Array([1, 2, 3]));
        expect(fill?.type === 'image' ? fill.image?.mimeType : undefined).toBe('image/png');
    });

    it('resolves getData() for image fills in the fills array', async () => {
        const node = await parseSdkNode(
            fakeNode({
                id: 'f1',
                name: 'Card',
                fills: [
                    {
                        type: 'image',
                        image: {
                            url: 'https://cdn.test/card.webp',
                            getData: async () => ({ bytes: new Uint8Array([9, 9]), mimeType: 'image/webp' }),
                        },
                    },
                ],
            }),
        );

        const fill = node.style?.fills?.find((f) => f.type === 'image');
        expect(fill?.type === 'image' ? fill.image?.data : undefined).toEqual(new Uint8Array([9, 9]));
        expect(fill?.type === 'image' ? fill.image?.mimeType : undefined).toBe('image/webp');
    });

    it('falls back to the URL when the SDK object exposes no getData', async () => {
        const node = await parseSdkNode(
            fakeNode({ id: 'i2', name: 'Hero', backgroundImage: { url: 'https://cdn.test/hero.png' } }),
        );

        expect(node.image?.src).toBe('https://cdn.test/hero.png');
        expect(node.image?.data).toBeUndefined();
        // The exporter's URL-fetch fallback still has a URL to fetch.
        expect(node.image?.mimeType).toBeUndefined();
    });

    it('soft-falls back to the URL when getData hangs — the node still loads within the timeout', async () => {
        const node = await parseSdkNode(
            fakeNode({
                id: 'i3b',
                name: 'Hero',
                backgroundImage: {
                    url: 'https://cdn.test/hero.png',
                    getData: () => new Promise(() => {}), // never settles
                },
            }),
            { sdkCallTimeoutMs: 50 },
        );

        expect(node.type).toBe('Image');
        expect(node.image?.src).toBe('https://cdn.test/hero.png');
        expect(node.image?.data).toBeUndefined();
    });

    it('soft-falls back to the URL when getData throws — the node still loads', async () => {
        const node = await parseSdkNode(
            fakeNode({
                id: 'i3',
                name: 'Hero',
                backgroundImage: {
                    url: 'https://cdn.test/hero.png',
                    getData: async () => {
                        throw new Error('engine rejected');
                    },
                },
            }),
        );

        expect(node.type).toBe('Image');
        expect(node.image?.src).toBe('https://cdn.test/hero.png');
        expect(node.image?.data).toBeUndefined();
    });

    it('resolves the same asset id exactly once across references', async () => {
        let getDataCalls = 0;
        const makeImage = () => ({
            id: 'asset_hero',
            url: 'https://cdn.test/hero.png',
            getData: async () => {
                getDataCalls += 1;
                return { bytes: new Uint8Array([7]), mimeType: 'image/png' };
            },
        });
        const context: ParseContext = {};
        const a = await parseSdkNode(fakeNode({ id: 'n1', name: 'A', backgroundImage: makeImage() }), context);
        const b = await parseSdkNode(fakeNode({ id: 'n2', name: 'B', backgroundImage: makeImage() }), context);

        expect(getDataCalls).toBe(1);
        expect(a.image?.data).toEqual(b.image?.data);
    });

    it('keeps pre-attached bytes without calling getData', async () => {
        let getDataCalls = 0;
        const node = await parseSdkNode(
            fakeNode({
                id: 'i4',
                name: 'Hero',
                backgroundImage: {
                    url: 'https://cdn.test/hero.png',
                    data: new Uint8Array([5, 6]),
                    mimeType: 'image/jpeg',
                    getData: async () => {
                        getDataCalls += 1;
                        return { bytes: new Uint8Array([1]), mimeType: 'image/png' };
                    },
                },
            }),
        );

        expect(getDataCalls).toBe(0);
        expect(node.image?.data).toEqual(new Uint8Array([5, 6]));
        expect(node.image?.mimeType).toBe('image/jpeg');
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
                        nodeType: 'webPage',
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

    it('walks the v4 flat node-tree: the root IS the active page whose children are top-level content', async () => {
        // In @framer/plugin v4+, getCanvasRoot() returns the ACTIVE page node
        // and its getChildren() are the top-level canvas content nodes directly
        // (no intermediate pages layer). The page enumeration includes the
        // root's own id, so the walker must treat root children as content —
        // NOT descend a phantom "pages" layer (which produced zero sections).
        const api = {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Home',
                getChildren: async () => [
                    fakeNode({
                        id: 'frame1',
                        name: 'Hero Section',
                        getChildren: async () => [fakeNode({ id: 't1', name: 'Title', getText: async () => 'Hi' })],
                    }),
                    fakeNode({ id: 'frame2', name: 'Footer', getChildren: async () => [] }),
                ],
            }),
            getNodesWithType: async (type: string) => {
                if (type === 'WebPageNode') return [{ id: 'root', name: 'Home', getChildren: async () => [] }];
                if (type === 'DesignPageNode') return [];
                return [];
            },
        };

        const document = await extractFramerDocument(api as never);

        // The active page's children are the top-level sections — non-zero.
        expect(document.nodes).toHaveLength(2);
        expect(document.nodes.map((n) => n.name)).toEqual(['Hero Section', 'Footer']);
        // The nested text node is a child, not a top-level section.
        expect(document.nodes[0].children?.map((c) => c.id)).toEqual(['t1']);
    });

    it('treats root children as content when the page enumeration is unavailable (no phantom pages layer)', async () => {
        // When getNodesWithType is absent AND the root carries no nodeType
        // (duck-typed mocks), the v4 content children must STILL be walked as
        // content — the old getChildren()-presence heuristic misread them as
        // legacy pages and dropped every top-level section.
        const api = {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Home',
                getChildren: async () => [
                    fakeNode({
                        id: 'frame1',
                        name: 'Hero Section',
                        getChildren: async () => [fakeNode({ id: 't1', name: 'Title', getText: async () => 'Hi' })],
                    }),
                    fakeNode({ id: 'frame2', name: 'Footer', getChildren: async () => [] }),
                ],
            }),
            // No getNodesWithType at all — the page enumeration is unavailable.
        };

        const document = await extractFramerDocument(api as never);

        // The active root's children are the top-level sections — non-zero.
        expect(document.nodes.map((n) => n.id)).toEqual(['frame1', 'frame2']);
        expect(document.nodes[0].children?.map((c) => c.id)).toEqual(['t1']);
    });

    it('walks additional v4 pages enumerated via getNodesWithType alongside the active root', async () => {
        const api = {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Home',
                getChildren: async () => [fakeNode({ id: 'hero', name: 'Hero Section' })],
            }),
            getNodesWithType: async (type: string) => {
                if (type === 'WebPageNode') {
                    return [
                        { id: 'root', name: 'Home', getChildren: async () => [] },
                        {
                            id: 'about',
                            name: 'About',
                            getChildren: async () => [fakeNode({ id: 'about_hero', name: 'About Hero' })],
                        },
                    ];
                }
                if (type === 'DesignPageNode') return [];
                return [];
            },
        };

        const document = await extractFramerDocument(api as never);

        // Active root content + the additional page's content, root not double-counted.
        expect(document.nodes.map((n) => n.id)).toEqual(['hero', 'about_hero']);
    });

    it('degrades to an empty document when getCanvasRoot hangs instead of hanging the extraction forever', async () => {
        // A host that never answers getCanvasRoot (SDK invocations carry no
        // timeout of their own) must not leave the panel stuck on an empty
        // state — the timeout treats the hang like a throw and the existing
        // catch path degrades, recording WHY in the extraction record.
        const api = {
            getCanvasRoot: () => new Promise(() => {}), // never settles
        };

        const document = await extractFramerDocument(api as never, { sdkCallTimeoutMs: 50 });

        expect(document.nodes).toHaveLength(0);
        expect(extractionField(document, 'canvasRoot')).toMatchObject({ status: 'error' });
    });

    it('skips a page whose getChildren hangs instead of hanging the extraction', async () => {
        const api = {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [
                    {
                        id: 'page_hang',
                        name: 'Hung',
                        nodeType: 'webPage',
                        getChildren: () => new Promise(() => {}), // never settles
                    },
                    {
                        id: 'page_ok',
                        name: 'Home',
                        nodeType: 'webPage',
                        getChildren: async () => [fakeNode({ id: 'frame_ok', name: 'Hero Section' })],
                    },
                ],
            }),
        };

        const document = await extractFramerDocument(api as never, { sdkCallTimeoutMs: 50 });
        expect(document.nodes).toHaveLength(1);
        expect(document.nodes[0].id).toBe('frame_ok');
    });

    it('records a font hang as an extraction error instead of hanging the extraction', async () => {
        const api = {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [],
            }),
            getFonts: () => new Promise(() => {}), // never settles
        };

        const document = await extractFramerDocument(api as never, { sdkCallTimeoutMs: 50 });
        expect(document.nodes).toHaveLength(0);
        expect(extractionField(document, 'fonts')).toMatchObject({ status: 'error' });
    });

    it('skips pages that cannot be walked instead of failing the extraction', async () => {
        const api = {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [
                    {
                        id: 'page_bad',
                        name: 'Broken',
                        nodeType: 'webPage',
                        getChildren: async () => {
                            throw new Error('page walk failed');
                        },
                    },
                    {
                        id: 'page_ok',
                        name: 'Home',
                        nodeType: 'webPage',
                        getChildren: async () => [fakeNode({ id: 'frame_ok', name: 'Hero Section' })],
                    },
                ],
            }),
        };

        const document = await extractFramerDocument(api as never);
        expect(document.nodes).toHaveLength(1);
        expect(document.nodes[0].id).toBe('frame_ok');
    });
});

describe('component masters', () => {
    it('fetches ComponentNode masters and attaches them to instances', async () => {
        const masterNode = fakeNode({
            id: 'master_card',
            name: 'Card Master',
            componentIdentifier: 'comp_card',
            componentName: 'Card',
            getChildren: async () => [
                fakeNode({ id: 'm_title', name: 'Title', getText: async () => 'Card Title' }),
                // A slot placeholder: recognized by class key inside a master.
                fakeNode({ id: 'm_slot', name: 'Slot', classKey: 'SlotNode' }),
                fakeNode({ id: 'm_footer', name: 'Footer', getText: async () => 'Footer' }),
            ],
        });
        const api = {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [
                    {
                        id: 'page',
                        name: 'Home',
                        nodeType: 'webPage',
                        getChildren: async () => [
                            fakeNode({
                                id: 'inst',
                                name: 'Card',
                                componentIdentifier: 'comp_card',
                                componentName: 'Card',
                                controls: { title: 'One' },
                            }),
                        ],
                    },
                ],
            }),
            getNodesWithType: async (type: string) => (type === 'ComponentNode' ? [masterNode] : []),
        };

        const document = await extractFramerDocument(api as never);
        const instance = document.nodes[0];
        expect(instance.type).toBe('Component');

        // The master is attached and parsed as a plain container body.
        const master = instance.component?.master;
        expect(master).toBeDefined();
        expect(master!.type).toBe('Frame');
        expect(master!.id).toBe('master_card');
        expect(master!.children?.map((c) => c.id)).toEqual(['m_title', 'm_slot', 'm_footer']);

        // The slot placeholder lands at its real position, named as the default slot.
        const slot = master!.children?.find((c) => c.id === 'm_slot');
        expect(slot?.type).toBe('Slot');
        expect(slot?.name).toBe('children');
    });

    it('keeps designer-set slot names and passes them through', async () => {
        const masterNode = fakeNode({
            id: 'master_badge',
            name: 'Badge Master',
            componentIdentifier: 'comp_badge',
            componentName: 'Badge',
            getChildren: async () => [fakeNode({ id: 'm_slot', name: 'Content', classKey: 'SlotNode' })],
        });
        const api = {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [
                    {
                        id: 'page',
                        name: 'Home',
                        nodeType: 'webPage',
                        getChildren: async () => [
                            fakeNode({
                                id: 'inst',
                                name: 'Badge',
                                componentIdentifier: 'comp_badge',
                                componentName: 'Badge',
                            }),
                        ],
                    },
                ],
            }),
            getNodesWithType: async (type: string) => (type === 'ComponentNode' ? [masterNode] : []),
        };

        const document = await extractFramerDocument(api as never);
        const slot = document.nodes[0].component?.master?.children?.[0];
        expect(slot?.type).toBe('Slot');
        expect(slot?.name).toBe('Content');
    });

    it('carries slot placeholder controls and default content from the master', async () => {
        const masterNode = fakeNode({
            id: 'master_banner',
            name: 'Banner Master',
            componentIdentifier: 'comp_banner',
            componentName: 'Banner',
            getChildren: async () => [
                fakeNode({
                    id: 'm_content_slot',
                    name: 'Content',
                    classKey: 'SlotNode',
                    controls: { layout: 'stacked' },
                    getChildren: async () => [
                        fakeNode({ id: 'm_default', name: 'Default', getText: async () => 'Default text' }),
                    ],
                }),
            ],
        });
        const api = {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [
                    {
                        id: 'page',
                        name: 'Home',
                        nodeType: 'webPage',
                        getChildren: async () => [
                            fakeNode({
                                id: 'inst',
                                name: 'Banner',
                                componentIdentifier: 'comp_banner',
                                componentName: 'Banner',
                            }),
                        ],
                    },
                ],
            }),
            getNodesWithType: async (type: string) => (type === 'ComponentNode' ? [masterNode] : []),
        };

        const document = await extractFramerDocument(api as never);
        const slot = document.nodes[0].component?.master?.children?.[0];
        expect(slot?.type).toBe('Slot');
        // The placeholder's controls survive as per-slot props.
        expect(slot?.props).toEqual({ layout: 'stacked' });
        // The placeholder's children are its default content.
        expect(slot?.children?.map((c) => c.id)).toEqual(['m_default']);
        expect(slot?.children?.[0].type).toBe('Text');
    });

    it('matches a master by componentName when the instance carries no identifier or insertURL', async () => {
        // The engine can leave componentIdentifier/insertURL empty on instances
        // of shared components — the name is the only key left, and the master
        // index falls back to it instead of synthesizing the body.
        const masterNode = fakeNode({
            id: 'master_quote',
            name: 'Quotes Master',
            componentIdentifier: 'engine_internal_quote',
            componentName: 'Quotes',
            getChildren: async () => [fakeNode({ id: 'm_q', name: 'Quote', getText: async () => '“Hi”' })],
        });
        const api = {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [
                    {
                        id: 'page',
                        name: 'Home',
                        nodeType: 'webPage',
                        getChildren: async () => [
                            fakeNode({
                                id: 'inst',
                                name: 'Quotes',
                                // No componentIdentifier, no insertURL — the
                                // instance only carries the component name.
                                componentName: 'Quotes',
                            }),
                        ],
                    },
                ],
            }),
            getNodesWithType: async (type: string) => (type === 'ComponentNode' ? [masterNode] : []),
        };

        const document = await extractFramerDocument(api as never);
        expect(document.nodes[0].component?.master?.id).toBe('master_quote');
        expect(document.nodes[0].component?.master?.children?.[0].text?.text).toBe('“Hi”');
    });

    it('matches a master by insertURL when the instance carries only insertURL', async () => {
        // Shared components can expose an engine-internal componentIdentifier;
        // the instance's insertURL is the stable cross-project key.
        const masterNode = fakeNode({
            id: 'master_shared',
            name: 'Shared Master',
            componentIdentifier: 'engine_internal_id',
            insertURL: 'framer.com/m/proj@Shared@Shared',
            componentName: 'Shared',
            getChildren: async () => [fakeNode({ id: 'm_t', name: 'Title', getText: async () => 'Hi' })],
        });
        const api = {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [
                    {
                        id: 'page',
                        name: 'Home',
                        nodeType: 'webPage',
                        getChildren: async () => [
                            fakeNode({
                                id: 'inst',
                                name: 'Shared',
                                componentIdentifier: 'comp_shared',
                                componentName: 'Shared',
                                insertURL: 'framer.com/m/proj@Shared@Shared',
                            }),
                        ],
                    },
                ],
            }),
            getNodesWithType: async (type: string) => (type === 'ComponentNode' ? [masterNode] : []),
        };

        const document = await extractFramerDocument(api as never);
        // The master resolved through the insertURL key, not the identifier.
        expect(document.nodes[0].component?.master?.id).toBe('master_shared');
        expect(document.nodes[0].component?.master?.children?.[0].text?.text).toBe('Hi');
    });

    it('parses the master once and shares it across instances', async () => {
        let masterParses = 0;
        const masterNode = fakeNode({
            id: 'master_card',
            name: 'Card Master',
            componentIdentifier: 'comp_card',
            componentName: 'Card',
            getChildren: async () => {
                masterParses += 1;
                return [fakeNode({ id: 'm_title', name: 'Title', getText: async () => 'Title' })];
            },
        });
        const api = {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [
                    {
                        id: 'page',
                        name: 'Home',
                        nodeType: 'webPage',
                        getChildren: async () => [
                            fakeNode({
                                id: 'i1',
                                name: 'Card',
                                componentIdentifier: 'comp_card',
                                componentName: 'Card',
                            }),
                            fakeNode({
                                id: 'i2',
                                name: 'Card',
                                componentIdentifier: 'comp_card',
                                componentName: 'Card',
                            }),
                        ],
                    },
                ],
            }),
            getNodesWithType: async (type: string) => (type === 'ComponentNode' ? [masterNode] : []),
        };

        const document = await extractFramerDocument(api as never);
        const [a, b] = document.nodes;
        // The same parsed master object backs both instances.
        expect(a.component?.master).toBe(b.component?.master);
        expect(masterParses).toBe(1);
    });
});

describe('code components', () => {
    /** A fake api whose getCodeFiles returns the given files. */
    function apiWithCodeFiles(files: unknown[], instance?: SdkNode): FakeApi {
        return {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [
                    {
                        id: 'page',
                        name: 'Home',
                        nodeType: 'webPage',
                        getChildren: async () => [
                            instance ??
                                fakeNode({
                                    id: 'inst',
                                    name: 'Phosphor',
                                    componentIdentifier: 'comp_phosphor',
                                    componentName: 'Phosphor',
                                }),
                        ],
                    },
                ],
            }),
            getCodeFiles: async () => files,
        };
    }

    const phosphorFile = {
        id: 'file_phosphor',
        name: 'Phosphor.tsx',
        path: 'code/Phosphor.tsx',
        content: `import { motion } from 'framer-motion'\n\nexport function Phosphor({ icon }: { icon: string }) {\n    return <motion.svg>{icon}</motion.svg>\n}\n`,
        exports: [
            {
                name: 'Phosphor',
                componentId: 'comp_phosphor',
                insertURL: 'framer.com/m/proj@Phosphor.tsx@Phosphor',
                isDefaultExport: false,
                type: 'component',
            },
        ],
    };

    it('attaches the real code source to a code-component instance (no canvas master)', async () => {
        const document = await extractFramerDocument(apiWithCodeFiles([phosphorFile]) as never);

        const instance = document.nodes[0];
        expect(instance.type).toBe('Component');
        expect(instance.component?.master).toBeUndefined();
        expect(instance.component?.code).toBeDefined();
        expect(instance.component?.code?.source).toContain('export function Phosphor');
        expect(instance.component?.code).toMatchObject({
            fileName: 'Phosphor.tsx',
            path: 'code/Phosphor.tsx',
            exportName: 'Phosphor',
            isDefaultExport: false,
        });
    });

    it('matches a code component by insertURL when componentIdentifier differs', async () => {
        const file = {
            ...phosphorFile,
            exports: [
                {
                    name: 'Phosphor',
                    componentId: 'engine_internal_id',
                    insertURL: 'framer.com/m/proj@Phosphor.tsx@Phosphor',
                    isDefaultExport: false,
                    type: 'component',
                },
            ],
        };
        const document = await extractFramerDocument(
            apiWithCodeFiles(
                [file],
                fakeNode({
                    id: 'inst',
                    name: 'Phosphor',
                    componentIdentifier: 'comp_phosphor',
                    componentName: 'Phosphor',
                    insertURL: 'framer.com/m/proj@Phosphor.tsx@Phosphor',
                }),
            ) as never,
        );

        expect(document.nodes[0].component?.code?.exportName).toBe('Phosphor');
    });

    it('resolves the transitive relative-import closure of the matched file', async () => {
        const iconFile = {
            id: 'file_icon',
            name: 'Icon.tsx',
            path: 'code/Icon.tsx',
            content: `export function Icon() {\n    return <svg />\n}\n`,
            exports: [],
        };
        const file = {
            ...phosphorFile,
            content: `import { Icon } from './Icon'\n\nexport function Phosphor() {\n    return <Icon />\n}\n`,
        };
        const document = await extractFramerDocument(apiWithCodeFiles([file, iconFile]) as never);

        const dependencies = document.nodes[0].component?.code?.dependencies;
        expect(dependencies).toHaveLength(1);
        expect(dependencies![0]).toMatchObject({ path: 'code/Icon.tsx' });
        expect(dependencies![0].source).toContain('export function Icon');
    });

    it('soft-fails when the SDK exposes no code files — instances parse without a code source', async () => {
        const api = {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [
                    {
                        id: 'page',
                        name: 'Home',
                        nodeType: 'webPage',
                        getChildren: async () => [
                            fakeNode({
                                id: 'inst',
                                name: 'Phosphor',
                                componentIdentifier: 'comp_phosphor',
                                componentName: 'Phosphor',
                            }),
                        ],
                    },
                ],
            }),
        };

        const document = await extractFramerDocument(api as never);
        const instance = document.nodes[0];
        expect(instance.component?.code).toBeUndefined();
        expect(instance.component?.master).toBeUndefined();
    });
});

describe('shared modules', () => {
    /** A page root with module-backed instances. */
    function modulePage(instances: SdkNode[]): FakeApi {
        return {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [
                    {
                        id: 'page',
                        name: 'Home',
                        nodeType: 'webPage',
                        getChildren: async () => instances,
                    },
                ],
            }),
        };
    }

    /** A module-backed instance (componentIdentifier + insertURL pointing at a CDN bundle). */
    function moduleInstance(id: string, name: string, url: string): SdkNode {
        return fakeNode({
            id,
            name,
            componentIdentifier: `module:${url}:default`,
            componentName: name,
            insertURL: url,
        });
    }

    const TICKER_URL = 'https://framerusercontent.com/modules/B2x/Ticker.js';
    const tickerBundle = `import{jsx as _jsx}from"react/jsx-runtime";import{addPropertyControls,ControlType,RenderTarget}from"framer";export default function Ticker(props){return _jsx("div",{children:props.text})}addPropertyControls(Ticker,{text:{type:ControlType.String}});`;

    it('attaches the fetched bundle as the real code source (isModule) when the module resolves', async () => {
        const fetcher: ModuleTextFetcher = async (url) => (url === TICKER_URL ? tickerBundle : null);
        const api = {
            ...modulePage([moduleInstance('t1', 'Ticker', TICKER_URL)]),
            getCodeFiles: async () => [],
        };

        const document = await extractFramerDocument(api as never, { moduleFetcher: fetcher });
        const instance = document.nodes[0];
        expect(instance.type).toBe('Component');
        expect(instance.component?.master).toBeUndefined();
        expect(instance.component?.code).toBeDefined();
        expect(instance.component?.code).toMatchObject({
            fileName: 'Ticker.js',
            path: 'code/Ticker.js',
            exportName: 'default',
            isDefaultExport: true,
            isModule: true,
        });
        expect(instance.component?.code?.source).toContain('export default function Ticker');

        // The extraction record shows the module resolved (not 'partial').
        const extraction = (document.metadata?.extraction as { modules?: StatusRecord }).modules;
        expect(extraction).toEqual({ status: 'ok', count: 1 });
        // The instance was NOT recorded as unmatched — it has a real body now.
        expect((document.metadata?.extraction as { unmatchedInstances?: unknown }).unmatchedInstances).toBeUndefined();
    });

    it('parses the export name from the componentIdentifier suffix', async () => {
        const url = 'https://framerusercontent.com/modules/zz/Icon.js';
        const fetcher: ModuleTextFetcher = async (u) => (u === url ? `export function Icon() { return null; }` : null);
        const instance = fakeNode({
            id: 'i1',
            name: 'Icon',
            componentIdentifier: `module:${url}:Icon`,
            componentName: 'Icon',
            insertURL: url,
        });
        const api = { ...modulePage([instance]), getCodeFiles: async () => [] };

        const document = await extractFramerDocument(api as never, { moduleFetcher: fetcher });
        expect(document.nodes[0].component?.code).toMatchObject({ exportName: 'Icon', isDefaultExport: false });
    });

    it('resolves one bundle per URL and shares it across every instance (module cache)', async () => {
        let fetches = 0;
        const fetcher: ModuleTextFetcher = async (url) => {
            fetches += 1;
            return url === TICKER_URL ? tickerBundle : null;
        };
        const api = {
            ...modulePage([moduleInstance('t1', 'Ticker', TICKER_URL), moduleInstance('t2', 'Ticker', TICKER_URL)]),
            getCodeFiles: async () => [],
        };

        const document = await extractFramerDocument(api as never, { moduleFetcher: fetcher });
        expect(fetches).toBe(1);
        expect(document.nodes[0].component?.code).toBeDefined();
        expect(document.nodes[1].component?.code).toBeDefined();
        const extraction = (document.metadata?.extraction as { modules?: StatusRecord }).modules;
        expect(extraction).toEqual({ status: 'ok', count: 1 });
    });

    it('records a partial modules status with the exact failing bundle when the fetch fails', async () => {
        const fetcher: ModuleTextFetcher = async () => null;
        const api = {
            ...modulePage([
                moduleInstance('t1', 'Ticker', TICKER_URL),
                moduleInstance('s1', 'Slideshow', 'https://framerusercontent.com/modules/zz/Slideshow.js'),
            ]),
            getCodeFiles: async () => [],
        };

        const document = await extractFramerDocument(api as never, { moduleFetcher: fetcher });
        // Neither bundle resolved — the instances have no code source.
        expect(document.nodes[0].component?.code).toBeUndefined();
        expect(document.nodes[1].component?.code).toBeUndefined();

        const modules = extractionField(document, 'modules') as StatusRecord | undefined;
        expect(modules?.status).toBe('partial');
        expect(modules?.count).toBe(0);
        expect(modules?.failed).toBe(2);
        // The reason names the exact bundles that could not be read.
        expect(modules?.reason).toContain('Ticker');
        expect(modules?.reason).toContain(TICKER_URL);
        // Both instances are also recorded as unmatched with their keys.
        expect(
            (extractionField(document, 'unmatchedInstances') as Array<{ id: string }> | undefined)?.map((u) => u.id),
        ).toEqual(['t1', 's1']);
    });

    it('omits the modules status when the document carries no module instances', async () => {
        const api = {
            ...modulePage([fakeNode({ id: 'f1', name: 'Hero Section' })]),
            getCodeFiles: async () => [],
        };

        const document = await extractFramerDocument(api as never, {
            moduleFetcher: async () => {
                throw new Error('must not be called');
            },
        });
        expect((document.metadata?.extraction as { modules?: StatusRecord }).modules).toBeUndefined();
    });
});

describe('extraction diagnostics', () => {
    /** A page root with a single component instance. */
    function instancePage(instance: SdkNode): FakeApi {
        return {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [
                    {
                        id: 'page',
                        name: 'Home',
                        nodeType: 'webPage',
                        getChildren: async () => [instance],
                    },
                ],
            }),
        };
    }

    /** Read the extraction record off a parsed document. */
    function extractionOf(document: { metadata?: Record<string, unknown> }): ExtractionRecord {
        return (document.metadata?.extraction ?? {}) as ExtractionRecord;
    }

    it('records ok for masters when the API resolves masters', async () => {
        const masterNode = fakeNode({
            id: 'master_btn',
            name: 'Button Master',
            componentIdentifier: 'comp_btn',
            componentName: 'Button',
            getChildren: async () => [],
        });
        const api = {
            ...instancePage(
                fakeNode({ id: 'inst', name: 'Button', componentIdentifier: 'comp_btn', componentName: 'Button' }),
            ),
            getNodesWithType: async (type: string) => (type === 'ComponentNode' ? [masterNode] : []),
            getCodeFiles: async () => [],
        };

        const document = await extractFramerDocument(api as never);
        const extraction = extractionOf(document);
        expect(extraction.masters!.status).toBe('ok');
        expect(extraction.masters!.count).toBe(1);
        // The code-file API resolved but had no component files → 'empty'.
        expect(extraction.codeFiles!.status).toBe('empty');
    });

    it('records unavailable when the SDK surface lacks the enrichment APIs', async () => {
        const document = await extractFramerDocument(
            instancePage(
                fakeNode({ id: 'inst', name: 'Button', componentIdentifier: 'comp_btn', componentName: 'Button' }),
            ) as never,
        );

        const extraction = extractionOf(document);
        expect(extraction.masters!.status).toBe('unavailable');
        expect(extraction.masters!.reason).toContain('getNodesWithType');
        expect(extraction.codeFiles!.status).toBe('unavailable');
        expect(extraction.codeFiles!.reason).toContain('getCodeFiles');
    });

    it('records empty when the master API resolves with no masters', async () => {
        const api = {
            ...instancePage(
                fakeNode({ id: 'inst', name: 'Button', componentIdentifier: 'comp_btn', componentName: 'Button' }),
            ),
            getNodesWithType: async () => [],
        };

        const document = await extractFramerDocument(api as never);
        expect(extractionOf(document).masters!.status).toBe('empty');
    });

    it('records denied when the master API throws a permission error', async () => {
        const api = {
            ...instancePage(
                fakeNode({ id: 'inst', name: 'Button', componentIdentifier: 'comp_btn', componentName: 'Button' }),
            ),
            getNodesWithType: async () => {
                throw new Error('This method requires the `componentMaster` permission');
            },
        };

        const document = await extractFramerDocument(api as never);
        const masters = extractionOf(document).masters!;
        expect(masters.status).toBe('denied');
        expect(masters.reason).toContain('permission');
    });

    it('records error when the master API throws an unexpected failure', async () => {
        const api = {
            ...instancePage(
                fakeNode({ id: 'inst', name: 'Button', componentIdentifier: 'comp_btn', componentName: 'Button' }),
            ),
            getNodesWithType: async () => {
                throw new Error('engine exploded');
            },
        };

        const document = await extractFramerDocument(api as never);
        const masters = extractionOf(document).masters!;
        expect(masters.status).toBe('error');
        expect(masters.reason).toContain('engine exploded');
    });

    it('records unmatched instances with the exact keys they carried', async () => {
        // Both APIs work, but this instance's keys match nothing — the record
        // must name the keys so the export can say WHY, not just that it
        // degraded.
        const api = {
            ...instancePage(
                fakeNode({
                    id: 'orphan_inst',
                    name: 'Slideshow',
                    componentIdentifier: 'comp_nonexistent',
                    insertURL: 'framer.com/m/proj@Slideshow.tsx@Slideshow',
                    componentName: 'Slideshow',
                }),
            ),
            getNodesWithType: async (type: string) =>
                type === 'ComponentNode'
                    ? [
                          fakeNode({
                              id: 'm_other',
                              name: 'Other Master',
                              componentIdentifier: 'comp_other',
                              componentName: 'Other',
                          }),
                      ]
                    : [],
            getCodeFiles: async () => [
                {
                    id: 'file_other',
                    name: 'Other.tsx',
                    path: 'code/Other.tsx',
                    content: 'export function Other() { return null }',
                    exports: [
                        {
                            name: 'Other',
                            componentId: 'comp_other',
                            insertURL: 'framer.com/m/proj@Other.tsx@Other',
                            isDefaultExport: false,
                            type: 'component',
                        },
                    ],
                },
            ],
        };

        const document = await extractFramerDocument(api as never);
        const extraction = extractionOf(document);
        expect(extraction.masters!.status).toBe('ok');
        expect(extraction.codeFiles!.status).toBe('ok');

        const unmatched = (document.metadata?.extraction as { unmatchedInstances?: Array<Record<string, unknown>> })
            .unmatchedInstances;
        expect(unmatched).toHaveLength(1);
        expect(unmatched![0]).toMatchObject({
            id: 'orphan_inst',
            name: 'Slideshow',
            componentIdentifier: 'comp_nonexistent',
            insertURL: 'framer.com/m/proj@Slideshow.tsx@Slideshow',
            componentName: 'Slideshow',
        });
        // The unmatched instance is synthesized (no master, no code source).
        expect(document.nodes[0].component?.master).toBeUndefined();
        expect(document.nodes[0].component?.code).toBeUndefined();
    });

    it('records nothing when every instance resolves', async () => {
        const masterNode = fakeNode({
            id: 'master_btn',
            name: 'Button Master',
            componentIdentifier: 'comp_btn',
            componentName: 'Button',
            getChildren: async () => [],
        });
        const api = {
            ...instancePage(
                fakeNode({ id: 'inst', name: 'Button', componentIdentifier: 'comp_btn', componentName: 'Button' }),
            ),
            getNodesWithType: async (type: string) => (type === 'ComponentNode' ? [masterNode] : []),
        };

        const document = await extractFramerDocument(api as never);
        expect((document.metadata?.extraction as { unmatchedInstances?: unknown }).unmatchedInstances).toBeUndefined();
    });

    it('records denied when the code-file API throws a permission error', async () => {
        const api = {
            ...instancePage(
                fakeNode({
                    id: 'inst',
                    name: 'Phosphor',
                    componentIdentifier: 'comp_phosphor',
                    componentName: 'Phosphor',
                }),
            ),
            getCodeFiles: async () => {
                throw new Error('Permission denied: getCodeFiles is not allowed');
            },
        };

        const document = await extractFramerDocument(api as never);
        const codeFiles = extractionOf(document).codeFiles!;
        expect(codeFiles.status).toBe('denied');
        expect(codeFiles.reason).toContain('permission');
    });
});

describe('sdk bridge', () => {
    it('returns null when no Framer engine is present', async () => {
        // In Node the handshake is skipped, so the throwing Proxy is detected.
        expect(await getFramerApi()).toBeNull();
    });

    it('detects the Framer host iframe by window context', () => {
        // No window in the test runner → not inside an iframe.
        expect(isInFramerIframe()).toBe(false);

        const holder = globalThis as { window?: unknown };
        const original = holder.window;
        // Inside a nested window (self !== top) the plugin is in the Framer host.
        holder.window = { self: {}, top: {} };
        try {
            expect(isInFramerIframe()).toBe(true);
        } finally {
            if (original === undefined) {
                delete holder.window;
            } else {
                holder.window = original;
            }
        }
    });

    it('connects to standalone immediately outside the Framer iframe', async () => {
        expect(await connectToFramer()).toBeNull();
    });
});

describe('project fonts', () => {
    /** A canvas root with no nodes — fonts are collected independently. */
    function emptyCanvas(): FakeApi {
        return {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [],
            }),
        };
    }

    it('collects getFonts() fonts and fetches each Font.url into the document', async () => {
        const api = {
            ...emptyCanvas(),
            getFonts: async () => [
                {
                    selector: 'inter-400',
                    family: 'Inter',
                    weight: 400,
                    style: 'normal',
                    url: 'https://fonts.test/inter-400.woff2',
                },
                {
                    selector: 'inter-700',
                    family: 'Inter',
                    weight: 700,
                    style: 'normal',
                    url: 'https://fonts.test/inter-700.woff',
                },
            ],
        };

        const document = await extractFramerDocument(api as never, {
            fontFetcher: async (url) => {
                if (url === 'https://fonts.test/inter-400.woff2') return new Uint8Array([4, 0, 0]);
                if (url === 'https://fonts.test/inter-700.woff') return new Uint8Array([7, 0, 0]);
                return null;
            },
        });

        expect(document.fonts).toHaveLength(2);
        expect(document.fonts![0]).toMatchObject({
            family: 'Inter',
            weight: 400,
            style: 'normal',
            sources: [{ url: 'https://fonts.test/inter-400.woff2', format: 'woff2' }],
        });
        expect(document.fonts![0].sources[0].data).toEqual(new Uint8Array([4, 0, 0]));
        expect(document.fonts![1].sources[0].format).toBe('woff');
        const fonts = extractionField(document, 'fonts') as StatusRecord | undefined;
        expect(fonts?.status).toBe('ok');
        expect(fonts?.count).toBe(2);
    });

    it('records fonts with no downloadable source instead of dropping them', async () => {
        const api = {
            ...emptyCanvas(),
            getFonts: async () => [
                { selector: 'custom-1', family: 'Custom Display', weight: null, style: null, url: null },
                {
                    selector: 'inter-400',
                    family: 'Inter',
                    weight: 400,
                    style: 'normal',
                    url: 'https://fonts.test/inter-400.woff2',
                },
            ],
        };

        const document = await extractFramerDocument(api as never);

        // The custom font survives as metadata (empty sources → registry warns),
        // while the downloadable font is bundled normally.
        expect(document.fonts).toHaveLength(2);
        expect(document.fonts!.find((font) => font.family === 'Custom Display')).toMatchObject({
            family: 'Custom Display',
            weight: 400,
            style: 'normal',
            sources: [],
        });
        expect(document.fonts!.find((font) => font.family === 'Inter')?.sources[0].data).toBeUndefined();
        const fonts = extractionField(document, 'fonts') as StatusRecord | undefined;
        expect(fonts?.status).toBe('partial');
        expect(fonts?.failed).toBe(1);
        expect(fonts?.reason).toContain('no downloadable source');
    });

    it('falls back to node-inferred fonts when the SDK has no getFonts', async () => {
        // No getFonts on the API — collection reports unavailable and the
        // document carries no explicit font list (parser infers from nodes).
        const document = await extractFramerDocument({ ...emptyCanvas() } as never);

        expect(document.fonts).toBeUndefined();
        const fonts = (document.metadata?.extraction as { fonts?: StatusRecord }).fonts;
        expect(fonts?.status).toBe('unavailable');
    });

    it('reports empty when getFonts resolves without fonts', async () => {
        const api = { ...emptyCanvas(), getFonts: async () => [] };

        const document = await extractFramerDocument(api as never);

        expect(document.fonts).toBeUndefined();
        const fonts = (document.metadata?.extraction as { fonts?: StatusRecord }).fonts;
        expect(fonts?.status).toBe('empty');
    });
});

describe('image extraction diagnostics (ImageAsset.getData outcomes)', () => {
    /** A canvas root whose page carries the given image-bearing nodes. */
    function imagePage(nodes: SdkNode[]): FakeApi {
        return {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [
                    {
                        id: 'page',
                        name: 'Home',
                        nodeType: 'webPage',
                        getChildren: async () => nodes,
                    },
                ],
            }),
        };
    }

    /** Read the images extraction record off a parsed document. */
    function imagesOf(document: { metadata?: Record<string, unknown> }): StatusRecord | undefined {
        return extractionField(document, 'images') as StatusRecord | undefined;
    }

    it('records ok with the count when every image resolved its original bytes via getData', async () => {
        const api = imagePage([
            fakeNode({
                id: 'img_a',
                name: 'A',
                backgroundImage: {
                    id: 'asset_a',
                    url: 'https://cdn.test/a.png',
                    getData: async () => ({ bytes: new Uint8Array([1]), mimeType: 'image/png' }),
                },
            }),
            fakeNode({
                id: 'img_b',
                name: 'B',
                backgroundImage: {
                    id: 'asset_b',
                    url: 'https://cdn.test/b.png',
                    getData: async () => ({ bytes: new Uint8Array([2]), mimeType: 'image/png' }),
                },
            }),
        ]);

        const document = await extractFramerDocument(api as never);
        expect(imagesOf(document)).toEqual({ status: 'ok', count: 2 });
    });

    it('records partial with the count when some images expose no getData (URL fetch fallback)', async () => {
        const api = imagePage([
            fakeNode({
                id: 'img_a',
                name: 'A',
                backgroundImage: {
                    id: 'asset_a',
                    url: 'https://cdn.test/a.png',
                    getData: async () => ({ bytes: new Uint8Array([1]), mimeType: 'image/png' }),
                },
            }),
            // No getData on the object — the documented URL-fetch fallback.
            fakeNode({ id: 'img_b', name: 'B', backgroundImage: { url: 'https://cdn.test/remote.png' } }),
        ]);

        const document = await extractFramerDocument(api as never);
        const images = imagesOf(document);
        expect(images?.status).toBe('partial');
        expect(images?.count).toBe(1);
        expect(images?.failed).toBe(1);
        expect(images?.reason).toContain('exposed no getData');
        expect(images?.reason).toContain('URL fetch');
    });

    it('records partial with the exact error when getData throws', async () => {
        const api = imagePage([
            fakeNode({
                id: 'img_broken',
                name: 'Broken',
                backgroundImage: {
                    url: 'https://cdn.test/broken.png',
                    getData: async () => {
                        throw new Error('engine rejected the read');
                    },
                },
            }),
        ]);

        const document = await extractFramerDocument(api as never);
        const images = imagesOf(document);
        expect(images?.status).toBe('partial');
        expect(images?.count).toBe(0);
        expect(images?.failed).toBe(1);
        // The reason names the exact URL and error — not a flat "failed".
        expect(images?.reason).toContain('broken.png');
        expect(images?.reason).toContain('engine rejected the read');
    });

    it('records each asset once even when many nodes reference it', async () => {
        const api = imagePage([
            fakeNode({
                id: 'n1',
                name: 'A',
                backgroundImage: {
                    id: 'asset_hero',
                    url: 'https://cdn.test/hero.png',
                    getData: async () => ({ bytes: new Uint8Array([1]), mimeType: 'image/png' }),
                },
            }),
            fakeNode({
                id: 'n2',
                name: 'B',
                backgroundImage: {
                    id: 'asset_hero',
                    url: 'https://cdn.test/hero.png',
                    getData: async () => ({ bytes: new Uint8Array([1]), mimeType: 'image/png' }),
                },
            }),
        ]);

        const document = await extractFramerDocument(api as never);
        // One asset id → one outcome, not two.
        expect(imagesOf(document)).toEqual({ status: 'ok', count: 1 });
    });

    it('omits the images record when the document carries no SDK image assets', async () => {
        const api = imagePage([fakeNode({ id: 'frame', name: 'Hero Section' })]);

        const document = await extractFramerDocument(api as never);
        expect(imagesOf(document)).toBeUndefined();
    });
});

describe('runtime capability probe', () => {
    /** A canvas root with no nodes — fonts are probed independently of nodes. */
    function emptyCanvas(): FakeApi {
        return {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [],
            }),
        };
    }

    /** A canvas root whose page carries the given image-bearing nodes. */
    function imagePage(nodes: SdkNode[]): FakeApi {
        return {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [
                    {
                        id: 'page',
                        name: 'Home',
                        nodeType: 'webPage',
                        getChildren: async () => nodes,
                    },
                ],
            }),
        };
    }

    /** Read the capability report off a parsed document. */
    function capabilitiesOf(document: { metadata?: Record<string, unknown> }): Record<string, CapabilityRecord | undefined> {
        return (extractionField(document, 'capabilities') ?? {}) as Record<string, CapabilityRecord | undefined>;
    }

    it('reports getFonts available when the live SDK object exposes it', async () => {
        const api = { ...emptyCanvas(), getFonts: async () => [] };
        const document = await extractFramerDocument(api as never);

        expect(capabilitiesOf(document).getFonts).toEqual({ available: true });
    });

    it('reports getFonts unavailable as an SDK capability gap, not a font property', async () => {
        const document = await extractFramerDocument({ ...emptyCanvas() } as never);

        const getFonts = capabilitiesOf(document).getFonts;
        expect(getFonts?.available).toBe(false);
        // The probe names itself and classifies the failure as a surface gap.
        expect(getFonts?.reason).toContain('runtime capability probe');
        expect(getFonts?.reason).toContain('capability gap');
        // The fonts status derives from the probe and carries the same framing.
        const fonts = extractionField(document, 'fonts') as StatusRecord | undefined;
        expect(fonts?.status).toBe('unavailable');
        expect(fonts?.reason).toContain('capability gap');
    });

    it('distinguishes the API-gap case from fonts that genuinely have no downloadable source', async () => {
        const api = {
            ...emptyCanvas(),
            getFonts: async () => [
                { selector: 'custom-1', family: 'Custom Display', weight: null, style: null, url: null },
            ],
        };
        const document = await extractFramerDocument(api as never);

        // The API exists (probe passes) — the partial status is a property of
        // the font (no downloadable source), explicitly NOT a missing API.
        expect(capabilitiesOf(document).getFonts).toEqual({ available: true });
        const fonts = extractionField(document, 'fonts') as StatusRecord | undefined;
        expect(fonts?.status).toBe('partial');
        expect(fonts?.reason).toContain('no downloadable source');
        expect(fonts?.reason).toContain('IS available');
        expect(fonts?.reason).toContain('property of the fonts, not a missing API');
    });

    it('records imageGetData available when image assets exposed getData', async () => {
        const api = imagePage([
            fakeNode({
                id: 'i1',
                name: 'A',
                backgroundImage: {
                    id: 'a1',
                    url: 'https://cdn.test/a.png',
                    getData: async () => ({ bytes: new Uint8Array([1]), mimeType: 'image/png' }),
                },
            }),
        ]);
        const document = await extractFramerDocument(api as never);

        expect(capabilitiesOf(document).imageGetData).toEqual({ available: true });
    });

    it('records imageGetData unavailable when no asset exposed it (capability gap)', async () => {
        const api = imagePage([
            fakeNode({ id: 'i2', name: 'B', backgroundImage: { url: 'https://cdn.test/remote.png' } }),
        ]);
        const document = await extractFramerDocument(api as never);

        const imageGetData = capabilitiesOf(document).imageGetData;
        expect(imageGetData?.available).toBe(false);
        expect(imageGetData?.reason).toContain('runtime capability probe');
        expect(imageGetData?.reason).toContain('capability gap');
    });

    it('omits imageGetData when the document carries no image assets', async () => {
        const api = imagePage([fakeNode({ id: 'f1', name: 'Hero Section' })]);
        const document = await extractFramerDocument(api as never);

        expect(capabilitiesOf(document).imageGetData).toBeUndefined();
    });
});

describe('replica folding (breakpoint/variant overrides vs duplicates)', () => {
    /** A page whose children are the given top-level nodes. */
    function page(nodes: SdkNode[]): FakeApi {
        return {
            getCanvasRoot: async () => ({
                id: 'root',
                name: 'Site',
                getChildren: async () => [
                    {
                        id: 'page',
                        name: 'Home',
                        nodeType: 'webPage',
                        getChildren: async () => nodes,
                    },
                ],
            }),
        };
    }

    /** A breakpoint tier frame whose children are the replica tree. */
    function tierFrame(id: string, name: string, children: SdkNode[]): SdkNode {
        return fakeNode({
            id,
            name,
            isBreakpoint: true,
            isPrimaryBreakpoint: false,
            getChildren: async () => children,
        });
    }

    it('folds a replica into its primary responsive behavior and prunes it instead of duplicating it', async () => {
        const api = page([
            fakeNode({
                id: 's1',
                name: 'Hero',
                getChildren: async () => [fakeNode({ id: 't1', name: 'Title', getText: async () => 'Hi' })],
            }),
            tierFrame('bp_tablet', 'Tablet', [
                fakeNode({
                    id: 'r_s1',
                    name: 'Hero',
                    isReplica: true,
                    originalId: 's1',
                    getRect: async () => ({ x: 0, y: 0, width: 80, height: 120 }),
                    getChildren: async () => [
                        // A nested replica with NO overrides — a pure duplicate
                        // that inherits everything and must also be pruned.
                        fakeNode({
                            id: 'r_t1',
                            name: 'Title',
                            isReplica: true,
                            originalId: 't1',
                            getText: async () => 'Hi',
                        }),
                    ],
                }),
            ]),
        ]);

        const document = await extractFramerDocument(api as never);

        // The breakpoint tier frame and BOTH replicas are gone — only the
        // primary tree ships, with the overrides attached to it.
        expect(document.nodes.map((n) => n.id)).toEqual(['s1']);
        expect(document.nodes[0].children?.map((c) => c.id)).toEqual(['t1']);
        // The replica's width/height override folded into the primary.
        expect(document.nodes[0].responsive).toEqual({
            Tablet: { sizing: { width: 80, height: 120 } },
        });
        const replicas = (document.metadata?.extraction as { replicas?: StatusRecord }).replicas;
        expect(replicas).toEqual({ status: 'ok', count: 2 });
    });

    it('folds a visibility override into hideOn-style behavior', async () => {
        const api = page([
            fakeNode({ id: 's1', name: 'Hero' }),
            tierFrame('bp_mobile', 'Mobile', [
                fakeNode({ id: 'r_s1', name: 'Hero', isReplica: true, originalId: 's1', visible: false }),
            ]),
        ]);

        const document = await extractFramerDocument(api as never);
        expect(document.nodes.map((n) => n.id)).toEqual(['s1']);
        expect(document.nodes[0].responsive).toEqual({
            Mobile: { visible: false },
        });
    });

    it('derives document.breakpoints from the canvas breakpoint tier frames', async () => {
        // The SDK v4 canvas root exposes no breakpoint scale — the tier frames
        // in the canvas (canvas name + frame design width) ARE the document's
        // breakpoints. Without this, folded overrides (keyed by tier name)
        // never resolve during code generation and the responsive styles are
        // silently dropped.
        const api = page([
            fakeNode({ id: 's1', name: 'Hero' }),
            fakeNode({
                id: 'bp_desktop',
                name: 'Desktop',
                isBreakpoint: true,
                isPrimaryBreakpoint: false,
                getRect: async () => ({ x: 0, y: 0, width: 1440, height: 900 }),
                getChildren: async () => [
                    fakeNode({ id: 'r_s1', name: 'Hero', isReplica: true, originalId: 's1', visible: false }),
                ],
            }),
        ]);

        const document = await extractFramerDocument(api as never);
        expect(document.breakpoints).toEqual([{ name: 'Desktop', minWidth: 1440 }]);
        // The override folds under the SAME name the breakpoint scale carries.
        expect(document.nodes[0].responsive).toEqual({ Desktop: { visible: false } });
    });

    it('prunes a pure-duplicate replica without emitting any responsive override', async () => {
        const api = page([
            fakeNode({ id: 's1', name: 'Hero' }),
            tierFrame('bp_tablet', 'Tablet', [
                fakeNode({ id: 'r_s1', name: 'Hero', isReplica: true, originalId: 's1' }),
            ]),
        ]);

        const document = await extractFramerDocument(api as never);
        expect(document.nodes.map((n) => n.id)).toEqual(['s1']);
        expect(document.nodes[0].responsive).toBeUndefined();
    });

    it('keeps a replica whose primary is missing and records it as unresolved', async () => {
        const api = page([
            fakeNode({ id: 's1', name: 'Hero' }),
            tierFrame('bp_tablet', 'Tablet', [
                fakeNode({ id: 'r_ghost', name: 'Hero', isReplica: true, originalId: 'ghost_primary' }),
            ]),
        ]);

        const document = await extractFramerDocument(api as never);
        // Never dropped: the orphan replica stays as an independent node.
        expect(document.nodes.map((n) => n.id)).toEqual(['s1', 'r_ghost']);
        const replicas = extractionField(document, 'replicas') as StatusRecord | undefined;
        expect(replicas?.status).toBe('partial');
        expect(replicas?.count).toBe(0);
        expect(replicas?.failed).toBe(1);
        expect(replicas?.reason).toContain('ghost_primary');
        expect(replicas?.reason).toContain('kept as independent nodes');
    });

    it('folds an image swap on a replica into the primary responsive override', async () => {
        const api = page([
            fakeNode({ id: 's1', name: 'Hero', backgroundImage: { url: 'https://cdn.test/hero.png' } }),
            tierFrame('bp_tablet', 'Tablet', [
                fakeNode({
                    id: 'r_s1',
                    name: 'Hero',
                    isReplica: true,
                    originalId: 's1',
                    backgroundImage: { url: 'https://cdn.test/hero-tablet.png' },
                }),
            ]),
        ]);

        const document = await extractFramerDocument(api as never);
        // The replica is pruned and the swap folds into the primary's tablet
        // tier — no longer an unsupported kind, never silently dropped.
        expect(document.nodes.map((n) => n.id)).toEqual(['s1']);
        const primary = document.nodes[0];
        expect(primary.responsive?.Tablet?.image?.src).toBe('https://cdn.test/hero-tablet.png');
        const replicas = extractionField(document, 'replicas') as StatusRecord | undefined;
        expect(replicas?.status).toBe('ok');
        expect(replicas?.count).toBe(1);
        expect(replicas?.reason).toBeUndefined();
    });

    it('folds a fill image swap on a frame replica (frame keeps its children)', async () => {
        const api = page([
            fakeNode({
                id: 's1',
                name: 'Hero',
                backgroundImage: { url: 'https://cdn.test/hero.png' },
                getChildren: async () => [fakeNode({ id: 't1', name: 'Title', getText: async () => 'Hi' })],
            }),
            tierFrame('bp_tablet', 'Tablet', [
                fakeNode({
                    id: 'r_s1',
                    name: 'Hero',
                    isReplica: true,
                    originalId: 's1',
                    backgroundImage: { url: 'https://cdn.test/hero-tablet.png' },
                    getChildren: async () => [
                        fakeNode({
                            id: 'r_t1',
                            name: 'Title',
                            isReplica: true,
                            originalId: 't1',
                            getText: async () => 'Hi',
                        }),
                    ],
                }),
            ]),
        ]);

        const document = await extractFramerDocument(api as never);
        // A frame with children reclassifies to Frame: the image is a fill,
        // and the swap folds as the tier image override with the fill src.
        const primary = document.nodes[0];
        expect(primary.type).toBe('Frame');
        expect(primary.responsive?.Tablet?.image?.src).toBe('https://cdn.test/hero-tablet.png');
        const replicas = (document.metadata?.extraction as { replicas?: StatusRecord }).replicas;
        expect(replicas?.status).toBe('ok');
    });

    it('folds image removal on a replica: frames clear the fill, image nodes hide', async () => {
        // Frame with a bg fill removed at the tablet tier → `src: ''` (the
        // generator emits background-image: none; the frame keeps its box).
        const api = page([
            fakeNode({
                id: 's1',
                name: 'Hero',
                backgroundImage: { url: 'https://cdn.test/hero.png' },
                getChildren: async () => [fakeNode({ id: 't1', name: 'Title', getText: async () => 'Hi' })],
            }),
            tierFrame('bp_tablet', 'Tablet', [
                fakeNode({
                    id: 'r_s1',
                    name: 'Hero',
                    isReplica: true,
                    originalId: 's1',
                    getChildren: async () => [
                        fakeNode({
                            id: 'r_t1',
                            name: 'Title',
                            isReplica: true,
                            originalId: 't1',
                            getText: async () => 'Hi',
                        }),
                    ],
                }),
            ]),
        ]);
        const document = await extractFramerDocument(api as never);
        expect(document.nodes[0].responsive?.Tablet?.image?.src).toBe('');

        // Standalone image node removed at the tablet tier → the node hides
        // at that tier (no box), which the visible:false machinery renders.
        const api2 = page([
            fakeNode({ id: 'i1', name: 'Photo', backgroundImage: { url: 'https://cdn.test/photo.png' } }),
            tierFrame('bp_tablet', 'Tablet', [
                fakeNode({ id: 'r_i1', name: 'Photo', isReplica: true, originalId: 'i1' }),
            ]),
        ]);
        const document2 = await extractFramerDocument(api2 as never);
        expect(document2.nodes[0].type).toBe('Image');
        expect(document2.nodes[0].responsive?.Tablet?.visible).toBe(false);
    });

    it('omits the replicas record when the document carries no replicas', async () => {
        const api = page([fakeNode({ id: 's1', name: 'Hero' })]);
        const document = await extractFramerDocument(api as never);
        expect((document.metadata?.extraction as { replicas?: StatusRecord }).replicas).toBeUndefined();
    });
});
