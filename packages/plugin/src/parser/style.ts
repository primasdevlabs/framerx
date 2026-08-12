/**
 * Framer SDK node style → FramerStyle mapping.
 */

import type {
    FramerCornerRadius,
    FramerFill,
    FramerShadow,
    FramerStyle,
    FramerTransform,
} from '@framer/compiler-parser';

import { getSdkImageUrl, type SdkColor, type SdkNode } from './sdk-types';

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
function gradientFill(
    gradient?: {
        angle?: number | null;
        x?: number | null;
        y?: number | null;
        stops: Array<{ position: number; color: SdkColor }>;
    } | null,
): FramerFill | undefined {
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
    const corners = value
        .trim()
        .split(/\s+/)
        .map(pxValue)
        .filter((v): v is number => v !== undefined);
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

/** Parse a shadow from Framer SDK. */
function parseShadowItem(shadow: unknown): FramerShadow | undefined {
    if (!shadow) return undefined;
    if (typeof shadow === 'object') {
        const s = shadow as Record<string, unknown>;
        const color = resolveColor(s.color as SdkColor) ?? (typeof s.color === 'string' ? s.color : '#000000');
        const offsetX = Number(s.x ?? s.offsetX ?? 0);
        const offsetY = Number(s.y ?? s.offsetY ?? 0);
        const blur = Number(s.blur ?? 0);
        const spread = Number(s.spread ?? 0);
        const inset = Boolean(s.inset);
        return { color, offsetX, offsetY, blur, spread, inset, visible: true };
    }
    if (typeof shadow === 'string') {
        const match = /^(inset\s+)?(-?\d+px)\s+(-?\d+px)\s+(-?\d+px)(?:\s+(-?\d+px))?\s+(.+)$/i.exec(shadow.trim());
        if (match) {
            return {
                inset: Boolean(match[1]),
                offsetX: Number(match[2].replace('px', '')),
                offsetY: Number(match[3].replace('px', '')),
                blur: Number(match[4].replace('px', '')),
                spread: match[5] ? Number(match[5].replace('px', '')) : 0,
                color: match[6],
                visible: true,
            };
        }
    }
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

    // Image URL via getSdkImageUrl helper (handles backgroundImage, image object, src, url).
    const imgUrl = getSdkImageUrl(node);
    if (imgUrl) {
        fills.push({
            type: 'image',
            image: {
                src: imgUrl,
                alt: typeof node.backgroundImage === 'object' ? node.backgroundImage?.altText : undefined,
                data: typeof node.backgroundImage === 'object' ? node.backgroundImage?.data : undefined,
                mimeType: typeof node.backgroundImage === 'object' ? node.backgroundImage?.mimeType : undefined,
                objectFit: typeof node.backgroundImage === 'object' ? node.backgroundImage?.objectFit : undefined,
                objectPosition:
                    typeof node.backgroundImage === 'object' ? node.backgroundImage?.objectPosition : undefined,
            },
            visible: true,
        });
    }

    // Direct fills array if exposed by Framer SDK.
    if (Array.isArray(node.fills)) {
        for (const fillItem of node.fills) {
            if (fillItem.type === 'color' || fillItem.type === 'solid') {
                const f = solidFill(fillItem.color);
                if (f && !fills.some((existing) => existing.color === f.color)) fills.push(f);
            } else if (fillItem.type === 'gradient' && fillItem.gradient) {
                const g = gradientFill(fillItem.gradient);
                if (g) fills.push(g);
            } else if (fillItem.type === 'image') {
                const src =
                    typeof fillItem.image === 'string'
                        ? fillItem.image
                        : (fillItem.image?.url ?? fillItem.image?.src ?? fillItem.url);
                if (src && !fills.some((existing) => existing.type === 'image' && existing.image?.src === src)) {
                    fills.push({
                        type: 'image',
                        image: {
                            src,
                            data: typeof fillItem.image === 'object' ? fillItem.image?.data : undefined,
                            mimeType: typeof fillItem.image === 'object' ? fillItem.image?.mimeType : undefined,
                            objectFit: typeof fillItem.image === 'object' ? fillItem.image?.objectFit : undefined,
                            objectPosition:
                                typeof fillItem.image === 'object' ? fillItem.image?.objectPosition : undefined,
                        },
                        visible: true,
                    });
                }
            }
        }
    }

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

    // Shadows
    const shadows: FramerShadow[] = [];
    const shadowProp = node.shadows ?? node.shadow ?? node.boxShadow;
    if (Array.isArray(shadowProp)) {
        for (const s of shadowProp) {
            const parsed = parseShadowItem(s);
            if (parsed) shadows.push(parsed);
        }
    } else if (shadowProp) {
        const parsed = parseShadowItem(shadowProp);
        if (parsed) shadows.push(parsed);
    }
    if (shadows.length > 0) style.shadows = shadows;

    // Filters / Blur
    if (node.blur) {
        const blurValue = typeof node.blur === 'number' ? node.blur : (pxValue(String(node.blur)) ?? 0);
        if (blurValue > 0) {
            style.filters = [{ type: 'blur', value: blurValue }];
        }
    }

    if (node.opacity !== undefined) style.opacity = node.opacity;
    if (node.visible !== undefined) style.visible = node.visible;
    if (node.overflow) style.overflow = node.overflow as FramerStyle['overflow'];
    // Cursor is an arbitrary CSS string the SDK exposes verbatim. Forward
    // it to the AST so the generator can emit `cursor: <value>` inline.
    if (typeof node.cursor === 'string' && node.cursor.length > 0) {
        style.cursor = node.cursor;
    }
    // Image rendering hint (`auto`, `crisp-edges`, `pixelated`) — preserved
    // verbatim so the generator can emit `image-rendering: <value>`.
    if (typeof node.imageRendering === 'string' && node.imageRendering.length > 0) {
        style.imageRendering = node.imageRendering;
    }

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
