/**
 * Node → CSS declarations.
 *
 * Mirrors the source-model semantics the compiler parser reads (see
 * `@framer/compiler-parser`'s layout/style/typography converters) but
 * implements them as plain CSS with exact px — no Tailwind classes, no
 * Design AST. Sizing semantics are preserved: `fill` → 100%, `hug` →
 * fit-content, `fixed` → the frame's px value.
 */

import type {
    FramerFill,
    FramerImageRef,
    FramerNode,
    FramerResponsiveOverride,
    FramerTypography,
} from '@framer/compiler-parser';

import type { CssDeclaration } from './types';

/**
 * A node's effective style at one responsive tier: the base source layout +
 * style, with any overrides from `FramerResponsiveOverride` merged in.
 * Explicit override widths/heights and text-style overrides are kept
 * separate because the source type shapes don't share those fields.
 */
export interface EffectiveNodeStyle {
    layout: FramerNode['layout'];
    style: FramerNode['style'];
    /** fontSize / color / opacity overrides (applied as CSS declarations). */
    textStyle?: { fontSize?: number; color?: string; opacity?: number };
    /** Explicit width/height from a sizing override (px). */
    explicitWidth?: number;
    explicitHeight?: number;
    /** The alternate image src for this tier (a responsive image swap; '' removes it). */
    imageSrc?: string;
    /** The alternate object-fit for an image fill swap. */
    imageFit?: FramerImageRef['objectFit'];
    /** The alternate object-position for an image fill swap. */
    imagePosition?: string;
}

/** Merge a responsive override into a node's effective style for one tier. */
export function applyResponsiveOverride(
    node: FramerNode,
    override: FramerResponsiveOverride | undefined,
): EffectiveNodeStyle {
    const result: EffectiveNodeStyle = {
        layout: { ...(node.layout ?? {}) },
        style: { ...(node.style ?? {}) },
    };
    if (!override) return result;

    const layout = result.layout!;
    const style = result.style!;

    if (override.layout) {
        if (override.layout.direction)
            layout.direction = override.layout.direction as FramerNode['layout'] extends { direction?: infer D }
                ? D
                : never;
        if (override.layout.alignItems) layout.alignItems = override.layout.alignItems;
        if (override.layout.justifyContent) layout.justifyContent = override.layout.justifyContent;
        if (override.layout.gap !== undefined) layout.gap = override.layout.gap;
        if (override.layout.flexWrap) layout.flexWrap = override.layout.flexWrap;
    }
    if (override.sizing) {
        layout.sizing = { ...(layout.sizing ?? {}) };
        const s = override.sizing;
        if (s.widthMode) layout.sizing.widthMode = s.widthMode;
        if (s.heightMode) layout.sizing.heightMode = s.heightMode;
        if (s.minWidth !== undefined) layout.sizing.minWidth = s.minWidth;
        if (s.maxWidth !== undefined) layout.sizing.maxWidth = s.maxWidth;
        if (s.minHeight !== undefined) layout.sizing.minHeight = s.minHeight;
        if (s.maxHeight !== undefined) layout.sizing.maxHeight = s.maxHeight;
        if (s.aspectRatio !== undefined) layout.sizing.aspectRatio = s.aspectRatio;
        if (s.width !== undefined) result.explicitWidth = s.width;
        if (s.height !== undefined) result.explicitHeight = s.height;
    }
    if (override.spacing?.padding) {
        layout.padding = override.spacing.padding;
    }
    if (override.style) {
        result.textStyle = { ...(result.textStyle ?? {}) };
        if (override.style.fontSize !== undefined) result.textStyle.fontSize = override.style.fontSize;
        if (override.style.color !== undefined) result.textStyle.color = override.style.color;
        if (override.style.opacity !== undefined) result.textStyle.opacity = override.style.opacity;
    }
    if (override.visible !== undefined) {
        style.visible = override.visible;
    }
    if (override.image) {
        result.imageSrc = override.image.src;
        if (override.image.objectFit) result.imageFit = override.image.objectFit;
        if (override.image.objectPosition) result.imagePosition = override.image.objectPosition;
    }

    return result;
}

