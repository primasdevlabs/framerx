/**
 * Framer style → Design AST visual style conversion.
 */

import type { VisualStyle, Transform, Filter } from '@framer/compiler-ast';
import type { BlendMode, CornerRadius, Fill, Shadow, Stroke } from '@framer/compiler-shared';
import { normalizeColor } from '@framer/compiler-shared';

import type { FramerFill, FramerFilter, FramerShadow, FramerStroke, FramerStyle } from './types';

/** Convert Framer style to a Design AST VisualStyle. */
export function parseStyle(style?: FramerStyle): VisualStyle {
    if (!style) return {};

    const result: VisualStyle = {};

    if (style.fills) {
        const fills = style.fills
            .filter((fill) => fill.visible !== false)
            .map(parseFill)
            .filter((fill): fill is Fill => fill !== null);
        if (fills.length > 0) result.fills = fills;
    }

    if (style.strokes) {
        const strokes = style.strokes
            .filter((stroke) => stroke.visible !== false)
            .map(parseStroke)
            .filter((stroke): stroke is Stroke => stroke !== null);
        if (strokes.length > 0) result.strokes = strokes;
    }

    if (style.radius !== undefined) {
        result.radius = parseRadius(style.radius);
    }

    if (style.shadows) {
        const shadows = style.shadows
            .filter((shadow) => shadow.visible !== false)
            .map(parseShadow);
        if (shadows.length > 0) result.shadows = shadows;
    }

    if (style.opacity !== undefined) result.opacity = style.opacity;
    if (style.blendMode) result.blendMode = style.blendMode as BlendMode;
    if (style.visible !== undefined) result.visible = style.visible;
    if (style.overflow) result.overflow = style.overflow as VisualStyle['overflow'];
    if (style.cursor) result.cursor = style.cursor;
    if (style.imageRendering) result.imageRendering = style.imageRendering;
    if (style.transform) result.transform = parseTransform(style.transform);
    if (style.filters) {
        const filters = style.filters.map(parseFilter);
        if (filters.length > 0) result.filters = filters;
    }

    return result;
}

/** Convert a Framer fill to a shared Fill. */
export function parseFill(fill: FramerFill): Fill | null {
    if (fill.visible === false) return null;

    switch (fill.type) {
        case 'solid':
            if (!fill.color) return null;
            return { type: 'solid', color: normalizeColor(fill.color) };
        case 'linear': {
            const gradient = fill.gradient;
            if (!gradient) return null;
            return {
                type: 'linear',
                angle: gradient.angle ?? 0,
                stops: gradient.stops.map((stop) => ({
                    position: stop.position,
                    color: normalizeColor(stop.color),
                })),
            };
        }
        case 'radial': {
            const gradient = fill.gradient;
            if (!gradient) return null;
            return {
                type: 'radial',
                center: gradient.center ?? { x: 0.5, y: 0.5 },
                radius: gradient.radius ?? 0.5,
                stops: gradient.stops.map((stop) => ({
                    position: stop.position,
                    color: normalizeColor(stop.color),
                })),
            };
        }
        case 'image':
            if (!fill.image?.src) return null;
            return {
                type: 'image',
                image: {
                    src: fill.image.src,
                    name: fill.image.name,
                    width: fill.image.width,
                    height: fill.image.height,
                    mimeType: fill.image.mimeType,
                    data: fill.image.data,
                    objectFit: fill.image.objectFit,
                    objectPosition: fill.image.objectPosition,
                },
            };
        default:
            return null;
    }
}

/** Convert a Framer stroke to a shared Stroke. */
export function parseStroke(stroke: FramerStroke): Stroke | null {
    const fill = parseFill(stroke.fill);
    if (!fill) return null;

    return {
        fill,
        width: stroke.width,
        align: (stroke.align as Stroke['align']) ?? 'center',
        dashPattern: stroke.dashPattern,
    };
}

/** Convert a Framer radius to a shared CornerRadius. */
export function parseRadius(radius: FramerStyle['radius']): CornerRadius {
    if (typeof radius === 'number') {
        return {
            topLeft: radius,
            topRight: radius,
            bottomRight: radius,
            bottomLeft: radius,
        };
    }

    if (!radius) {
        return { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
    }

    return {
        topLeft: radius.topLeft ?? 0,
        topRight: radius.topRight ?? 0,
        bottomRight: radius.bottomRight ?? 0,
        bottomLeft: radius.bottomLeft ?? 0,
    };
}

/** Convert a Framer shadow to a shared Shadow. */
export function parseShadow(shadow: FramerShadow): Shadow {
    return {
        color: normalizeColor(shadow.color),
        offsetX: shadow.offsetX,
        offsetY: shadow.offsetY,
        blur: shadow.blur,
        spread: shadow.spread,
        inset: shadow.inset ?? false,
    };
}

/** Convert a Framer transform to a Design AST Transform. */
export function parseTransform(transform: FramerStyle['transform']): Transform {
    return {
        rotate: transform?.rotate,
        scaleX: transform?.scaleX,
        scaleY: transform?.scaleY,
        skewX: transform?.skewX,
        skewY: transform?.skewY,
        translateX: transform?.translateX,
        translateY: transform?.translateY,
    };
}

/** Convert a Framer filter to a Design AST Filter. */
export function parseFilter(filter: FramerFilter): Filter {
    switch (filter.type) {
        case 'blur':
            return { type: 'blur', radius: filter.value };
        case 'brightness':
            return { type: 'brightness', amount: filter.value };
        case 'contrast':
            return { type: 'contrast', amount: filter.value };
        case 'grayscale':
            return { type: 'grayscale', amount: filter.value };
        case 'hue-rotate':
            return { type: 'hue-rotate', angle: filter.value };
        case 'invert':
            return { type: 'invert', amount: filter.value };
        case 'saturate':
            return { type: 'saturate', amount: filter.value };
        case 'sepia':
            return { type: 'sepia', amount: filter.value };
        default:
            return { type: 'blur', radius: 0 };
    }
}