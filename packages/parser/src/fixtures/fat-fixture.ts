/**
 * The "fat fixture" — a Framer document exercising every registered source
 * property (65 in total) so the Source Property Coverage gate test can
 * certify end-to-end fidelity.
 *
 * Each section is purpose-built so its emitted, code-level signature matches
 * the SourceProperty needles defined in `@framer/compiler-coverage`. The
 * gate test (`fat-fixture-gate.test.ts`) asserts every registered property
 * reaches `emitted` status with `unsupported === 0`.
 *
 * Layout (top-level):
 *
 *   1. StackSection           — exercises layout.strategy, stackDirection,
 *      stackDistribution, stackAlignment, stackWrapEnabled, gap, padding
 *   2. GridSection            — exercises gridColumnCount, gridRowCount,
 *      gridColumnWidth, gridRowHeight
 *   3. PositionedSection      — exercises position + top/right/bottom/left
 *      + zIndex
 *   4. SizingSection          — exercises width/height/min/max/aspectRatio
 *      + minWidth/minHeight/maxWidth/maxHeight
 *   5. StyleSection           — exercises backgroundColor, fills, stroke,
 *      borderRadius, shadow, blur, opacity, visible, overflow, rotation,
 *      cursor, imageRendering, backgroundGradient
 *   6. TypographySection      — exercises all text.* (14 properties)
 *   7. AssetSection           — exercises asset.image, asset.svg, asset.alt
 *   8. AnimationSection       — exercises animation.hover, animation.tap,
 *      animation.mount, animation.viewport, interaction.link
 *   9. ComponentSection       — exercises component.identifier/name/props/
 *      slots/master/code
 */

import type { FramerDocument, FramerNode } from '../types';

/**
 * A shared master body used by ComponentSection. Carries a real canvas
 * master so `template.metadata.custom.masterBody === true` is reachable.
 */
const bannerMaster: FramerNode = {
    id: 'master_banner_fat',
    type: 'Frame',
    name: 'Banner Master',
    frame: { x: 0, y: 0, width: 960, height: 180 },
    layout: {
        strategy: 'flex',
        direction: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'nowrap',
        gap: 32,
        padding: { top: 24, right: 32, bottom: 24, left: 32 },
        sizing: { widthMode: 'fill', heightMode: 'fixed' },
    },
    style: {
        fills: [{ type: 'solid', color: '#0f172a', visible: true }],
        radius: 16,
    },
    children: [
        {
            id: 'master_banner_title',
            type: 'Text',
            name: 'Title',
            frame: { x: 32, y: 24, width: 320, height: 32 },
            layout: { strategy: 'auto' },
            style: {},
            text: {
                text: 'Banner Headline',
                style: { fontFamily: 'Inter', fontSize: 28, fontWeight: 700, color: '#ffffff' },
            },
            children: [],
        },
        {
            id: 'master_banner_content',
            type: 'Slot',
            name: 'children',
            frame: { x: 384, y: 24, width: 200, height: 100 },
            layout: { strategy: 'auto' },
            style: {},
            children: [],
        },
        {
            id: 'master_banner_cta',
            type: 'Frame',
            name: 'Call To Action',
            frame: { x: 600, y: 24, width: 120, height: 48 },
            layout: {
                strategy: 'flex',
                direction: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: { top: 12, right: 24, bottom: 12, left: 24 },
                sizing: { widthMode: 'hug', heightMode: 'fixed' },
            },
            style: {
                fills: [{ type: 'solid', color: '#f8fafc', visible: true }],
                radius: 8,
            },
            children: [
                {
                    id: 'master_banner_cta_text',
                    type: 'Text',
                    name: 'CTA Label',
                    frame: { x: 0, y: 0, width: 100, height: 24 },
                    layout: { strategy: 'auto' },
                    style: {},
                    text: {
                        text: 'Get started',
                        style: { fontFamily: 'Inter', fontSize: 14, fontWeight: 600, color: '#0f172a' },
                    },
                    children: [],
                },
            ],
        },
    ],
};

