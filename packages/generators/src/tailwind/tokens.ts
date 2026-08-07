/**
 * Design-token extraction.
 *
 * Walks the compiled document (sections + extracted component templates +
 * variant member nodes) and collects the static colors, radii, and spacing
 * that the class generator actually emits, into a token set that is:
 *
 *   - wired into the Tailwind theme (`theme.extend`), and
 *   - preferred by the class generator over arbitrary values.
 *
 * Only values NOT covered by the Tailwind defaults need a theme entry:
 * palette-recognized colors map to standard classes (`bg-slate-900`) and
 * default-scale radii/spacing map to bare keys (`rounded-xl`, `gap-4`).
 * Everything else becomes a token: colors are named `color1`, `color2`, …
 * (first-seen order — deterministic); radii and spacing use their numeric
 * scale keys (`rounded-20`, `py-15`, `w-95`).
 *
 * Prop-driven style fields (from the extraction pass) are excluded from the
 * theme — their values are rendered inline from props, not as static classes —
 * but they still receive a module name so instance props can reference them
 * (`accent={colors.color1}`) via the generated `src/tokens.ts` module.
 */

import type { DesignDocument, DesignNode } from '@framer/compiler-ast';
import { DEFAULT_RADIUS, DEFAULT_SPACING_SCALE, isZero, normalizeColor, pxToTailwindSpacing } from '@framer/compiler-shared';
import type { VirtualFile } from '../types';

import { matchPalette } from './palette';

/** The design tokens extracted from a document. */
export interface DesignTokens {
    /** Non-palette colors: token name → CSS color string (hex or rgba). */
    colors: Record<string, string>;
    /** Non-default radii: px key → px value (emitted as `rounded-<key>`). */
    radii: Record<string, number>;
    /** Non-default spacing/sizes: unit key → px value (emitted as `p-<key>`, `w-<key>`, …). */
    spacing: Record<string, number>;
    /**
     * Every emitted color (palette, theme token, or prop-driven): normalized
     * CSS color → module name (`emerald500`, `slate900`, `color1`). Powers the
     * generated `src/tokens.ts` module referenced by instance props.
     */
    colorNames: Record<string, string>;
    /** Radius module tokens: px key → value (theme tokens ∪ radius prop values). */
    radiusValues: Record<string, number>;
    /** Spacing module tokens: unit key → px value (theme tokens ∪ length prop values). */
    spacingValues: Record<string, number>;
}

/** The style-slot fields whose values are colors (rendered from props). */
export const COLOR_STYLE_FIELDS: ReadonlySet<string> = new Set(['backgroundColor', 'borderColor', 'color']);

/** The style-slot fields whose values are numeric lengths (rendered from props). */
export const NUMERIC_TOKEN_FIELDS: ReadonlySet<string> = new Set(['radius', 'width', 'height']);

/** Numeric style-slot field → its tokens-module object (`radii` or `spacing`). */
export const NUMERIC_TOKEN_MODULES: Record<string, 'radii' | 'spacing'> = {
    radius: 'radii',
    width: 'spacing',
    height: 'spacing',
};

/** The instance prop names that carry color values (from template styleProps). */
export function collectTemplateColorProps(template: DesignNode | undefined): Set<string> {
    const names = new Set<string>();
    if (!template) return names;
    const visit = (node: DesignNode): void => {
        const styleProps = node.metadata?.custom?.styleProps;
        if (styleProps && typeof styleProps === 'object') {
            for (const [field, propName] of Object.entries(styleProps)) {
                if (COLOR_STYLE_FIELDS.has(field) && typeof propName === 'string') names.add(propName);
            }
        }
        for (const child of node.children) {
            visit(child);
        }
    };
    visit(template);
    return names;
}

/** The instance prop names carrying gradient values (from template styleProps). */
export function collectTemplateGradientProps(template: DesignNode | undefined): Set<string> {
    const names = new Set<string>();
    if (!template) return names;
    const visit = (node: DesignNode): void => {
        const styleProps = node.metadata?.custom?.styleProps;
        if (styleProps && typeof styleProps === 'object') {
            for (const [field, propName] of Object.entries(styleProps)) {
                if (field === 'gradient' && typeof propName === 'string') names.add(propName);
            }
        }
        for (const child of node.children) {
            visit(child);
        }
    };
    visit(template);
    return names;
}

/** The instance prop names carrying numeric lengths (propName → style-slot field). */
export function collectTemplateNumericProps(template: DesignNode | undefined): Map<string, string> {
    const names = new Map<string, string>();
    if (!template) return names;
    const visit = (node: DesignNode): void => {
        const styleProps = node.metadata?.custom?.styleProps;
        if (styleProps && typeof styleProps === 'object') {
            for (const [field, propName] of Object.entries(styleProps)) {
                if (NUMERIC_TOKEN_FIELDS.has(field) && typeof propName === 'string') names.set(propName, field);
            }
        }
        for (const child of node.children) {
            visit(child);
        }
    };
    visit(template);
    return names;
}

