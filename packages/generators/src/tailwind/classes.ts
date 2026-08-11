/**
 * Design AST style → Tailwind class generation.
 *
 * Classes prefer standard Tailwind values (palette colors, default scales) and
 * generated design tokens over arbitrary values, so the output reads like a
 * hand-built design system: `bg-slate-900` and `py-15` instead of
 * `bg-[#0f172a]` and `py-[60px]`.
 */

import type { DesignNode, FlexLayout } from '@framer/compiler-ast';
import {
    DEFAULT_RADIUS,
    DEFAULT_SPACING_SCALE,
    isZero,
    normalizeColor,
    pxToTailwindSpacing,
} from '@framer/compiler-shared';

import { matchPalette } from './palette';
import { responsiveClassName } from '../responsive/css';
import type { DesignTokens } from './tokens';

/** Generate Tailwind classes for a node's layout and style. */
export function generateClasses(node: DesignNode, tokens?: DesignTokens): string[] {
    const classes = new Set<string>();

    // Layout classes
    const layoutClasses = generateLayoutClasses(node, tokens);
    layoutClasses.forEach((c) => classes.add(c));

    // Style classes
    const styleClasses = generateStyleClasses(node, tokens);
    styleClasses.forEach((c) => classes.add(c));

    // Typography classes
    if (node.type === 'text') {
        const typographyClasses = generateTypographyClasses(node, tokens);
        typographyClasses.forEach((c) => classes.add(c));
    }

    // Responsive behavior class (media-query overrides live in responsive.css)
    const responsiveClass = responsiveClassName(node);
    if (responsiveClass) classes.add(responsiveClass);

    return Array.from(classes);
}