/** A CODE component exercised to prove the verbatim-source emission path. */
const codePhosphorSource = `// Phosphor icon component — verbatim source from a real CODE component.
// (JSX with the react-jsx runtime needs no React import, and the generated
// project's tsconfig enables noUnusedLocals, so the verbatim source must be
// clean under strict settings — as real Framer code components are.)
export interface PhosphorProps {
    name: string;
    size?: number;
    color?: string;
}

export default function Phosphor({ name, size = 24, color = '#0f172a' }: PhosphorProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-label={name}>
            <path d="M12 2l3 7 7 .9-5 4.9 1.5 7L12 18l-6.5 3.8L7 14.8 2 9.9 9 9z" />
        </svg>
    );
}
`;

// ─── 1. StackSection ────────────────────────────────────────────────────────
const stackSection: FramerNode = {
    id: 'section_stack_fat',
    type: 'Frame',
    name: 'Stack Section',
    frame: { x: 0, y: 0, width: 1440, height: 360 },
    layout: {
        strategy: 'flex',
        direction: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16,
        padding: { top: 32, right: 32, bottom: 32, left: 32 },
        sizing: { widthMode: 'fill', heightMode: 'fixed' },
    },
    style: { fills: [{ type: 'solid', color: '#f1f5f9', visible: true }] },
    // On small screens the stack reflows to a column (mobile-first behavior
    // defined in the source — the reference renderer and the generated CSS
    // must both honor it identically).
    responsive: {
        sm: { layout: { direction: 'column' } },
    },
    children: [
        { id: 'stk_a', type: 'Frame', name: 'A', frame: { x: 0, y: 0, width: 200, height: 80 }, layout: { strategy: 'auto' }, style: {} },
        { id: 'stk_b', type: 'Frame', name: 'B', frame: { x: 0, y: 0, width: 200, height: 80 }, layout: { strategy: 'auto' }, style: {} },
        { id: 'stk_c', type: 'Frame', name: 'C', frame: { x: 0, y: 0, width: 200, height: 80 }, layout: { strategy: 'auto' }, style: {} },
    ],
};

// ─── 2. GridSection ─────────────────────────────────────────────────────────
const gridSection: FramerNode = {
    id: 'section_grid_fat',
    type: 'Frame',
    name: 'Grid Section',
    frame: { x: 0, y: 0, width: 1440, height: 360 },
    layout: {
        strategy: 'grid',
        direction: 'row',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        gap: 12,
        columns: 3,
        rows: 2,
        columnWidth: 220,
        rowHeight: 120,
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
        sizing: { widthMode: 'fill', heightMode: 'fixed' },
    },
    style: { fills: [{ type: 'solid', color: '#ffffff', visible: true }] },
    children: [
        { id: 'grid_1', type: 'Frame', name: '1', frame: { x: 0, y: 0, width: 220, height: 120 }, layout: { strategy: 'auto' }, style: {} },
        { id: 'grid_2', type: 'Frame', name: '2', frame: { x: 0, y: 0, width: 220, height: 120 }, layout: { strategy: 'auto' }, style: {} },
        { id: 'grid_3', type: 'Frame', name: '3', frame: { x: 0, y: 0, width: 220, height: 120 }, layout: { strategy: 'auto' }, style: {} },
    ],
};

// ─── 3. PositionedSection ───────────────────────────────────────────────────
const positionedSection: FramerNode = {
    id: 'section_positioned_fat',
    type: 'Frame',
    name: 'Positioned Section',
    frame: { x: 0, y: 0, width: 1440, height: 360 },
    layout: {
        strategy: 'absolute',
        position: 'relative',
        offsets: { top: 0, right: 0, bottom: 0, left: 0 },
        zIndex: 0,
        sizing: { widthMode: 'fill', heightMode: 'fixed' },
    },
    style: { fills: [{ type: 'solid', color: '#fafafa', visible: true }] },
    children: [
        {
            id: 'pos_anchor',
            type: 'Frame',
            name: 'A',
            frame: { x: 0, y: 0, width: 1440, height: 360 },
            layout: { strategy: 'auto' },
            style: { fills: [{ type: 'solid', color: '#fafafa', visible: true }] },
            children: [],
        },
        {
            id: 'pos_overlay',
            type: 'Frame',
            name: 'Overlay',
            frame: { x: 32, y: 40, width: 240, height: 120 },
            layout: {
                strategy: 'absolute',
                position: 'absolute',
                offsets: { top: 40, right: undefined, bottom: undefined, left: 32 },
                zIndex: 10,
            },
            style: { fills: [{ type: 'solid', color: '#0ea5e9', visible: true }] },
            // The floating overlay hides below the sm breakpoint — visibility
            // behavior defined in the source, honored identically by both
            // renderers.
            responsive: {
                sm: { visible: false },
            },
            children: [],
        },
    ],
};

