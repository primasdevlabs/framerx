/**
 * Tests for design-token extraction:
 *   static colors/radii/spacing → Tailwind theme tokens, preferred by the
 *   class generator over arbitrary values.
 */

import { describe, expect, it } from 'vitest';

import type { DesignComponentNode, DesignDocument, DesignNode } from '@framer/compiler-ast';
import {
    extractTokens,
    findFile,
    generateClasses,
    generateComponent,
    generateProject,
    generateTokensModule,
    matchPalette,
    type DesignTokens,
} from '@framer/compiler-generators';

/** A minimal styled frame (non-palette fill, radius 20, 60px padding, 380×240). */
function baseNode(id: string, overrides: Partial<DesignNode> = {}): DesignNode {
    return {
        type: 'frame',
        id,
        name: 'Node',
        frame: { x: 0, y: 0, width: 380, height: 240 },
        layout: {
            style: {
                strategy: 'flex',
                direction: 'column',
                alignItems: 'flex-start',
                justifyContent: 'flex-start',
                gap: 16,
            },
            position: { mode: 'static' },
            sizing: { widthMode: 'fixed', heightMode: 'fixed' },
            spacing: { padding: { top: 60, right: 60, bottom: 60, left: 60 } },
        },
        style: { fills: [{ type: 'solid', color: '#5865f2', visible: true }], radius: 20 },
        constraints: { horizontal: 'left', vertical: 'top' },
        children: [],
        ...overrides,
    };
}

/** Build a minimal design document. */
function makeDoc(...nodes: DesignNode[]): DesignDocument {
    return {
        version: '1.0.0',
        name: 'Tokens',
        nodes,
        assets: [],
        fonts: [],
        breakpoints: [],
    };
}

describe('matchPalette', () => {
    it('matches Tailwind palette colors and ignores everything else', () => {
        expect(matchPalette('#0f172a')).toBe('slate-900');
        expect(matchPalette('#6366f1')).toBe('indigo-500');
        expect(matchPalette('#10b981')).toBe('emerald-500');
        expect(matchPalette('#f8fafc')).toBe('slate-50');
        expect(matchPalette('#ffffff')).toBe('white');
        // Non-palette hexes and translucent colors have no standard class.
        expect(matchPalette('#eef2f7')).toBeUndefined();
        expect(matchPalette('#5865f2')).toBeUndefined();
        expect(matchPalette('rgba(15, 23, 42, 0.5)')).toBeUndefined();
    });
});