/** Generate layout-related Tailwind classes. */
export function generateLayoutClasses(node: DesignNode, tokens?: DesignTokens): string[] {
    const classes: string[] = [];
    const layout = node.layout;
    const styleProps = propDrivenStyles(node);

    // Sizing
    const { widthMode, heightMode } = layout.sizing;
    if (widthMode === 'fill') classes.push('w-full');
    else if (widthMode === 'hug') classes.push('w-fit');
    else if (widthMode === 'fixed' && !isZero(node.frame.width) && !styleProps.width) {
        classes.push(sizeClass('w', node.frame.width, tokens));
    }
    if (heightMode === 'fill') classes.push('h-full');
    else if (heightMode === 'hug') classes.push('h-fit');
    else if (heightMode === 'fixed' && !isZero(node.frame.height) && !styleProps.height) {
        classes.push(sizeClass('h', node.frame.height, tokens));
    }

    // Sizing constraints — the classic "fill but cap at X" pattern (fill +
    // max-width) and min/aspect sizing must survive into the output or the
    // layout collapses. Exact px arbitrary values, never bucketed.
    const sizing = layout.sizing;
    if (sizing.minWidth !== undefined) classes.push(`min-w-[${formatExact(sizing.minWidth)}px]`);
    if (sizing.maxWidth !== undefined) classes.push(`max-w-[${formatExact(sizing.maxWidth)}px]`);
    if (sizing.minHeight !== undefined) classes.push(`min-h-[${formatExact(sizing.minHeight)}px]`);
    if (sizing.maxHeight !== undefined) classes.push(`max-h-[${formatExact(sizing.maxHeight)}px]`);
    if (sizing.aspectRatio !== undefined) classes.push(`aspect-[${formatExact(sizing.aspectRatio)}]`);

    // Positioning
    const position = layout.position;
    if (position.mode === 'absolute') classes.push('absolute');
    else if (position.mode === 'relative') classes.push('relative');
    else if (position.mode === 'fixed') classes.push('fixed');
    else if (position.mode === 'sticky') classes.push('sticky');
    else if (node.children.some((child) => child.layout.position.mode === 'absolute')) {
        // A static container with absolutely positioned children must become
        // their positioning context — otherwise they anchor to the nearest
        // positioned ancestor (often the page) and the design collapses.
        classes.push('relative');
    }
    if (position.zIndex !== undefined && position.zIndex !== 0) {
        classes.push(zIndexClass(position.zIndex));
    }

    // Offsets — exact px (negative values render as left-[-12px]); zero as left-0.
    const offsets: Array<[string, number | undefined]> = [
        ['left', position.left],
        ['top', position.top],
        ['right', position.right],
        ['bottom', position.bottom],
    ];
    for (const [prop, value] of offsets) {
        if (value === undefined) continue;
        classes.push(isZero(value) ? `${prop}-0` : `${prop}-[${formatExact(value)}px]`);
    }

    // Spacing
    const padding = layout.spacing.padding;
    if (padding) {
        if (padding.top === padding.right && padding.right === padding.bottom && padding.bottom === padding.left) {
            if (!isZero(padding.top)) classes.push(`p-${spacingSuffix(padding.top, tokens)}`);
        } else if (padding.top === padding.bottom && padding.right === padding.left) {
            if (!isZero(padding.top)) classes.push(`py-${spacingSuffix(padding.top, tokens)}`);
            if (!isZero(padding.right)) classes.push(`px-${spacingSuffix(padding.right, tokens)}`);
        } else {
            if (!isZero(padding.top)) classes.push(`pt-${spacingSuffix(padding.top, tokens)}`);
            if (!isZero(padding.right)) classes.push(`pr-${spacingSuffix(padding.right, tokens)}`);
            if (!isZero(padding.bottom)) classes.push(`pb-${spacingSuffix(padding.bottom, tokens)}`);
            if (!isZero(padding.left)) classes.push(`pl-${spacingSuffix(padding.left, tokens)}`);
        }
    }

    // Flex layout
    if (layout.style.strategy === 'flex') {
        const flex = layout.style as FlexLayout;
        classes.push('flex');
        if (flex.direction === 'row') classes.push('flex-row');
        else if (flex.direction === 'column') classes.push('flex-col');
        else if (flex.direction === 'row-reverse') classes.push('flex-row-reverse');
        else if (flex.direction === 'column-reverse') classes.push('flex-col-reverse');

        if (flex.alignItems !== undefined) classes.push(`items-${mapAlignItems(flex.alignItems)}`);
        if (flex.justifyContent !== undefined) classes.push(`justify-${mapJustifyContent(flex.justifyContent)}`);

        if (flex.flexWrap === 'wrap') classes.push('flex-wrap');
        else if (flex.flexWrap === 'wrap-reverse') classes.push('flex-wrap-reverse');

        if (typeof flex.gap === 'number' && !isZero(flex.gap)) classes.push(`gap-${spacingSuffix(flex.gap, tokens)}`);
    }

    // Grid layout
    if (layout.style.strategy === 'grid') {
        classes.push('grid');
        const grid = layout.style;
        if (typeof grid.columns === 'number') {
            classes.push(`grid-cols-${grid.columns}`);
        }
        if (typeof grid.rows === 'number') {
            classes.push(`grid-rows-${grid.rows}`);
        }
        if (!isZero(grid.columnGap)) classes.push(`gap-x-${spacingSuffix(grid.columnGap, tokens)}`);
        if (!isZero(grid.rowGap)) classes.push(`gap-y-${spacingSuffix(grid.rowGap, tokens)}`);
    }

    return classes;
}