// ─── 4. SizingSection ───────────────────────────────────────────────────────
const sizingSection: FramerNode = {
    id: 'section_sizing_fat',
    type: 'Frame',
    name: 'Sizing Section',
    frame: { x: 0, y: 0, width: 1440, height: 320 },
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
    children: [
        {
            id: 'sz_fixed',
            type: 'Frame',
            name: 'Fixed',
            frame: { x: 0, y: 0, width: 240, height: 160 },
            layout: { strategy: 'auto', sizing: { widthMode: 'fixed', heightMode: 'fixed' } },
            style: {},
        },
        {
            id: 'sz_aspect',
            type: 'Frame',
            name: 'Aspect',
            frame: { x: 0, y: 0, width: 320, height: 180 },
            layout: { strategy: 'auto', sizing: { aspectRatio: 16 / 9 } },
            style: {},
        },
        {
            id: 'sz_minmax',
            type: 'Frame',
            name: 'Min Max',
            frame: { x: 0, y: 0, width: 240, height: 160 },
            layout: {
                strategy: 'auto',
                sizing: {
                    widthMode: 'fill',
                    heightMode: 'fixed',
                    minWidth: 200,
                    maxWidth: 360,
                    minHeight: 100,
                    maxHeight: 220,
                },
            },
            style: {},
        },
    ],
};

// ─── 5. StyleSection ────────────────────────────────────────────────────────
const styleSection: FramerNode = {
    id: 'section_style_fat',
    type: 'Frame',
    name: 'Style Section',
    frame: { x: 0, y: 0, width: 1440, height: 360 },
    layout: {
        strategy: 'flex',
        direction: 'row',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        gap: 24,
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
        sizing: { widthMode: 'fill', heightMode: 'fixed' },
    },
    style: {},
    children: [
        // Solid color frame: backgroundColor + borderRadius + shadow
        {
            id: 'style_solid',
            type: 'Frame',
            name: 'Solid',
            frame: { x: 0, y: 0, width: 220, height: 160 },
            layout: { strategy: 'auto' },
            style: {
                fills: [{ type: 'solid', color: '#6366f1', visible: true }],
                radius: 12,
                shadows: [{ color: 'rgba(15,23,42,0.2)', offsetX: 0, offsetY: 8, blur: 24, spread: 0, visible: true }],
            },
        },
        // Gradient frame: backgroundGradient
        {
            id: 'style_gradient',
            type: 'Frame',
            name: 'Gradient',
            frame: { x: 0, y: 0, width: 220, height: 160 },
            layout: { strategy: 'auto' },
            style: {
                fills: [{
                    type: 'linear',
                    gradient: {
                        angle: 135,
                        stops: [
                            { position: 0, color: '#a855f7' },
                            { position: 1, color: '#ec4899' },
                        ],
                    },
                    visible: true,
                }],
                radius: 16,
            },
        },
        // Stroke + opacity + rotation + overflow + visible
        {
            id: 'style_stroked',
            type: 'Frame',
            name: 'Stroked',
            frame: { x: 0, y: 0, width: 220, height: 160 },
            layout: { strategy: 'auto' },
            style: {
                strokes: [{ fill: { type: 'solid', color: '#0ea5e9', visible: true }, width: 2, visible: true }],
                opacity: 0.85,
                transform: { rotate: 6 },
                overflow: 'hidden',
                visible: true,
                cursor: 'pointer',
                imageRendering: 'crisp-edges',
            },
        },
        // Blur filter frame
        {
            id: 'style_blur',
            type: 'Frame',
            name: 'Blurred',
            frame: { x: 0, y: 0, width: 220, height: 160 },
            layout: { strategy: 'auto' },
            style: {
                fills: [{ type: 'solid', color: '#22d3ee', visible: true }],
                filters: [{ type: 'blur', value: 6 }],
            },
        },
    ],
};