/** Compute the full CSS declaration list for a node (base tier). */
export function nodeCss(node: FramerNode): CssDeclaration[] {
    return nodeCssWithOverrides(node, undefined);
}

/** Compute CSS declarations for a node at one responsive tier. */
export function nodeCssWithOverrides(
    node: FramerNode,
    override: FramerResponsiveOverride | undefined,
): CssDeclaration[] {
    const effective = applyResponsiveOverride(node, override);
    const declarations: CssDeclaration[] = [];

    declarations.push(...boxDeclarations(node, effective));
    declarations.push(...layoutDeclarations(effective.layout));
    declarations.push(...positionDeclarations(effective.layout));
    declarations.push(...visualDeclarations(effective.style));

    // Standalone image nodes carry their object-fit exactly like the
    // generated project's `object-<fit>` Tailwind class (default `cover`).
    // Without it the <img> renders with the browser default (object-fit:
    // fill) and the base tier disagrees with the generated page. The
    // responsive image-swap section below still runs LAST, so a tier's
    // object-fit/position re-assertion wins over this base declaration.
    if (node.type === 'Image') {
        declarations.push({ property: 'object-fit', value: node.image?.objectFit ?? 'cover' });
        if (node.image?.objectPosition) {
            declarations.push({ property: 'object-position', value: node.image.objectPosition });
        }
    }

    // Typography first, then responsive text-style overrides LAST so the
    // tier's fontSize/color/opacity wins over the base typography.
    if (node.type === 'Text') declarations.push(...typographyCss(node.text?.style));
    declarations.push(...textStyleDeclarations(effective.textStyle));

    // Responsive image swap (folded from a replica's image override), LAST so
    // it wins over the base fill/background declarations — matching the
    // generated responsive.css. Standalone `<img>` nodes swap the SRC via the
    // `<picture><source media>` element in the markup (NOT CSS content: url(),
    // which would drop object-fit); a tier's object-fit/position change is
    // re-asserted here. Frames with an image fill swap the background layer
    // here (`src: ''` clears it).
    if (effective.imageSrc !== undefined || effective.imageFit !== undefined || effective.imagePosition !== undefined) {
        if (node.type === 'Image') {
            if (effective.imageFit) declarations.push({ property: 'object-fit', value: effective.imageFit });
            if (effective.imagePosition)
                declarations.push({ property: 'object-position', value: effective.imagePosition });
        } else {
            declarations.push({
                property: 'background-image',
                value: effective.imageSrc ? `url("${effective.imageSrc}")` : 'none',
            });
            if (effective.imageFit) {
                declarations.push({ property: 'background-size', value: imageFitSize(effective.imageFit) });
            }
            if (effective.imagePosition) {
                declarations.push({ property: 'background-position', value: effective.imagePosition });
            }
        }
    }

    return declarations;
}

/** CSS background-size for an object-fit value. */
function imageFitSize(fit: NonNullable<EffectiveNodeStyle['imageFit']>): string {
    switch (fit) {
        case 'fill':
            return '100% 100%';
        case 'contain':
            return 'contain';
        case 'cover':
            return 'cover';
        default:
            return 'auto';
    }
}

