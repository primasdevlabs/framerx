/**
 * A realistic mock Framer document fixture for testing the compiler pipeline.
 *
 * This represents the shape of a Framer document as read from the plugin SDK.
 * It exercises frames, text, images, components, animations, layouts, and
 * gradients (both a static section background and extracted gradient props).
 */

import type { FramerDocument, FramerNode } from '../types';

/** A landing page hero section frame with auto-layout. */
const heroFrame: FramerNode = {
    id: 'frame_hero',
    type: 'Frame',
    name: 'Hero Section',
    frame: { x: 0, y: 0, width: 1440, height: 600 },
    layout: {
        strategy: 'flex',
        direction: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: { top: 80, right: 24, bottom: 80, left: 24 },
        sizing: { widthMode: 'fill', heightMode: 'fixed' },
    },
    style: {
        fills: [{ type: 'solid', color: '#0f172a', visible: true }],
    },
    // Responsive: the hero's vertical padding tightens at the tablet tier.
    responsive: {
        tablet: {
            spacing: {
                padding: { top: 56, right: 24, bottom: 56, left: 24 },
            },
        },
    },
    children: [
        {
            id: 'text_heading',
            type: 'Text',
            name: 'Heading',
            frame: { x: 24, y: 200, width: 700, height: 96 },
            layout: { strategy: 'auto' },
            style: {},
            text: {
                text: 'Build Production-Ready Apps',
                style: {
                    fontFamily: 'Inter',
                    fontSize: 64,
                    fontWeight: 700,
                    lineHeight: 1.1,
                    color: '#ffffff',
                    textAlign: 'center',
                },
            },
            // Responsive: the headline scales down at the tablet tier.
            responsive: {
                tablet: {
                    style: {
                        fontSize: 48,
                    },
                },
            },
        },
        {
            id: 'text_subheading',
            type: 'Text',
            name: 'Subheading',
            frame: { x: 220, y: 320, width: 1000, height: 56 },
            layout: { strategy: 'auto' },
            style: {},
            text: {
                text: 'Export your Framer designs as clean, maintainable React + TypeScript code.',
                style: {
                    fontFamily: 'Inter',
                    fontSize: 20,
                    fontWeight: 400,
                    lineHeight: 1.5,
                    color: '#94a3b8',
                    textAlign: 'center',
                },
            },
        },
        {
            id: 'group_buttons',
            type: 'Group',
            name: 'Button Group',
            frame: { x: 520, y: 400, width: 400, height: 64 },
            layout: {
                strategy: 'flex',
                direction: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
                sizing: { widthMode: 'hug', heightMode: 'hug' },
            },
            children: [
                {
                    id: 'button_primary',
                    type: 'Frame',
                    name: 'Primary Button',
                    frame: { x: 0, y: 0, width: 180, height: 56 },
                    layout: {
                        strategy: 'flex',
                        direction: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        sizing: { widthMode: 'fixed', heightMode: 'fixed' },
                    },
                    style: {
                        fills: [{ type: 'solid', color: '#6366f1', visible: true }],
                        radius: 12,
                    },
                    interactions: [
                        {
                            type: 'animation',
                            trigger: 'whileHover',
                            animation: {
                                type: 'tween',
                                duration: 0.2,
                                ease: 'ease-out',
                                properties: { scale: 1.05 },
                            },
                        },
                    ],
                    children: [
                        {
                            id: 'button_primary_text',
                            type: 'Text',
                            name: 'Button Label',
                            frame: { x: 40, y: 16, width: 100, height: 24 },
                            layout: { strategy: 'auto' },
                            style: {},
                            text: {
                                text: 'Get Started',
                                style: {
                                    fontFamily: 'Inter',
                                    fontSize: 16,
                                    fontWeight: 600,
                                    color: '#ffffff',
                                    textAlign: 'center',
                                },
                            },
                        },
                    ],
                },
                {
                    id: 'button_secondary',
                    type: 'Frame',
                    name: 'Secondary Button',
                    frame: { x: 196, y: 0, width: 180, height: 56 },
                    layout: {
                        strategy: 'flex',
                        direction: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        sizing: { widthMode: 'fixed', heightMode: 'fixed' },
                    },
                    style: {
                        strokes: [
                            {
                                fill: { type: 'solid', color: '#94a3b8' },
                                width: 1,
                                align: 'inside',
                            },
                        ],
                        radius: 12,
                    },
                    interactions: [
                        {
                            type: 'animation',
                            trigger: 'whileHover',
                            animation: {
                                type: 'tween',
                                duration: 0.2,
                                ease: 'ease-out',
                                properties: { scale: 1.05 },
                            },
                        },
                    ],
                    children: [
                        {
                            id: 'button_secondary_text',
                            type: 'Text',
                            name: 'Button Label',
                            frame: { x: 40, y: 16, width: 100, height: 24 },
                            layout: { strategy: 'auto' },
                            style: {},
                            text: {
                                text: 'Learn More',
                                style: {
                                    fontFamily: 'Inter',
                                    fontSize: 16,
                                    fontWeight: 600,
                                    color: '#94a3b8',
                                    textAlign: 'center',
                                },
                            },
                        },
                    ],
                },
            ],
        },
    ],
};