// ─── 6. TypographySection ──────────────────────────────────────────────────
const typographySection: FramerNode = {
    id: 'section_typography_fat',
    type: 'Frame',
    name: 'Typography Section',
    frame: { x: 0, y: 0, width: 1440, height: 420 },
    layout: {
        strategy: 'flex',
        direction: 'column',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        gap: 16,
        padding: { top: 32, right: 32, bottom: 32, left: 32 },
        sizing: { widthMode: 'fill', heightMode: 'fixed' },
    },
    style: {},
    children: [
        // Headline: family, weight, size, lineHeight, letterSpacing, color,
        // alignment, transform (uppercase).
        {
            id: 'ty_headline',
            type: 'Text',
            name: 'Headline',
            frame: { x: 0, y: 0, width: 600, height: 64 },
            layout: { strategy: 'auto' },
            style: {},
            text: {
                text: 'Build With Confidence',
                style: {
                    fontFamily: 'Inter',
                    fontSize: 48,
                    fontWeight: 700,
                    lineHeight: 1.1,
                    letterSpacing: -0.02,
                    color: '#0f172a',
                    textAlign: 'left',
                    textTransform: 'uppercase',
                },
            },
            // Headline shrinks on small screens — responsive typography.
            responsive: {
                sm: { style: { fontSize: 32 } },
            },
            children: [],
        },
        // Subhead: smaller size, italic, colored.
        {
            id: 'ty_subhead',
            type: 'Text',
            name: 'Subhead',
            frame: { x: 0, y: 0, width: 600, height: 32 },
            layout: { strategy: 'auto' },
            style: {},
            text: {
                text: 'A demonstration of every typography property',
                style: {
                    fontFamily: 'Playfair Display',
                    fontSize: 18,
                    fontWeight: 400,
                    italic: true,
                    color: '#475569',
                    textAlign: 'left',
                },
            },
            children: [],
        },
        // Inline-styled span: italic + underline + letterSpacing
        {
            id: 'ty_inline',
            type: 'Text',
            name: 'Italic Inline',
            frame: { x: 0, y: 0, width: 600, height: 28 },
            layout: { strategy: 'auto' },
            style: {},
            text: {
                text: 'Cursive, underlined.',
                style: {
                    fontFamily: 'Playfair Display',
                    fontSize: 16,
                    italic: true,
                    textDecoration: 'underline',
                    letterSpacing: 0.05,
                    color: '#0f172a',
                },
            },
            children: [],
        },
        // Centered
        {
            id: 'ty_centered',
            type: 'Text',
            name: 'Centered',
            frame: { x: 0, y: 0, width: 600, height: 24 },
            layout: { strategy: 'auto' },
            style: {},
            text: {
                text: 'Centered text',
                style: {
                    fontFamily: 'Inter',
                    fontSize: 16,
                    fontWeight: 500,
                    color: '#0f172a',
                    textAlign: 'center',
                },
            },
            children: [],
        },
    ],
};

// ─── 7. AssetSection ────────────────────────────────────────────────────────
const assetSection: FramerNode = {
    id: 'section_assets_fat',
    type: 'Frame',
    name: 'Assets Section',
    frame: { x: 0, y: 0, width: 1440, height: 360 },
    layout: {
        strategy: 'flex',
        direction: 'row',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        gap: 24,
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
        sizing: { widthMode: 'fill', heightMode: 'fixed' },
    },
    style: {},
    children: [
        // image asset (with alt text + remote URL — bytes may or may not exist)
        {
            id: 'asset_image_fat',
            type: 'Image',
            name: 'Hero',
            frame: { x: 0, y: 0, width: 480, height: 320 },
            layout: { strategy: 'auto' },
            image: {
                src: 'https://framerusercontent.com/images/hero.png',
                name: 'Hero',
                alt: 'Hero illustration',
            },
            style: {},
        },
        // SVG asset (vector node with inline SVG content)
        {
            id: 'asset_svg_fat',
            type: 'Vector',
            name: 'Star',
            frame: { x: 0, y: 0, width: 96, height: 96 },
            layout: { strategy: 'auto' },
            vector: {
                svg: '<svg viewBox="0 0 24 24"><path d="M12 2l3 7 7 .9-5 4.9 1.5 7L12 18l-6.5 3.8L7 14.8 2 9.9 9 9z" fill="#f59e0b"/></svg>',
                name: 'Star',
            },
            style: {},
        },
    ],
};