/** Generate style-related Tailwind classes. */
export function generateStyleClasses(node: DesignNode, tokens?: DesignTokens): string[] {
    const classes: string[] = [];
    const style = node.style;
    const styleProps = propDrivenStyles(node);

    if (style.visible === false) classes.push('hidden');

    if (style.opacity !== undefined && style.opacity < 1 && !styleProps.opacity) {
        classes.push(opacityClass(style.opacity));
    }

    // Fills
    if (style.fills && style.fills.length > 0 && !styleProps.backgroundColor) {
        const fill = style.fills[0];
        if (fill.type === 'solid') {
            classes.push(bgColorClass(fill.color, tokens));
        }
    }

    // Strokes / border
    if (style.strokes && style.strokes.length > 0) {
        const stroke = style.strokes[0];
        classes.push('border');
        const width = borderWidthToTailwind(stroke.width);
        if (width && !styleProps.borderWidth) classes.push(`border-${width}`);
        if (stroke.fill.type === 'solid' && !styleProps.borderColor) {
            classes.push(borderColorClass(stroke.fill.color, tokens));
        }
    }

    // Radius (a plain number is a uniform radius)
    if (style.radius && !styleProps.radius) {
        const corners = typeof style.radius === 'number'
            ? { topLeft: style.radius, topRight: style.radius, bottomRight: style.radius, bottomLeft: style.radius }
            : style.radius;
        const { topLeft, topRight, bottomRight, bottomLeft } = corners;
        if (topLeft === topRight && topRight === bottomRight && bottomRight === bottomLeft) {
            const suffix = radiusToTailwind(topLeft, tokens);
            if (!isZero(topLeft)) classes.push(suffix ? `rounded-${suffix}` : 'rounded');
        } else {
            if (!isZero(topLeft)) classes.push(radiusClass('rounded-tl', topLeft, tokens));
            if (!isZero(topRight)) classes.push(radiusClass('rounded-tr', topRight, tokens));
            if (!isZero(bottomRight)) classes.push(radiusClass('rounded-br', bottomRight, tokens));
            if (!isZero(bottomLeft)) classes.push(radiusClass('rounded-bl', bottomLeft, tokens));
        }
    }

    // Shadows
    if (style.shadows && style.shadows.length > 0) {
        classes.push('shadow');
    }

    // Overflow
    if (style.overflow === 'hidden') classes.push('overflow-hidden');
    if (style.overflow === 'scroll') classes.push('overflow-scroll');
    if (style.overflow === 'auto') classes.push('overflow-auto');

    return classes;
}

/** Generate typography-related Tailwind classes for text nodes. */
export function generateTypographyClasses(node: DesignNode, tokens?: DesignTokens): string[] {
    if (node.type !== 'text') return [];

    const classes: string[] = [];
    const typography = node.text.style;
    const styleProps = propDrivenStyles(node);

    if (typography.fontSize !== undefined) {
        classes.push(`text-${fontSizeToTailwind(typography.fontSize)}`);
    }

    if (typography.fontWeight !== undefined) {
        const weight = typeof typography.fontWeight === 'number' ? typography.fontWeight : fontWeightToNumber(typography.fontWeight);
        if (weight !== 400) classes.push(`font-${weightToName(weight)}`);
    }

    if (typography.color && !styleProps.color) {
        classes.push(textColorClass(typography.color, tokens));
    }

    if (typography.textAlign && typography.textAlign !== 'left') {
        classes.push(`text-${typography.textAlign}`);
    }

    if (typography.letterSpacing !== undefined && !isZero(typography.letterSpacing)) {
        classes.push(`tracking-${trackingToTailwind(typography.letterSpacing)}`);
    }

    if (typography.lineHeight !== undefined) {
        classes.push(`leading-${lineHeightToTailwind(typography.lineHeight)}`);
    }

    if (typography.italic) classes.push('italic');
    if (typography.underline) classes.push('underline');
    if (typography.strikethrough) classes.push('line-through');
    if (typography.textTransform === 'uppercase') classes.push('uppercase');
    if (typography.textTransform === 'capitalize') classes.push('capitalize');
    if (typography.textTransform === 'lowercase') classes.push('lowercase');

    return classes;
}