/** A card components grid frame. */
const cardsSection: FramerNode = {
    id: 'frame_cards',
    type: 'Frame',
    name: 'Features Section',
    frame: { x: 0, y: 600, width: 1440, height: 400 },
    layout: {
        strategy: 'flex',
        direction: 'row',
        alignItems: 'stretch',
        justifyContent: 'space-between',
        gap: 24,
        padding: { top: 80, right: 80, bottom: 80, left: 80 },
        sizing: { widthMode: 'fill', heightMode: 'fixed' },
    },
    style: {
        fills: [{ type: 'solid', color: '#f8fafc', visible: true }],
    },
    // Responsive: the cards grid tightens its padding and gap at tablet.
    responsive: {
        tablet: {
            spacing: {
                padding: { top: 40, right: 40, bottom: 40, left: 40 },
            },
            layout: {
                gap: 16,
            },
        },
    },
    children: [
        {
            id: 'component_card_1',
            type: 'Component',
            name: 'Feature Card',
            frame: { x: 80, y: 80, width: 380, height: 240 },
            layout: {
                strategy: 'flex',
                direction: 'column',
                alignItems: 'flex-start',
                justifyContent: 'flex-start',
                gap: 16,
                padding: { top: 32, right: 32, bottom: 32, left: 32 },
                sizing: { widthMode: 'fixed', heightMode: 'fixed' },
            },
            component: {
                id: 'component_feature_card',
                name: 'FeatureCard',
                props: {
                    title: 'Compiler First',
                    description: 'A true compiler pipeline, not a simple exporter.',
                },
            },
            style: {
                fills: [{ type: 'solid', color: '#ffffff', visible: true }],
                radius: 16,
                shadows: [
                    {
                        color: '#0f172a',
                        offsetX: 0,
                        offsetY: 4,
                        blur: 24,
                        spread: 0,
                        inset: false,
                    },
                ],
            },
            children: [],
        },
        {
            id: 'component_card_2',
            type: 'Component',
            name: 'Feature Card',
            frame: { x: 484, y: 80, width: 380, height: 240 },
            layout: {
                strategy: 'flex',
                direction: 'column',
                alignItems: 'flex-start',
                justifyContent: 'flex-start',
                gap: 16,
                padding: { top: 32, right: 32, bottom: 32, left: 32 },
                sizing: { widthMode: 'fixed', heightMode: 'fixed' },
            },
            component: {
                id: 'component_feature_card',
                name: 'FeatureCard',
                props: {
                    title: 'Platform Agnostic',
                    description: 'The core compiler never depends on Framer APIs.',
                },
            },
            style: {
                fills: [{ type: 'solid', color: '#ffffff', visible: true }],
                radius: 16,
                shadows: [
                    {
                        color: '#0f172a',
                        offsetX: 0,
                        offsetY: 4,
                        blur: 24,
                        spread: 0,
                        inset: false,
                    },
                ],
            },
            children: [],
        },
        {
            id: 'image_dashboard',
            type: 'Image',
            name: 'Dashboard Preview',
            frame: { x: 888, y: 80, width: 472, height: 240 },
            layout: {
                strategy: 'auto',
                sizing: { widthMode: 'fixed', heightMode: 'fixed' },
            },
            style: {
                radius: 16,
            },
            image: {
                src: 'https://framerusercontent.com/images/dashboard-preview.png',
                name: 'dashboard-preview',
                width: 472,
                height: 240,
                mimeType: 'image/png',
                alt: 'Dashboard preview',
                objectFit: 'cover',
            },
            children: [],
        },
    ],
};