// ─── 8. AnimationSection ────────────────────────────────────────────────────
const animationSection: FramerNode = {
    id: 'section_animations_fat',
    type: 'Frame',
    name: 'Animation Section',
    frame: { x: 0, y: 0, width: 1440, height: 360 },
    layout: {
        strategy: 'flex',
        direction: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 32,
        padding: { top: 32, right: 32, bottom: 32, left: 32 },
        sizing: { widthMode: 'fill', heightMode: 'fixed' },
    },
    style: {},
    children: [
        // Hover animation — whileHover
        {
            id: 'anim_hover',
            type: 'Frame',
            name: 'Hover Me',
            frame: { x: 0, y: 0, width: 200, height: 96 },
            layout: { strategy: 'auto' },
            style: { fills: [{ type: 'solid', color: '#fde68a', visible: true }], radius: 12 },
            interactions: [{
                type: 'animation',
                trigger: 'hover',
                name: 'Hover Scale',
                animation: {
                    type: 'spring',
                    duration: 0.3,
                    stiffness: 200,
                    damping: 18,
                    properties: { scale: 1.05 },
                },
            }],
        },
        // Tap animation — whileTap
        {
            id: 'anim_tap',
            type: 'Frame',
            name: 'Tap Me',
            frame: { x: 0, y: 0, width: 200, height: 96 },
            layout: { strategy: 'auto' },
            style: { fills: [{ type: 'solid', color: '#bef264', visible: true }], radius: 12 },
            interactions: [{
                type: 'animation',
                trigger: 'tap',
                name: 'Tap Shrink',
                animation: {
                    type: 'spring',
                    duration: 0.2,
                    stiffness: 400,
                    damping: 20,
                    properties: { scale: 0.96 },
                },
            }],
        },
        // Mount animation — initial + animate
        {
            id: 'anim_mount',
            type: 'Frame',
            name: 'On Mount',
            frame: { x: 0, y: 0, width: 200, height: 96 },
            layout: { strategy: 'auto' },
            style: { fills: [{ type: 'solid', color: '#a7f3d0', visible: true }], radius: 12 },
            interactions: [{
                type: 'animation',
                trigger: 'animate',
                name: 'Mount Fade In',
                animation: {
                    type: 'tween',
                    duration: 0.6,
                    ease: 'easeOut',
                    initial: { opacity: 0, y: 16 },
                    properties: { opacity: 1, y: 0 },
                },
            }],
        },
        // Viewport animation — whileInView
        {
            id: 'anim_viewport',
            type: 'Frame',
            name: 'On View',
            frame: { x: 0, y: 0, width: 200, height: 96 },
            layout: { strategy: 'auto' },
            style: { fills: [{ type: 'solid', color: '#bae6fd', visible: true }], radius: 12 },
            interactions: [{
                type: 'animation',
                trigger: 'whileInView',
                name: 'Viewport Slide',
                animation: {
                    type: 'tween',
                    duration: 0.8,
                    ease: 'easeOut',
                    properties: { opacity: 1, y: 0 },
                    viewport: { amount: 0.6, once: true },
                },
            }],
        },
        // Link interaction
        {
            id: 'anim_link',
            type: 'Frame',
            name: 'Go to About',
            frame: { x: 0, y: 0, width: 200, height: 96 },
            layout: { strategy: 'auto' },
            style: { fills: [{ type: 'solid', color: '#fbcfe8', visible: true }], radius: 12 },
            interactions: [{
                type: 'link',
                trigger: 'click',
                url: '/about',
                newTab: false,
            }],
        },
    ],
};