/** Width/height + padding from the frame and sizing semantics. */
function boxDeclarations(node: FramerNode, effective: EffectiveNodeStyle): CssDeclaration[] {
    const out: CssDeclaration[] = [];
    const sizing = effective.layout?.sizing;
    const widthMode = sizing?.widthMode ?? 'fixed';
    const heightMode = sizing?.heightMode ?? 'fixed';

    if (widthMode === 'fill') {
        out.push({ property: 'width', value: '100%' });
    } else if (widthMode === 'hug' || widthMode === 'auto') {
        out.push({ property: 'width', value: 'fit-content' });
    } else if (effective.explicitWidth !== undefined) {
        out.push({ property: 'width', value: px(effective.explicitWidth) });
    } else {
        out.push({ property: 'width', value: px(node.frame.width) });
    }

    if (heightMode === 'fill') {
        out.push({ property: 'height', value: '100%' });
    } else if (heightMode === 'hug' || heightMode === 'auto') {
        out.push({ property: 'height', value: 'auto' });
    } else if (effective.explicitHeight !== undefined) {
        out.push({ property: 'height', value: px(effective.explicitHeight) });
    } else {
        out.push({ property: 'height', value: px(node.frame.height) });
    }

    if (sizing?.minWidth !== undefined) out.push({ property: 'min-width', value: px(sizing.minWidth) });
    if (sizing?.maxWidth !== undefined) out.push({ property: 'max-width', value: px(sizing.maxWidth) });
    if (sizing?.minHeight !== undefined) out.push({ property: 'min-height', value: px(sizing.minHeight) });
    if (sizing?.maxHeight !== undefined) out.push({ property: 'max-height', value: px(sizing.maxHeight) });
    if (sizing?.aspectRatio !== undefined) out.push({ property: 'aspect-ratio', value: String(sizing.aspectRatio) });

    if (effective.layout?.padding) {
        const p = effective.layout.padding;
        out.push({
            property: 'padding',
            value: `${px(p.top)} ${px(p.right)} ${px(p.bottom)} ${px(p.left)}`,
        });
    }

    return out;
}

/** display / flex / grid rules. */
function layoutDeclarations(layout: FramerNode['layout']): CssDeclaration[] {
    const out: CssDeclaration[] = [];
    const strategy = layout?.strategy ?? 'auto';

    switch (strategy) {
        case 'flex':
        case 'stack': {
            out.push({ property: 'display', value: 'flex' });
            const direction = layout?.direction ?? (strategy === 'stack' ? 'column' : 'row');
            out.push({ property: 'flex-direction', value: direction });
            if (strategy === 'stack') {
                out.push({ property: 'align-items', value: 'center' });
            } else {
                out.push({ property: 'align-items', value: layout?.alignItems ?? 'flex-start' });
                out.push({ property: 'justify-content', value: layout?.justifyContent ?? 'flex-start' });
            }
            out.push({ property: 'flex-wrap', value: layout?.flexWrap ?? 'nowrap' });
            if (layout?.gap !== undefined) out.push({ property: 'gap', value: px(layout.gap) });
            break;
        }
        case 'grid': {
            out.push({ property: 'display', value: 'grid' });
            const columns = layout?.columns ?? 1;
            if (typeof columns === 'number') {
                const width = layout?.columnWidth;
                out.push({
                    property: 'grid-template-columns',
                    value: `repeat(${columns}, ${width !== undefined ? px(width) : '1fr'})`,
                });
            } else {
                out.push({ property: 'grid-template-columns', value: columns.join(' ') });
            }
            const rows = layout?.rows ?? 1;
            if (typeof rows === 'number') {
                const height = layout?.rowHeight;
                out.push({
                    property: 'grid-template-rows',
                    value: `repeat(${rows}, ${height !== undefined ? px(height) : 'auto'})`,
                });
            } else {
                out.push({ property: 'grid-template-rows', value: rows.join(' ') });
            }
            const columnGap = layout?.columnGap ?? 0;
            const rowGap = layout?.rowGap ?? 0;
            if (columnGap !== rowGap) {
                out.push({ property: 'column-gap', value: px(columnGap) });
                out.push({ property: 'row-gap', value: px(rowGap) });
            } else {
                out.push({ property: 'gap', value: px(columnGap) });
            }
            break;
        }
        case 'absolute':
            out.push({ property: 'display', value: 'block' });
            break;
        default:
            out.push({ property: 'display', value: 'block' });
            break;
    }

    return out;
}

/** position / offsets / z-index. */
function positionDeclarations(layout: FramerNode['layout']): CssDeclaration[] {
    const out: CssDeclaration[] = [];
    const mode = layout?.position ?? 'static';
    if (mode === 'absolute' || mode === 'relative' || mode === 'fixed' || mode === 'sticky') {
        out.push({ property: 'position', value: mode });
    }
    const offsets = layout?.offsets;
    if (offsets?.left !== undefined) out.push({ property: 'left', value: px(offsets.left) });
    if (offsets?.top !== undefined) out.push({ property: 'top', value: px(offsets.top) });
    if (offsets?.right !== undefined) out.push({ property: 'right', value: px(offsets.right) });
    if (offsets?.bottom !== undefined) out.push({ property: 'bottom', value: px(offsets.bottom) });
    if (layout?.zIndex !== undefined) out.push({ property: 'z-index', value: String(layout.zIndex) });
    return out;
}