/** A scroll-triggered animation frame. */
const animatedFrame: FramerNode = {
    id: 'frame_animated',
    type: 'Frame',
    name: 'Animated Showcase',
    frame: { x: 0, y: 1000, width: 1440, height: 400 },
    layout: {
        strategy: 'flex',
        direction: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: { top: 60, right: 24, bottom: 60, left: 24 },
        sizing: { widthMode: 'fill', heightMode: 'fixed' },
    },
    style: {
        fills: [
            {
                type: 'linear',
                gradient: {
                    angle: 135,
                    stops: [
                        { position: 0, color: '#6366f1' },
                        { position: 1, color: '#8b5cf6' },
                    ],
                },
                visible: true,
            },
        ],
    },
    interactions: [
        {
            type: 'animation',
            trigger: 'whileInView',
            animation: {
                type: 'tween',
                duration: 0.8,
                ease: 'ease-out',
                properties: { opacity: 1, y: 0 },
                initial: { opacity: 0, y: 48 },
                viewport: { amount: 0.4, once: true },
            },
        },
    ],
    children: [
        {
            id: 'text_cta',
            type: 'Text',
            name: 'CTA Heading',
            frame: { x: 320, y: 160, width: 800, height: 72 },
            layout: { strategy: 'auto' },
            style: {},
            text: {
                text: 'Start Exporting Today',
                style: {
                    fontFamily: 'Inter',
                    fontSize: 48,
                    fontWeight: 700,
                    color: '#ffffff',
                    textAlign: 'center',
                },
            },
        },
    ],
};

/** A single testimonial card — one of three repeated subtrees (extraction target). */
function testimonialCard(id: string, x: number, quote: string, author: string): FramerNode {
    return {
        id,
        type: 'Frame',
        name: 'Testimonial Card',
        frame: { x, y: 0, width: 380, height: 240 },
        layout: {
            strategy: 'flex',
            direction: 'column',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            gap: 12,
            padding: { top: 32, right: 32, bottom: 32, left: 32 },
            sizing: { widthMode: 'fixed', heightMode: 'fixed' },
        },
        style: {
            fills: [{ type: 'solid', color: '#ffffff', visible: true }],
            // Off the default radius scale — extracted as the `rounded-20` token.
            radius: 20,
            shadows: [
                {
                    color: '#0f172a',
                    offsetX: 0,
                    offsetY: 4,
                    blur: 24,
                    spread: 0,
                    inset: false,
                },
            ],
        },
        children: [
            {
                id: `${id}_quote`,
                type: 'Text',
                name: 'Quote',
                frame: { x: 32, y: 32, width: 316, height: 96 },
                layout: { strategy: 'auto' },
                style: {},
                text: {
                    text: quote,
                    style: {
                        fontFamily: 'Inter',
                        fontSize: 18,
                        fontWeight: 500,
                        lineHeight: 1.5,
                        color: '#334155',
                    },
                },
            },
            {
                id: `${id}_author`,
                type: 'Text',
                name: 'Author',
                frame: { x: 32, y: 148, width: 316, height: 24 },
                layout: { strategy: 'auto' },
                style: {},
                text: {
                    text: author,
                    style: {
                        fontFamily: 'Inter',
                        fontSize: 14,
                        fontWeight: 600,
                        color: '#64748b',
                    },
                },
            },
        ],
    };
}