// ─── 9. ComponentSection ────────────────────────────────────────────────────
const bannerInstance: FramerNode = {
    id: 'banner_instance_fat',
    type: 'Component',
    name: 'Banner',
    frame: { x: 0, y: 0, width: 960, height: 180 },
    layout: { strategy: 'auto' },
    component: {
        id: 'cmp_banner_fat',
        name: 'Banner',
        master: bannerMaster,
        props: { variant: 'primary', tone: 'dark' },
        slots: {
            children: [
                {
                    id: 'banner_slot_fat_text',
                    type: 'Text',
                    name: 'Slot Content',
                    frame: { x: 0, y: 0, width: 320, height: 24 },
                    layout: { strategy: 'auto' },
                    style: {},
                    text: {
                        text: 'Content for the banner slot',
                        style: { fontFamily: 'Inter', fontSize: 18, color: '#ffffff' },
                    },
                    children: [],
                },
            ],
        },
    },
    children: [],
};

// CODE component instance — uses verbatim source for the implementation.
const phosphorInstance: FramerNode = {
    id: 'phosphor_instance_fat',
    type: 'Component',
    name: 'Phosphor',
    frame: { x: 0, y: 0, width: 56, height: 56 },
    layout: { strategy: 'auto' },
    component: {
        id: 'cmp_phosphor_fat',
        name: 'Phosphor',
        props: { name: 'star', size: 32, color: '#0f172a' },
        code: {
            source: codePhosphorSource,
            fileName: 'Phosphor.tsx',
            path: 'code/Phosphor.tsx',
            exportName: 'default',
            isDefaultExport: true,
            dependencies: [],
        },
    },
    children: [],
};

const componentSection: FramerNode = {
    id: 'section_components_fat',
    type: 'Frame',
    name: 'Component Section',
    frame: { x: 0, y: 0, width: 1440, height: 360 },
    layout: {
        strategy: 'flex',
        direction: 'column',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        gap: 32,
        padding: { top: 32, right: 32, bottom: 32, left: 32 },
        sizing: { widthMode: 'fill', heightMode: 'fixed' },
    },
    style: {},
    children: [bannerInstance, phosphorInstance],
};

/**
 * Replica identity: an UNRESOLVED breakpoint/variant override (SDK
 * `isReplica` + `originalId`) kept as an independent node. Exercises the
 * `source.isReplica` coverage property end-to-end — the fold normally prunes
 * resolved replicas, so a replica that reaches the model must still carry
 * its identity into the AST (metadata.custom.replicaOf) and the manifest's
 * `replicas` section.
 */
const replicaSection: FramerNode = {
    id: 'replica_orphan',
    type: 'Frame',
    name: 'Orphan Replica',
    frame: { x: 0, y: 0, width: 1440, height: 120 },
    layout: {
        strategy: 'flex',
        direction: 'row',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        gap: 16,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        sizing: { widthMode: 'fill', heightMode: 'fixed' },
    },
    style: {},
    // The primary this replica derives from does not exist in the document
    // (an engine-internal id the extraction could not resolve).
    source: { platform: 'framer', nodeId: 'replica_orphan', isReplica: true, originalId: 'ghost_primary', breakpointName: 'Tablet' },
    children: [],
};

/** The fat fixture document — exercises every registered SourceProperty. */
export const fatFixtureDocument: FramerDocument = {
    id: 'doc_fat_fixture',
    name: 'Fat Fixture',
    version: '1.0.0',
    nodes: [
        stackSection,
        gridSection,
        positionedSection,
        sizingSection,
        styleSection,
        typographySection,
        assetSection,
        animationSection,
        componentSection,
        replicaSection,
    ],
    // The document's own breakpoint scale — the reference renderer and the
    // generated responsive.css both consume these exact thresholds.
    breakpoints: [
        { name: 'sm', minWidth: 640 },
        { name: 'md', minWidth: 768 },
        { name: 'lg', minWidth: 1024 },
    ],
    metadata: {
        platform: 'framer',
        // The replica above is kept (its primary could not be resolved) — the
        // extraction record names it so the manifest's `replicas` section and
        // the diagnostics agree with what the node tree actually carries.
        extraction: {
            masters: { status: 'ok', count: 2 },
            codeFiles: { status: 'ok', count: 1 },
            fonts: { status: 'ok', count: 3 },
            replicas: {
                status: 'partial',
                count: 0,
                failed: 1,
                unresolved: 1,
                unsupported: 0,
                reason: "1 replica(s) had no matching primary node ('Orphan Replica' (ghost_primary)) and were kept as independent nodes",
            },
        },
    },
};