describe('extractTokens', () => {
    it('collects non-palette colors, off-scale radii, and spacing as tokens', () => {
        const tokens = extractTokens(makeDoc(baseNode('a'), baseNode('b')));

        // Duplicate colors dedupe; palette colors never appear.
        expect(tokens.colors).toEqual({ color1: '#5865f2' });
        // Radius 20 is off the default scale; height 240 → unit 60 is default.
        expect(tokens.radii).toEqual({ '20': 20 });
        expect(tokens.spacing['15']).toBe(60); // padding 60px
        expect(tokens.spacing['95']).toBe(380); // width 380px
        expect(tokens.spacing['60']).toBeUndefined();
    });

    it('skips prop-driven style fields and palette colors', () => {
        const accentBar = baseNode('bar', {
            style: { fills: [{ type: 'solid', color: '#10b981', visible: true }], radius: 9999 },
            metadata: { custom: { styleProps: { backgroundColor: 'accent' } } },
        });
        const root = baseNode('root', {
            style: { fills: [{ type: 'solid', color: '#6366f1', visible: true }], radius: 16 },
            children: [accentBar],
        });

        const tokens = extractTokens(makeDoc(root));
        // indigo-500 is a palette color and the emerald accent is prop-driven.
        expect(tokens.colors).toEqual({});
        // 16 and 9999 are default-scale radii.
        expect(tokens.radii).toEqual({});
    });

    it('names gradient stop colors without creating theme tokens', () => {
        const node = baseNode('grad', {
            style: {
                fills: [
                    {
                        type: 'linear',
                        angle: 135,
                        stops: [
                            { position: 0, color: '#6366f1' },
                            { position: 1, color: '#eef2f7' },
                        ],
                        visible: true,
                    },
                ],
            },
        });
        const tokens = extractTokens(makeDoc(node));

        // Palette stops map to sanitized names; non-palette stops get a colorN
        // module name. Neither becomes a theme token — no class renders a
        // gradient, but instance/gradient rendering still needs the names.
        expect(tokens.colorNames['#6366f1']).toBe('indigo500');
        expect(tokens.colorNames['#eef2f7']).toBe('color1');
        expect(tokens.colors).toEqual({});
    });

    it('renders radial gradients with token references', () => {
        const node = baseNode('radial', {
            name: 'Radial Hero',
            style: {
                fills: [
                    {
                        type: 'radial',
                        center: { x: 0.5, y: 0.5 },
                        radius: 0.5,
                        stops: [
                            { position: 0, color: '#6366f1' },
                            { position: 1, color: '#0f172a' },
                        ],
                        visible: true,
                    },
                ],
            },
        });
        const project = generateProject(makeDoc(node));

        const section = findFile(project, 'src/sections/RadialHero.tsx');
        expect(section).toBeDefined();
        expect(section!.content).toContain(
            'background: `radial-gradient(circle at 50% 50%, ${colors.indigo500} 0%, ${colors.slate900} 100%)`',
        );
        expect(section!.content).toContain("import { colors } from '../tokens';");
    });

    it('falls back to literal CSS colors when no tokens are available', () => {
        const node = baseNode('grad', {
            style: {
                fills: [
                    {
                        type: 'linear',
                        angle: 135,
                        stops: [
                            { position: 0, color: '#6366f1' },
                            { position: 1, color: '#eef2f7' },
                        ],
                        visible: true,
                    },
                ],
            },
        });
        const file = generateComponent(node);

        // Without tokens the gradient renders as a plain quoted string — no
        // interpolation and no tokens import.
        expect(file.content).toContain("background: 'linear-gradient(135deg, #6366f1 0%, #eef2f7 100%)'");
        expect(file.content).not.toContain('${colors.');
        expect(file.content).not.toContain("from '../tokens'");
    });

    it('collects variant member styles (they feed the variant class maps)', () => {
        const variantNode = baseNode('v', {
            metadata: {
                custom: {
                    variant: {
                        propName: 'variant',
                        default: 'primary-button',
                        values: ['primary-button', 'secondary-button'],
                        members: [
                            {
                                ...baseNode('m1', {
                                    style: { fills: [{ type: 'solid', color: '#5865f2', visible: true }] },
                                }),
                                children: [],
                            },
                            {
                                ...baseNode('m2', {
                                    style: {
                                        strokes: [
                                            { fill: { type: 'solid', color: '#eef2f7' }, width: 1, align: 'inside' },
                                        ],
                                    },
                                }),
                                children: [],
                            },
                        ],
                    },
                },
            },
        });

        const tokens = extractTokens(makeDoc(variantNode));
        expect(tokens.colors).toEqual({ color1: '#5865f2', color2: '#eef2f7' });
    });

    it('collects tokens from component templates (instances render their templates)', () => {
        const accentBar = baseNode('bar', {
            style: { fills: [{ type: 'solid', color: '#10b981', visible: true }] },
            metadata: { custom: { styleProps: { backgroundColor: 'accent' } } },
        });
        const template = baseNode('tpl', { children: [accentBar] });
        const instance = {
            ...baseNode('inst'),
            type: 'component',
            componentId: 'component-token-card',
            componentName: 'TokenCard',
            props: { accent: '#10b981' },
            template,
        } as DesignComponentNode;

        const tokens = extractTokens(makeDoc(instance));
        // The template root's static fill becomes a theme token; the
        // prop-driven accent is not a theme token but still gets a module name.
        expect(tokens.colors).toEqual({ color1: '#5865f2' });
        expect(tokens.colorNames['#10b981']).toBe('emerald500');
    });

    it('maps every emitted color to a module name (palette names + color-N)', () => {
        const accentBar = baseNode('bar', {
            style: { fills: [{ type: 'solid', color: '#5865f2', visible: true }] },
            metadata: { custom: { styleProps: { backgroundColor: 'accent' } } },
        });
        const root = baseNode('root', {
            style: { fills: [{ type: 'solid', color: '#0f172a', visible: true }], radius: 12 },
            children: [accentBar],
        });
        const tokens = extractTokens(makeDoc(root));

        // Prop-driven accent still receives a module name; palette colors map
        // to sanitized palette names; theme tokens only cover static colors
        // (here none: the root is palette and the accent is prop-driven).
        expect(tokens.colorNames['#5865f2']).toBe('color1');
        expect(tokens.colorNames['#0f172a']).toBe('slate900');
        expect(tokens.colors).toEqual({});
    });

    it('names gradient prop stop colors from instance props', () => {
        const template = baseNode('tpl', {
            style: {
                fills: [
                    {
                        type: 'linear',
                        angle: 135,
                        stops: [
                            { position: 0, color: '#6366f1' },
                            { position: 1, color: '#8b5cf6' },
                        ],
                        visible: true,
                    },
                ],
            },
            metadata: { custom: { styleProps: { gradient: 'gradient' } } },
        });
        const instance = {
            ...baseNode('inst'),
            type: 'component',
            componentId: 'component-gradient-card',
            componentName: 'GradientCard',
            props: {
                gradient: {
                    angle: 135,
                    stops: [
                        { color: '#10b981', position: 0 },
                        { color: '#0ea5e9', position: 1 },
                    ],
                },
            },
            template,
        } as DesignComponentNode;

        const tokens = extractTokens(makeDoc(instance));
        // The prop-driven gradient's stops live only in the instance props;
        // the template's static stops are skipped (rendered from the prop).
        expect(tokens.colorNames['#10b981']).toBe('emerald500');
        expect(tokens.colorNames['#0ea5e9']).toBe('sky500');
        expect(tokens.colorNames['#6366f1']).toBeUndefined();
        expect(tokens.colors).toEqual({});
    });

    it('collects instance color prop values as module names', () => {
        const accentBar = baseNode('bar', {
            style: { fills: [{ type: 'solid', color: '#10b981', visible: true }] },
            metadata: { custom: { styleProps: { backgroundColor: 'accent' } } },
        });
        const template = baseNode('tpl', { children: [accentBar] });
        const instance = {
            ...baseNode('inst'),
            type: 'component',
            componentId: 'component-token-card',
            componentName: 'TokenCard',
            props: { accent: '#10b981' },
            template,
        } as DesignComponentNode;

        const tokens = extractTokens(makeDoc(instance));
        // The accent lives only in the instance props — the style walker skips
        // the prop-driven bar — yet it must be named for the tokens module.
        expect(tokens.colorNames['#10b981']).toBe('emerald500');
    });

    it('generates a tokens module with sanitized color names', () => {
        const tokens = extractTokens(makeDoc(baseNode('a')));
        const file = generateTokensModule(tokens);

        expect(file.path).toBe('src/tokens.ts');
        expect(file.content).toContain("color1: '#5865f2'");
        expect(file.content).toContain('as const');
        expect(file.content).toContain('export type ColorValue');
    });

    it('collects instance numeric prop values as module tokens', () => {
        const accentBar = baseNode('bar', {
            style: { fills: [{ type: 'solid', color: '#10b981', visible: true }] },
            metadata: { custom: { styleProps: { backgroundColor: 'accent' } } },
        });
        const template = baseNode('tpl', {
            style: { fills: [{ type: 'solid', color: '#ffffff', visible: true }], radius: 20 },
            metadata: { custom: { styleProps: { radius: 'radius', width: 'width' } } },
            children: [accentBar],
        });
        const instance = {
            ...baseNode('inst'),
            type: 'component',
            componentId: 'component-sizing-card',
            componentName: 'SizingCard',
            props: { accent: '#10b981', radius: 12, width: 380 },
            template,
        } as DesignComponentNode;

        const tokens = extractTokens(makeDoc(instance));
        // Radius prop values are keyed by px; length props by spacing unit.
        expect(tokens.radiusValues).toEqual({ '12': 12 });
        expect(tokens.spacingValues['95']).toBe(380);
        // The default-scale radius 12 is a module token but not a theme token.
        expect(tokens.radii).toEqual({});
    });

    it('exports radii and spacing from the tokens module with value types', () => {
        const accentBar = baseNode('bar', {
            style: { fills: [{ type: 'solid', color: '#10b981', visible: true }] },
            metadata: { custom: { styleProps: { backgroundColor: 'accent' } } },
        });
        const template = baseNode('tpl', {
            metadata: { custom: { styleProps: { radius: 'radius', width: 'width' } } },
            children: [accentBar],
        });
        const instance = {
            ...baseNode('inst'),
            type: 'component',
            componentId: 'component-sizing-card',
            componentName: 'SizingCard',
            props: { accent: '#10b981', radius: 20, width: 380 },
            template,
        } as DesignComponentNode;

        const tokens = extractTokens(makeDoc(instance));
        const file = generateTokensModule(tokens);
        expect(file.content).toContain('export const radii = {');
        expect(file.content).toContain('20: 20,');
        expect(file.content).toContain('export const spacing = {');
        expect(file.content).toContain('95: 380,');
        expect(file.content).toContain('export type RadiusValue');
        expect(file.content).toContain('export type SpacingValue');
    });
});