/** A testimonials grid — three repeated card subtrees differing only in text. */
const testimonialsSection: FramerNode = {
    id: 'frame_testimonials',
    type: 'Frame',
    name: 'Testimonials Section',
    frame: { x: 0, y: 1400, width: 1440, height: 400 },
    layout: {
        strategy: 'flex',
        direction: 'row',
        alignItems: 'stretch',
        justifyContent: 'space-between',
        gap: 24,
        padding: { top: 80, right: 80, bottom: 80, left: 80 },
        sizing: { widthMode: 'fill', heightMode: 'fixed' },
    },
    style: {
        // A non-palette brand gray — extracted as the `color-1` design token.
        fills: [{ type: 'solid', color: '#eef2f7', visible: true }],
    },
    children: [
        testimonialCard(
            'frame_testimonial_1',
            80,
            'FramerX turned our design handoff into a one-click build.',
            'Sarah Chen, Design Lead',
        ),
        testimonialCard(
            'frame_testimonial_2',
            484,
            'The generated code reads like our team wrote it by hand.',
            'Marcus Rivera, Staff Engineer',
        ),
        testimonialCard(
            'frame_testimonial_3',
            888,
            'We shipped our redesign a week early thanks to this compiler.',
            'Aiko Tanaka, Product Manager',
        ),
    ],
};

/** A single stat card — repeated subtrees differing in accent color, size, radius, and text. */
function statCard(
    id: string,
    x: number,
    width: number,
    radius: number,
    accent: string,
    value: string,
    label: string,
): FramerNode {
    return {
        id,
        type: 'Frame',
        name: 'Stat Card',
        frame: { x, y: 0, width, height: 220 },
        layout: {
            strategy: 'flex',
            direction: 'column',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            gap: 12,
            padding: { top: 32, right: 32, bottom: 32, left: 32 },
            sizing: { widthMode: 'fixed', heightMode: 'fixed' },
        },
        style: {
            fills: [{ type: 'solid', color: '#ffffff', visible: true }],
            radius,
            shadows: [
                {
                    color: '#0f172a',
                    offsetX: 0,
                    offsetY: 4,
                    blur: 24,
                    spread: 0,
                    inset: false,
                },
            ],
        },
        children: [
            {
                id: `${id}_accent`,
                type: 'Frame',
                name: 'Accent',
                frame: { x: 32, y: 32, width: 48, height: 8 },
                layout: {
                    strategy: 'flex',
                    direction: 'row',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    sizing: { widthMode: 'fixed', heightMode: 'fixed' },
                },
                style: {
                    fills: [{ type: 'solid', color: accent, visible: true }],
                    radius: 9999,
                },
                children: [],
            },
            {
                id: `${id}_value`,
                type: 'Text',
                name: 'Value',
                frame: { x: 32, y: 56, width: 316, height: 44 },
                layout: { strategy: 'auto' },
                style: {},
                text: {
                    text: value,
                    style: {
                        fontFamily: 'Inter',
                        fontSize: 32,
                        fontWeight: 700,
                        color: '#0f172a',
                    },
                },
            },
            {
                id: `${id}_label`,
                type: 'Text',
                name: 'Label',
                frame: { x: 32, y: 112, width: 316, height: 24 },
                layout: { strategy: 'auto' },
                style: {},
                text: {
                    text: label,
                    style: {
                        fontFamily: 'Inter',
                        fontSize: 14,
                        fontWeight: 500,
                        color: '#64748b',
                    },
                },
            },
        ],
    };
}

/** A metrics row — three repeated stat cards differing in accent + text. */
const metricsSection: FramerNode = {
    id: 'frame_metrics',
    type: 'Frame',
    name: 'Metrics Section',
    frame: { x: 0, y: 1800, width: 1440, height: 380 },
    layout: {
        strategy: 'flex',
        direction: 'row',
        alignItems: 'stretch',
        justifyContent: 'space-between',
        gap: 24,
        padding: { top: 80, right: 80, bottom: 80, left: 80 },
        sizing: { widthMode: 'fill', heightMode: 'fixed' },
    },
    style: {
        fills: [{ type: 'solid', color: '#0f172a', visible: true }],
    },
    children: [
        // Widths and radii vary → extracted as numeric props (width={spacing[95]},
        // radius={radii[20]}) referencing the tokens module.
        statCard('frame_stat_1', 80, 380, 20, '#10b981', '99.9%', 'Uptime'),
        statCard('frame_stat_2', 484, 360, 16, '#3b82f6', '1.2M+', 'Downloads'),
        statCard('frame_stat_3', 888, 340, 28, '#8b5cf6', '4.8★', 'Rating'),
    ],
};