/** The style fields of a node that are driven by props (from the extraction pass). */
function propDrivenStyles(node: DesignNode): Record<string, boolean> {
    const styleProps = node.metadata?.custom?.styleProps;
    if (!styleProps || typeof styleProps !== 'object') return {};
    const flags: Record<string, boolean> = {};
    for (const key of Object.keys(styleProps)) {
        flags[key] = true;
    }
    return flags;
}

/** Map an alignItems value to a Tailwind class suffix. */
function mapAlignItems(value: FlexLayout['alignItems']): string {
    switch (value) {
        case 'flex-start': return 'start';
        case 'flex-end': return 'end';
        default: return value;
    }
}

/** Map a justifyContent value to a Tailwind class suffix. */
function mapJustifyContent(value: FlexLayout['justifyContent']): string {
    switch (value) {
        case 'flex-start': return 'start';
        case 'flex-end': return 'end';
        case 'space-between': return 'between';
        case 'space-around': return 'around';
        case 'space-evenly': return 'evenly';
        default: return value;
    }
}

/** Map an opacity value (0-1) to a valid Tailwind opacity class. */
function opacityClass(opacity: number): string {
    const percent = Math.round(opacity * 100);
    if (percent % 5 === 0 && percent > 0 && percent < 100) {
        return `opacity-${percent}`;
    }
    return `opacity-[${opacity}]`;
}

/** Map a z-index to a valid Tailwind z class. */
function zIndexClass(zIndex: number): string {
    if ([10, 20, 30, 40, 50].includes(zIndex)) {
        return `z-${zIndex}`;
    }
    return `z-[${zIndex}]`;
}

/** Convert a color to a Tailwind background class, preferring palette/token names. */
function bgColorClass(color: string, tokens?: DesignTokens): string {
    const name = colorClassName(color, tokens);
    return name ? `bg-${name}` : `bg-[${normalizeColor(color)}]`;
}

/** Convert a color to a Tailwind text color class, preferring palette/token names. */
function textColorClass(color: string, tokens?: DesignTokens): string {
    const name = colorClassName(color, tokens);
    return name ? `text-${name}` : `text-[${normalizeColor(color)}]`;
}

/** Convert a color to a Tailwind border color class, preferring palette/token names. */
function borderColorClass(color: string, tokens?: DesignTokens): string {
    const name = colorClassName(color, tokens);
    return name ? `border-${name}` : `border-[${normalizeColor(color)}]`;
}

/**
 * Resolve a color to a named Tailwind class suffix: a palette color
 * (`slate-900`) or a generated token (`color-1`); undefined → arbitrary value.
 */
function colorClassName(color: string, tokens?: DesignTokens): string | undefined {
    const palette = matchPalette(color);
    if (palette) return palette;
    const normalized = normalizeColor(color);
    return tokens ? Object.entries(tokens.colors).find(([, value]) => value === normalized)?.[0] : undefined;
}

/**
 * Map a border width to a Tailwind-compatible suffix ('' = default 1px).
 *
 * Only exact Tailwind scale values map to bare classes; everything else uses
 * an exact arbitrary value — a 1.5px border must stay 1.5px, not round to 1px.
 */
function borderWidthToTailwind(width: number): string {
    if (width === 0) return '0';
    if (width === 1) return '';
    if (width === 2 || width === 4 || width === 8) return String(width);
    return `[${formatExact(width)}px]`;
}

/** Build a radius class, handling the Tailwind default (no suffix). */
function radiusClass(prefix: string, radius: number, tokens?: DesignTokens): string {
    const suffix = radiusToTailwind(radius, tokens);
    return suffix ? `${prefix}-${suffix}` : prefix;
}

/**
 * Convert a radius value to a Tailwind radius suffix: a default-scale name
 * (`xl`), a generated token key (`20`), or an arbitrary value (`[10px]`).
 * Derived from DEFAULT_RADIUS so the emitter can never drift from the
 * token collector's notion of "default".
 */