describe('tokens module interop', () => {
    it('imports both colors and type ColorValue when a component needs both', () => {
        // A component with its own color prop that also renders a nested
        // instance with a color prop: the file needs both import parts, and
        // the nested component file must be generated too.
        const accentBar = (id: string, styleProps: Record<string, string>): DesignNode =>
            baseNode(id, {
                style: { fills: [{ type: 'solid', color: '#10b981', visible: true }] },
                metadata: { custom: { styleProps } },
            });

        const templateB = baseNode('tplB', { children: [accentBar('tint_bar', { backgroundColor: 'tint' })] });
        const instanceB = {
            ...baseNode('instB', { name: 'Tinted Bar' }),
            type: 'component',
            componentId: 'component-tinted-bar',
            componentName: 'TintedBar',
            props: { tint: '#10b981' },
            template: templateB,
        } as DesignComponentNode;

        const templateA = baseNode('tplA', {
            children: [accentBar('own_bar', { backgroundColor: 'accent' }), instanceB],
        });
        const instanceA = {
            ...baseNode('instA', { name: 'Color Combo' }),
            type: 'component',
            componentId: 'component-color-combo',
            componentName: 'ColorCombo',
            props: { accent: '#10b981' },
            template: templateA,
        } as DesignComponentNode;

        const doc: DesignDocument = {
            version: '1.0.0',
            name: 'Interop',
            nodes: [{ ...baseNode('root', { name: 'Root Section' }), children: [instanceA] }],
            assets: [],
            fonts: [],
            breakpoints: [],
        };
        const project = generateProject(doc);

        const combo = findFile(project, 'src/components/ColorCombo.tsx');
        expect(combo).toBeDefined();
        expect(combo!.content).toContain("import { colors, type ColorValue } from '../tokens';");
        expect(combo!.content).toContain('accent?: ColorValue;');
        expect(combo!.content).toContain('tint={colors.emerald500}');

        // The nested instance gets its own component file with a ColorValue prop.
        const tinted = findFile(project, 'src/components/TintedBar.tsx');
        expect(tinted).toBeDefined();
        expect(tinted!.content).toContain('tint?: ColorValue;');
    });

    it('renders opacity raw and fractional spacing units via the module', () => {
        const template = baseNode('tpl', {
            metadata: { custom: { styleProps: { opacity: 'opacity', width: 'width' } } },
        });
        const instance = {
            ...baseNode('inst', { name: 'Peculiar Card' }),
            type: 'component',
            componentId: 'component-peculiar-card',
            componentName: 'PeculiarCard',
            props: { opacity: 0.5, width: 382 },
            template,
        } as DesignComponentNode;
        const doc: DesignDocument = {
            version: '1.0.0',
            name: 'Peculiar',
            nodes: [{ ...baseNode('root', { name: 'Root Section' }), children: [instance] }],
            assets: [],
            fonts: [],
            breakpoints: [],
        };
        const project = generateProject(doc);

        // Opacity is not a token field → raw number; 382px → fractional unit 95.5.
        const section = findFile(project, 'src/sections/RootSection.tsx');
        expect(section).toBeDefined();
        expect(section!.content).toContain('opacity={0.5}');
        expect(section!.content).toContain('width={spacing[95.5]}');

        const tokensFile = findFile(project, 'src/tokens.ts');
        expect(tokensFile!.content).toContain('95.5: 382,');
    });
});