/** A single gradient card — repeated subtrees differing in gradient stops/angle. */
function gradientCard(
    id: string,
    x: number,
    angle: number,
    stops: { position: number; color: string }[],
    label: string,
): FramerNode {
    return {
        id,
        type: 'Frame',
        name: 'Gradient Card',
        frame: { x, y: 0, width: 380, height: 240 },
        layout: {
            strategy: 'flex',
            direction: 'column',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            padding: { top: 32, right: 32, bottom: 32, left: 32 },
            sizing: { widthMode: 'fixed', heightMode: 'fixed' },
        },
        style: {
            fills: [{ type: 'linear', gradient: { angle, stops }, visible: true }],
            radius: 20,
        },
        children: [
            {
                id: `${id}_label`,
                type: 'Text',
                name: 'Gradient Label',
                frame: { x: 32, y: 32, width: 316, height: 32 },
                layout: { strategy: 'auto' },
                style: {},
                text: {
                    text: label,
                    style: {
                        fontFamily: 'Inter',
                        fontSize: 18,
                        fontWeight: 700,
                        color: '#ffffff',
                    },
                },
            },
            {
                id: `${id}_badge`,
                type: 'Frame',
                name: 'Badge',
                frame: { x: 32, y: 176, width: 96, height: 32 },
                layout: {
                    strategy: 'flex',
                    direction: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    sizing: { widthMode: 'fixed', heightMode: 'fixed' },
                },
                style: {
                    fills: [{ type: 'solid', color: '#ffffff', visible: true }],
                    radius: 9999,
                },
                children: [],
            },
        ],
    };
}

/** A gradient showcase — three repeated cards differing in gradient stops/angle. */
const gradientsSection: FramerNode = {
    id: 'frame_gradients',
    type: 'Frame',
    name: 'Gradient Section',
    frame: { x: 0, y: 2180, width: 1440, height: 400 },
    layout: {
        strategy: 'flex',
        direction: 'row',
        alignItems: 'stretch',
        justifyContent: 'space-between',
        gap: 24,
        padding: { top: 80, right: 80, bottom: 80, left: 80 },
        sizing: { widthMode: 'fill', heightMode: 'fixed' },
    },
    style: {
        fills: [{ type: 'solid', color: '#f8fafc', visible: true }],
    },
    children: [
        gradientCard(
            'frame_gradient_1',
            80,
            135,
            [
                { position: 0, color: '#6366f1' },
                { position: 1, color: '#8b5cf6' },
            ],
            'Indigo to Violet',
        ),
        // A three-stop gradient with a non-even middle stop exercises exact
        // position fidelity through the extracted gradient prop.
        gradientCard(
            'frame_gradient_2',
            484,
            90,
            [
                { position: 0, color: '#0ea5e9' },
                { position: 0.25, color: '#ffffff' },
                { position: 1, color: '#10b981' },
            ],
            'Sky to Emerald',
        ),
        gradientCard(
            'frame_gradient_3',
            888,
            45,
            [
                { position: 0, color: '#3b82f6' },
                { position: 1, color: '#0ea5e9' },
            ],
            'Blue to Sky',
        ),
    ],
};

/** The mock Framer document. */
export const mockFramerDocument: FramerDocument = {
    id: 'doc_mock_landing',
    name: 'Marketing Landing Page',
    version: '1.0.0',
    // The document defines its OWN breakpoints — the compiler emits media
    // queries at these exact widths, never assumed Tailwind sm/md/lg.
    breakpoints: [
        { name: 'mobile', minWidth: 0 },
        { name: 'tablet', minWidth: 768 },
        { name: 'desktop', minWidth: 1024 },
    ],
    nodes: [heroFrame, cardsSection, animatedFrame, testimonialsSection, metricsSection, gradientsSection],
    metadata: {
        platform: 'framer',
        exportedAt: '2026-08-07T00:00:00.000Z',
    },
};
