/**
 * Framer SDK node style → FramerStyle mapping.
 */

import type { FramerCornerRadius, FramerFill, FramerStyle, FramerTransform } from '@framer/compiler-parser';

import type { SdkColor, SdkNode } from './sdk-types';

/** Resolve a color to a CSS color string (named styles use their light value). */
export function resolveColor(color: SdkColor | null | undefined): string | undefined {
    if (color == null) return undefined;
    if (typeof color === 'string') return color;
    return color.light ?? color.dark ?? undefined;
}

/** Parse a color style into a solid fill. */
function solidFill(color: SdkColor | null | undefined): FramerFill | undefined {
    const resolved = resolveColor(color);
    if (!resolved) return undefined;
    return { type: 'solid', color: resolved, visible: true };
}

/** Parse a background gradient into a linear/radial fill. */
function gradientFill(gradient?: { angle?: number | null; x?: number | null; y?: number | null; stops: Array<{ position: number; color: SdkColor }> } | null): FramerFill | undefined {
    if (!gradient || gradient.stops.length === 0) return undefined;

    const stops = gradient.stops
        .map((stop) => ({ position: stop.position, color: resolveColor(stop.color) ?? '#000000' }))
        .filter((stop) => stop.position >= 0 && stop.position <= 1);

    if (stops.length === 0) return undefined;

    if (gradient.angle !== undefined && gradient.angle !== null) {
        return { type: 'linear', gradient: { angle: gradient.angle, stops }, visible: true };
    }

    return {
        type: 'radial',
        gradient: { center: { x: gradient.x ?? 0.5, y: gradient.y ?? 0.5 }, radius: 0.5, stops },
        visible: true,
    };
}

/** Convert "8px" → 8. Returns undefined when not a px value. */
function pxValue(value: string | null | undefined): number | undefined {
    if (!value) return undefined;
    const match = /^([\d.]+)px$/.exec(value.trim());
    return match ? Number(match[1]) : undefined;
}

/** Parse a border radius shorthand into a number or per-corner radius. */
export function parseBorderRadius(value: string | null | undefined): number | FramerCornerRadius | undefined {
    const px = pxValue(value);
    if (px !== undefined) return px;

    if (!value) return undefined;
    const corners = value.trim().split(/\s+/).map(pxValue).filter((v): v is number => v !== undefined);
    if (corners.length === 4) {
        // CSS order: top-left, top-right, bottom-right, bottom-left.
        return {
            topLeft: corners[0],
            topRight: corners[1],
            bottomRight: corners[2],
            bottomLeft: corners[3],
        };
    }
    if (corners.length === 1) return corners[0];
    return undefined;
}

/** Convert an SDK node's visual attributes to a FramerStyle. */
export function parseStyle(node: SdkNode): FramerStyle {
    const style: FramerStyle = {};

    const fills: FramerFill[] = [];
    const solid = solidFill(node.backgroundColor);
    if (solid) fills.push(solid);
    const gradient = gradientFill(node.backgroundGradient);
    if (gradient) fills.push(gradient);
    if (fills.length > 0) style.fills = fills;

    if (node.border) {
        style.strokes = [
            {
                fill: { type: 'solid', color: resolveColor(node.border.color) ?? '#000000' },
                width: pxValue(node.border.width) ?? 1,
                align: 'inside',
                visible: true,
            },
        ];
    }

    const radius = parseBorderRadius(node.borderRadius);
    if (radius !== undefined) style.radius = radius;

    if (node.opacity !== undefined) style.opacity = node.opacity;
    if (node.visible !== undefined) style.visible = node.visible;
    if (node.overflow) style.overflow = node.overflow as FramerStyle['overflow'];

    if (node.rotation) {
        const transform: FramerTransform = { rotate: node.rotation };
        style.transform = transform;
    }

    return style;
}

/** Convert a corner radius to a FramerStyle radius (shared helper). */
export function toCornerRadius(radius: number): FramerCornerRadius {
    return { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius };
}