/** fills / strokes / radius / shadow / opacity / filters / transform. */
function visualDeclarations(style: FramerNode['style']): CssDeclaration[] {
    const out: CssDeclaration[] = [];

    if (style?.visible === false) {
        out.push({ property: 'display', value: 'none' });
        return out;
    }

    if (style?.fills && style.fills.length > 0) {
        const visibleFills = style.fills.filter((f) => f.visible !== false);
        if (visibleFills.length > 0) {
            const layers = visibleFills.map(fillLayer);
            out.push({ property: 'background', value: layers.join(', ') });
        }
    }

    if (style?.strokes && style.strokes.length > 0) {
        const stroke = style.strokes.find((s) => s.visible !== false);
        if (stroke) {
            const color = fillColor(stroke.fill);
            if (color) {
                out.push({ property: 'border', value: `${px(stroke.width)} solid ${color}` });
            }
        }
    }

    if (style?.radius !== undefined) {
        const r = style.radius;
        if (typeof r === 'number') {
            out.push({ property: 'border-radius', value: px(r) });
        } else {
            out.push({
                property: 'border-radius',
                value: `${px(r.topLeft)} ${px(r.topRight)} ${px(r.bottomRight)} ${px(r.bottomLeft)}`,
            });
        }
    }

    if (style?.shadows && style.shadows.length > 0) {
        const shadows = style.shadows
            .filter((s) => s.visible !== false)
            .map(
                (s) =>
                    `${s.inset ? 'inset ' : ''}${px(s.offsetX)} ${px(s.offsetY)} ${px(s.blur)} ${px(s.spread)} ${s.color}`,
            );
        if (shadows.length > 0) out.push({ property: 'box-shadow', value: shadows.join(', ') });
    }

    if (style?.opacity !== undefined) out.push({ property: 'opacity', value: String(style.opacity) });
    if (style?.overflow) out.push({ property: 'overflow', value: style.overflow });
    if (style?.cursor) out.push({ property: 'cursor', value: style.cursor });
    if (style?.imageRendering) out.push({ property: 'image-rendering', value: style.imageRendering });

    if (style?.transform) {
        const t = style.transform;
        const parts: string[] = [];
        if (t.rotate !== undefined) parts.push(`rotate(${t.rotate}deg)`);
        if (t.scaleX !== undefined || t.scaleY !== undefined) {
            parts.push(`scale(${t.scaleX ?? 1}, ${t.scaleY ?? 1})`);
        }
        if (t.skewX !== undefined || t.skewY !== undefined) {
            parts.push(`skew(${t.skewX ?? 0}deg, ${t.skewY ?? 0}deg)`);
        }
        if (t.translateX !== undefined || t.translateY !== undefined) {
            parts.push(`translate(${px(t.translateX ?? 0)}, ${px(t.translateY ?? 0)})`);
        }
        if (parts.length > 0) out.push({ property: 'transform', value: parts.join(' ') });
    }

    if (style?.filters && style.filters.length > 0) {
        const filters = style.filters
            .map((f) => {
                switch (f.type) {
                    case 'blur':
                        return `blur(${px(f.value)})`;
                    case 'brightness':
                        return `brightness(${f.value})`;
                    case 'contrast':
                        return `contrast(${f.value})`;
                    case 'grayscale':
                        return `grayscale(${f.value})`;
                    case 'hue-rotate':
                        return `hue-rotate(${f.value}deg)`;
                    case 'invert':
                        return `invert(${f.value})`;
                    case 'saturate':
                        return `saturate(${f.value})`;
                    case 'sepia':
                        return `sepia(${f.value})`;
                    default:
                        return null;
                }
            })
            .filter((f): f is string => f !== null);
        if (filters.length > 0) out.push({ property: 'filter', value: filters.join(' ') });
    }

    return out;
}