describe('token-aware class generation', () => {
    it('prefers tokens when provided, arbitrary values otherwise', () => {
        const node = baseNode('n');
        const tokens: DesignTokens = {
            colors: { color1: '#5865f2' },
            radii: { '20': 20 },
            spacing: { '15': 60, '95': 380 },
            colorNames: {},
            radiusValues: {},
            spacingValues: {},
        };

        const withTokens = generateClasses(node, tokens);
        expect(withTokens).toContain('bg-color1');
        expect(withTokens).toContain('rounded-20');
        expect(withTokens).toContain('p-15');
        expect(withTokens).toContain('w-95');

        const without = generateClasses(node);
        expect(without).toContain('bg-[#5865f2]');
        expect(without).toContain('rounded-[20px]');
        expect(without).toContain('p-[60px]');
        expect(without).toContain('w-[380px]');
    });

    it('emits palette classes for palette colors', () => {
        const node = baseNode('palette', {
            style: { fills: [{ type: 'solid', color: '#0f172a', visible: true }], radius: 12 },
        });
        const classes = generateClasses(node, {
            colors: {},
            radii: {},
            spacing: {},
            colorNames: {},
            radiusValues: {},
            spacingValues: {},
        });
        expect(classes).toContain('bg-slate-900');
        expect(classes).toContain('rounded-xl');
        expect(classes).not.toContain('bg-[#0f172a]');
    });

    it('emits token classes for text and border colors too', () => {
        const tokens: DesignTokens = {
            colors: { color1: '#eef2f7' },
            radii: {},
            spacing: {},
            colorNames: {},
            radiusValues: {},
            spacingValues: {},
        };

        const textNode = {
            ...baseNode('t'),
            type: 'text',
            text: { text: 'Hi', style: { color: '#eef2f7', fontSize: 14 } },
        } as DesignNode;
        expect(generateClasses(textNode, tokens)).toContain('text-color1');

        const borderNode = baseNode('b', {
            style: { strokes: [{ fill: { type: 'solid', color: '#eef2f7' }, width: 1, align: 'inside' }] },
        });
        expect(generateClasses(borderNode, tokens)).toContain('border-color1');
    });
});