function radiusToTailwind(radius: number, tokens?: DesignTokens): string {
    if (radius >= 9999) return 'full';
    const name = Object.entries(DEFAULT_RADIUS).find(([, value]) => value === radius)?.[0];
    if (name !== undefined) return name === 'DEFAULT' ? '' : name;
    if (Number.isInteger(radius) && tokens?.radii[String(radius)] !== undefined) return String(radius);
    return `[${radius}px]`;
}

/**
 * Convert a pixel value to a Tailwind spacing suffix: a default-scale key
 * (`4`), a generated token key (`15`), or an arbitrary value (`[60px]`).
 */
function spacingSuffix(value: number, tokens?: DesignTokens): string {
    const unit = pxToTailwindSpacing(value);
    if (unit === 0) return '0';
    if (Number.isInteger(unit) && DEFAULT_SPACING_SCALE[unit] !== undefined) return String(unit);
    if (Number.isInteger(unit) && tokens?.spacing[String(unit)] !== undefined) return String(unit);
    return `[${formatExact(value)}px]`;
}

/** Convert a pixel size to a Tailwind size class (w-/h-), token-aware. */
function sizeClass(prefix: string, value: number, tokens?: DesignTokens): string {
    const suffix = spacingSuffix(value, tokens);
    return `${prefix}-${suffix}`;
}

/** Format a number without unnecessary rounding (keeps up to 3 decimals). */
function formatExact(value: number): string {
    return String(Math.round(value * 1000) / 1000);
}

/** Convert a font size to a Tailwind size suffix. */
function fontSizeToTailwind(size: number): string {
    if (size === 12) return 'xs';
    if (size === 14) return 'sm';
    if (size === 16) return 'base';
    if (size === 18) return 'lg';
    if (size === 20) return 'xl';
    if (size === 24) return '2xl';
    if (size === 30) return '3xl';
    if (size === 36) return '4xl';
    if (size === 48) return '5xl';
    if (size === 60) return '6xl';
    if (size === 72) return '7xl';
    return `[${size}px]`;
}

/** Convert a font weight name to a number. */
function fontWeightToNumber(weight: string): number {
    switch (weight) {
        case 'normal': return 400;
        case 'bold': return 700;
        case 'lighter': return 300;
        case 'bolder': return 800;
        default: return 400;
    }
}

/** Convert a font weight number to a Tailwind weight name. */
function weightToName(weight: number): string {
    switch (weight) {
        case 100: return 'thin';
        case 200: return 'extralight';
        case 300: return 'light';
        case 400: return 'normal';
        case 500: return 'medium';
        case 600: return 'semibold';
        case 700: return 'bold';
        case 800: return 'extrabold';
        case 900: return 'black';
        default: return 'normal';
    }
}

/**
 * Convert a letter spacing value to a Tailwind tracking suffix.
 *
 * Tailwind's tracking classes are exact em values (wide = 0.025em, widest =
 * 0.1em). A value only maps to a class when it matches exactly; anything else
 * becomes an exact arbitrary value, so 0.03em never silently renders as
 * 0.025em.
 */
function trackingToTailwind(value: number): string {
    if (value === -0.05) return 'tighter';
    if (value === -0.025) return 'tight';
    if (value === 0) return 'normal';
    if (value === 0.025) return 'wide';
    if (value === 0.05) return 'wider';
    if (value === 0.1) return 'widest';
    return `[${formatExact(value)}em]`;
}

/**
 * Convert a line height to a Tailwind leading suffix.
 *
 * Same exactness rule as tracking: bare classes only for exact scale matches,
 * otherwise an exact arbitrary value (1.1 stays 1.1, not leading-tight 1.25).
 */
function lineHeightToTailwind(value: number): string {
    if (value === 1) return 'none';
    if (value === 1.25) return 'tight';
    if (value === 1.375) return 'snug';
    if (value === 1.5) return 'normal';
    if (value === 1.625) return 'relaxed';
    if (value === 2) return 'loose';
    return `[${formatExact(value)}]`;
}