/** Responsive text-style overrides (fontSize/color/opacity at a tier). */
function textStyleDeclarations(textStyle: EffectiveNodeStyle['textStyle']): CssDeclaration[] {
    const out: CssDeclaration[] = [];
    if (!textStyle) return out;
    if (textStyle.fontSize !== undefined) out.push({ property: 'font-size', value: px(textStyle.fontSize) });
    if (textStyle.color !== undefined) out.push({ property: 'color', value: textStyle.color });
    if (textStyle.opacity !== undefined) out.push({ property: 'opacity', value: String(textStyle.opacity) });
    return out;
}

/** Typography → CSS declarations (exact values, em for letter-spacing). */
export function typographyCss(typography?: FramerTypography): CssDeclaration[] {
    const out: CssDeclaration[] = [];
    if (!typography) return out;

    if (typography.fontFamily) {
        out.push({ property: 'font-family', value: `'${typography.fontFamily}', system-ui, sans-serif` });
    }
    if (typography.fontSize !== undefined) out.push({ property: 'font-size', value: px(typography.fontSize) });
    if (typography.fontWeight !== undefined)
        out.push({ property: 'font-weight', value: String(typography.fontWeight) });
    if (typography.lineHeight !== undefined)
        out.push({ property: 'line-height', value: String(typography.lineHeight) });
    if (typography.letterSpacing !== undefined) {
        out.push({ property: 'letter-spacing', value: `${typography.letterSpacing}em` });
    }
    if (typography.color) out.push({ property: 'color', value: typography.color });
    if (typography.textAlign) out.push({ property: 'text-align', value: typography.textAlign });
    if (typography.textTransform) out.push({ property: 'text-transform', value: typography.textTransform });
    if (typography.textDecoration) out.push({ property: 'text-decoration', value: typography.textDecoration });
    if (typography.italic) out.push({ property: 'font-style', value: 'italic' });
    if (typography.underline) out.push({ property: 'text-decoration', value: 'underline' });
    if (typography.strikethrough) out.push({ property: 'text-decoration', value: 'line-through' });
    if (typography.whiteSpace) out.push({ property: 'white-space', value: typography.whiteSpace });
    if (typography.textOverflow) out.push({ property: 'text-overflow', value: typography.textOverflow });
    if (typography.verticalAlign) out.push({ property: 'vertical-align', value: typography.verticalAlign });

    return out;
}

/** A single fill as a CSS background layer. */
function fillLayer(fill: FramerFill): string {
    switch (fill.type) {
        case 'solid':
            return fill.color ?? 'transparent';
        case 'linear': {
            const g = fill.gradient;
            if (!g) return 'transparent';
            const angle = g.angle ?? 0;
            return `linear-gradient(${angle}deg, ${gradientStops(g.stops)})`;
        }
        case 'radial': {
            const g = fill.gradient;
            if (!g) return 'transparent';
            const cx = Math.round((g.center?.x ?? 0.5) * 100);
            const cy = Math.round((g.center?.y ?? 0.5) * 100);
            return `radial-gradient(circle at ${cx}% ${cy}%, ${gradientStops(g.stops)})`;
        }
        case 'image':
            if (fill.image?.src) {
                return `url("${fill.image.src}") center / cover no-repeat`;
            }
            return 'transparent';
        default:
            return 'transparent';
    }
}

function gradientStops(stops: Array<{ position: number; color: string }>): string {
    return stops.map((s) => `${s.color} ${Math.round(s.position * 100)}%`).join(', ');
}

function fillColor(fill: FramerFill): string | undefined {
    if (fill.visible === false) return undefined;
    if (fill.type === 'solid') return fill.color;
    return undefined;
}

/** Format a number as a px length, dropping trailing zeros. */
export function px(value: number): string {
    const rounded = Math.round(value * 1000) / 1000;
    return `${rounded}px`;
}

/** Format a set of declarations as one CSS rule block body. */
export function formatDeclarations(declarations: CssDeclaration[]): string {
    return declarations.map((d) => `    ${d.property}: ${d.value};`).join('\n');
}