/**
 * Visit every node whose styles are actually rendered into the project.
 *
 * Template-bearing component instances render `<Name …/>`, so their bodies
 * come from the (deduplicated) template; non-template nodes are visited
 * directly with their children. Use this to walk the emitted tree exactly.
 */
export function walkEmittedTrees(document: DesignDocument, visitor: (node: DesignNode) => void): void {
    const visitedTemplates = new Set<DesignNode>();
    const visit = (node: DesignNode): void => {
        if (node.type === 'component' && node.template) {
            if (!visitedTemplates.has(node.template)) {
                visitedTemplates.add(node.template);
                visit(node.template);
            }
            return;
        }
        visitor(node);
        for (const child of node.children) {
            visit(child);
        }
    };
    for (const root of document.nodes) {
        visit(root);
    }
}

/** Collect the design tokens used by a compiled document. */
export function extractTokens(document: DesignDocument): DesignTokens {
    const tokens: DesignTokens = { colors: {}, radii: {}, spacing: {}, colorNames: {}, radiusValues: {}, spacingValues: {} };
    const colorNames = new Map<string, string>();
    const radiusKeys = new Set<string>();
    const spacingKeys = new Set<string>();
    let colorIndex = 0;

    /** The style-prop markers on a node (fields driven by props are not static). */
    const styleProps = (node: DesignNode): Record<string, unknown> | undefined => {
        const value = node.metadata?.custom?.styleProps;
        return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
    };

    /** The module name for a normalized color: sanitized palette name or `colorN`. */
    const addColorName = (normalized: string): string => {
        let name = colorNames.get(normalized);
        if (name === undefined) {
            const palette = matchPalette(normalized);
            name = palette ? palette.replace(/[^a-zA-Z0-9]/g, '') : `color${(colorIndex += 1)}`;
            colorNames.set(normalized, name);
            tokens.colorNames[normalized] = name;
        }
        return name;
    };

    /** Register a static color (theme token only for non-palette, non-prop-driven). */
    const addColor = (color: string, node: DesignNode, field: string): void => {
        const normalized = normalizeColor(color);
        const name = addColorName(normalized);
        if (styleProps(node)?.[field]) return;
        if (matchPalette(normalized)) return;
        if (tokens.colors[name] === undefined) tokens.colors[name] = normalized;
    };

    /** Register a uniform corner radius (only integer, non-default values). */
    const addRadius = (radius: number): void => {
        if (!Number.isInteger(radius) || Object.values(DEFAULT_RADIUS).includes(radius)) return;
        const key = String(radius);
        if (!radiusKeys.has(key)) {
            radiusKeys.add(key);
            tokens.radii[key] = radius;
        }
    };

    /** Register a spacing/size value (only integer units off the default scale). */
    const addSpacing = (value: number): void => {
        const unit = pxToTailwindSpacing(value);
        if (!Number.isInteger(unit) || DEFAULT_SPACING_SCALE[unit] !== undefined) return;
        const key = String(unit);
        if (!spacingKeys.has(key)) {
            spacingKeys.add(key);
            tokens.spacing[key] = value;
        }
    };

    /** Register a module radius token (any value — also default-scale). */
    const addRadiusValue = (value: number): void => {
        const key = String(value);
        if (tokens.radiusValues[key] === undefined) tokens.radiusValues[key] = value;
    };

    /** Register a module spacing token keyed by its unit (integer or fractional). */
    const addSpacingValue = (value: number): void => {
        const key = String(pxToTailwindSpacing(value));
        if (tokens.spacingValues[key] === undefined) tokens.spacingValues[key] = value;
    };

    /** Collect the static style values of a single emitted node. */
    const collectNode = (node: DesignNode): void => {
        const style = node.style;
        const sProps = styleProps(node);

        // Colors — mirror the class generator: only the first fill/stroke render.
        const fill = style.fills?.[0];
        if (fill?.type === 'solid') {
            addColor(fill.color, node, 'backgroundColor');
        } else if (fill && !sProps?.gradient) {
            // Gradient fills render as inline backgrounds with token refs
            // (`background: \`linear-gradient(135deg, ${colors.indigo500} …)\``).
            // Their stop colors get module names but never theme entries — no
            // Tailwind class renders a gradient, so no theme token is needed.
            // Only gradient FILLS are handled here: gradient border strokes
            // (non-solid stroke fills) remain unrendered, matching the class
            // generator's solid-stroke-only boundary. Prop-driven gradients
            // are skipped — their values live in instance props instead.
            for (const stop of fill.stops) addColorName(normalizeColor(stop.color));
        }
        const stroke = style.strokes?.[0];
        if (stroke && stroke.fill.type === 'solid') addColor(stroke.fill.color, node, 'borderColor');
        if (node.type === 'text' && node.text.style.color) addColor(node.text.style.color, node, 'color');

        // Radius (a plain number is a uniform radius)
        const radius = style.radius;
        if (radius && !sProps?.radius) {
            const corners = typeof radius === 'number'
                ? { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius }
                : radius;
            const { topLeft, topRight, bottomRight, bottomLeft } = corners;
            if (topLeft === topRight && topRight === bottomRight && bottomRight === bottomLeft) {
                addRadius(topLeft);
            }
        }

        // Spacing (gaps + padding)
        const layout = node.layout;
        if (layout.style.strategy === 'flex' && layout.style.gap > 0) {
            addSpacing(layout.style.gap);
        }
        if (layout.style.strategy === 'grid') {
            addSpacing(layout.style.columnGap);
            addSpacing(layout.style.rowGap);
        }
        const padding = layout.spacing.padding;
        if (padding) {
            addSpacing(padding.top);
            addSpacing(padding.right);
            addSpacing(padding.bottom);
            addSpacing(padding.left);
        }

        // Fixed sizes use the same spacing scale (w-95, h-60, …).
        if (layout.sizing.widthMode === 'fixed' && !sProps?.width && !isZero(node.frame.width)) {
            addSpacing(node.frame.width);
        }
        if (layout.sizing.heightMode === 'fixed' && !sProps?.height && !isZero(node.frame.height)) {
            addSpacing(node.frame.height);
        }

        // Variant-marked nodes render class sets built from their member nodes
        // (children stripped) — collect those members' styles too.
        const variant = node.metadata?.custom?.variant;
        if (variant && typeof variant === 'object') {
            const members = (variant as { members?: DesignNode[] }).members;
            for (const member of members ?? []) {
                collectNode(member);
            }
        }
    };

    // Instance color/length props render as token references (`accent={colors.X}`,
    // `width={spacing[95]}`) — their values live in instance props, outside the
    // emitted style trees.
    const visitedInstanceTemplates = new Set<DesignNode>();
    const visitInstances = (node: DesignNode): void => {
        if (node.type === 'component' && node.template) {
            const colorProps = collectTemplateColorProps(node.template);
            const numericProps = collectTemplateNumericProps(node.template);
            const gradientProps = collectTemplateGradientProps(node.template);
            for (const [key, value] of Object.entries(node.props ?? {})) {
                if (typeof value === 'string' && colorProps.has(key)) addColorName(normalizeColor(value));
                if (typeof value === 'number') {
                    const field = numericProps.get(key);
                    if (field === 'radius') addRadiusValue(value);
                    else if (field !== undefined) addSpacingValue(value);
                }
                if (gradientProps.has(key) && typeof value === 'object' && value !== null) {
                    const stops = (value as { stops?: unknown[] }).stops;
                    for (const stop of stops ?? []) {
                        if (typeof stop === 'object' && stop !== null) {
                            const color = (stop as { color?: unknown }).color;
                            if (typeof color === 'string') addColorName(normalizeColor(color));
                        }
                    }
                }
            }
            if (!visitedInstanceTemplates.has(node.template)) {
                visitedInstanceTemplates.add(node.template);
                visitInstances(node.template);
            }
            return;
        }
        for (const child of node.children) {
            visitInstances(child);
        }
    };
    for (const root of document.nodes) {
        visitInstances(root);
    }

    walkEmittedTrees(document, collectNode);

    return tokens;
}

/** Format a numeric token map as a `as const` object literal. */
function formatNumericTokens(map: Record<string, number>): string {
    const entries = Object.entries(map)
        .map(([key, value]) => `    ${key}: ${value},`)
        .join('\n');
    return `{\n${entries}\n} as const;`;
}

/** Generate the `src/tokens.ts` module referenced by instance props. */
export function generateTokensModule(tokens: DesignTokens): VirtualFile {
    const names = new Set<string>();
    const colorEntries: string[] = [];
    for (const [normalized, name] of Object.entries(tokens.colorNames)) {
        if (names.has(name)) continue;
        names.add(name);
        colorEntries.push(`    ${name}: '${normalized.replace(/'/g, "\\'")}',`);
    }

    // Module maps are the theme tokens ∪ instance prop values, so every prop
    // reference type-checks against the exported value types.
    const radii = { ...tokens.radii, ...tokens.radiusValues };
    const spacing = { ...tokens.spacing, ...tokens.spacingValues };

    const content = `/** Design tokens extracted from the compiled document. */
export const colors = {
${colorEntries.join('\n')}
} as const;

export const radii = ${formatNumericTokens(radii)}

export const spacing = ${formatNumericTokens(spacing)}

/** A gradient stop: a color at a position along the gradient (0-1). */
export type GradientStop = {
    color: ColorValue;
    position: number;
};

/** A gradient fill definition (stops carry positions for exact fidelity). */
export type GradientValue = {
    /** The gradient angle in degrees (linear gradients). */
    angle?: number;
    /** The gradient center (radial gradients). */
    center?: { x: number; y: number };
    /** The gradient stops, in order. */
    stops: [GradientStop, GradientStop, ...GradientStop[]];
};

/** A color value from the design token palette. */
export type ColorValue = (typeof colors)[keyof typeof colors];

/** A radius value from the design token palette. */
export type RadiusValue = (typeof radii)[keyof typeof radii];

/** A spacing/size value from the design token palette. */
export type SpacingValue = (typeof spacing)[keyof typeof spacing];
`;

    return {
        path: 'src/tokens.ts',
        content,
    };
}
