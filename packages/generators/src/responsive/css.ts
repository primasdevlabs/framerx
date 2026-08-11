/**
 * Responsive CSS generation.
 *
 * Responsive behavior is extracted from the source document into the AST
 * (`DesignNode.layout.responsive`, keyed by the document's OWN breakpoint
 * names). This module emits equivalent CSS:
 *
 *   .fx-rsp-<stable-id> { … }                          ← base (mobile) tier
 *   @media (min-width: 768px) { .fx-rsp-… { … } }       ← tablet tier
 *   @media (min-width: 1024px) { .fx-rsp-… { … } }      ← desktop tier
 *
 * Breakpoints come from the document (`document.breakpoints`), never from
 * assumed Tailwind sm/md/lg values. Values keep source precision — a
 * 37.625px width stays 37.625px.
 *
 * Base-tier values are intentionally NOT emitted: the node's static Tailwind
 * classes already render the mobile/base state, and this stylesheet is
 * imported AFTER the base stylesheet so media rules win at their tiers.
 * Base-tier overrides (from a min-width-0 breakpoint) ARE emitted so the
 * source behavior is preserved exactly.
 */

import type { DesignDocument, DesignNode, FlexLayout, ResponsiveOverride } from '@framer/compiler-ast';
import { sha256HexOfString } from '@framer/compiler-shared';

import type { VirtualFile } from '../types';
import { walkEmittedTrees } from '../tailwind/tokens';

/** The class prefix for generated responsive rules. */
export const RESPONSIVE_CLASS_PREFIX = 'fx-rsp-';

/**
 * The deterministic responsive class for a node (stable across exports — it
 * hashes the node's source id). Returns undefined when the node has no
 * responsive behavior.
 */
export function responsiveClassName(node: DesignNode): string | undefined {
    if (!node.layout.responsive) return undefined;
    return `${RESPONSIVE_CLASS_PREFIX}${sha256HexOfString(node.id).slice(0, 12)}`;
}

/** A single CSS declaration, e.g. `width: 768px`. */
interface ResponsiveDeclaration {
    property: string;
    value: string;
}

/** The collected rules: selector → tier (min-width; 0 = base) → declarations. */
type RuleMap = Map<string, Map<number, ResponsiveDeclaration[]>>;

/** Generate the responsive.css file for a document. */
export function generateResponsiveCss(document: DesignDocument): VirtualFile {
    const breakpoints = new Map(document.breakpoints.map((bp) => [bp.name, bp.minWidth]));
    const rules: RuleMap = new Map();

    const add = (node: DesignNode, breakpointName: string, declarations: ResponsiveDeclaration[]): void => {
        if (declarations.length === 0) return;
        const selector = responsiveClassName(node);
        if (!selector) return;
        const minWidth = breakpoints.get(breakpointName) ?? 0;

        let byTier = rules.get(selector);
        if (!byTier) {
            byTier = new Map();
            rules.set(selector, byTier);
        }
        const existing = byTier.get(minWidth) ?? [];
        byTier.set(minWidth, [...existing, ...declarations]);
    };

    walkEmittedTrees(document, (node) => {
        const behavior = node.layout.responsive;
        if (!behavior) return;

        // Explicit per-breakpoint overrides.
        for (const [breakpointName, override] of Object.entries(behavior.breakpoints ?? {})) {
            if (!override) continue;
            const declarations = responsiveDeclarations(override);
            if (declarations.length > 0) add(node, breakpointName, declarations);
        }

        // hideOn: hide the node at specific breakpoints.
        for (const breakpointName of behavior.hideOn ?? []) {
            add(node, breakpointName, [{ property: 'display', value: 'none' }]);
        }
    });

    const content = renderRules(rules);
    return {
        path: 'src/styles/responsive.css',
        content,
    };
}

/** Convert a responsive override into CSS declarations (exact values). */
function responsiveDeclarations(override: ResponsiveOverride): ResponsiveDeclaration[] {
    const declarations: ResponsiveDeclaration[] = [];

    // Sizing
    const sizing = override.sizing;
    if (sizing) {
        if (sizing.width !== undefined) declarations.push({ property: 'width', value: lengthValue(sizing.width) });
        else if (sizing.widthMode) declarations.push({ property: 'width', value: sizingValue(sizing.widthMode) });
        if (sizing.height !== undefined) declarations.push({ property: 'height', value: lengthValue(sizing.height) });
        else if (sizing.heightMode) declarations.push({ property: 'height', value: sizingValue(sizing.heightMode) });
        if (sizing.minWidth !== undefined) declarations.push({ property: 'min-width', value: lengthValue(sizing.minWidth) });
        if (sizing.maxWidth !== undefined) declarations.push({ property: 'max-width', value: lengthValue(sizing.maxWidth) });
        if (sizing.minHeight !== undefined) declarations.push({ property: 'min-height', value: lengthValue(sizing.minHeight) });
        if (sizing.maxHeight !== undefined) declarations.push({ property: 'max-height', value: lengthValue(sizing.maxHeight) });
        if (sizing.aspectRatio !== undefined) declarations.push({ property: 'aspect-ratio', value: String(sizing.aspectRatio) });
    }

    // Spacing (padding)
    const padding = override.spacing?.padding;
    if (padding) {
        if (padding.top !== undefined) declarations.push({ property: 'padding-top', value: lengthValue(padding.top) });
        if (padding.right !== undefined) declarations.push({ property: 'padding-right', value: lengthValue(padding.right) });
        if (padding.bottom !== undefined) declarations.push({ property: 'padding-bottom', value: lengthValue(padding.bottom) });
        if (padding.left !== undefined) declarations.push({ property: 'padding-left', value: lengthValue(padding.left) });
    }

    // Layout (flex fields — the responsive model only overrides flex layout)
    const layout = override.layout as Partial<FlexLayout> | undefined;
    if (layout) {
        if (layout.gap !== undefined) declarations.push({ property: 'gap', value: lengthValue(layout.gap) });
        if (layout.direction) declarations.push({ property: 'flex-direction', value: layout.direction });
        if (layout.alignItems) declarations.push({ property: 'align-items', value: layout.alignItems });
        if (layout.justifyContent) declarations.push({ property: 'justify-content', value: layout.justifyContent });
        if (layout.flexWrap) declarations.push({ property: 'flex-wrap', value: layout.flexWrap });
    }

    // Style (typography / visual)
    const style = override.style;
    if (style) {
        if (style.fontSize !== undefined) declarations.push({ property: 'font-size', value: lengthValue(style.fontSize) });
        if (style.color !== undefined) declarations.push({ property: 'color', value: style.color });
        if (style.opacity !== undefined) declarations.push({ property: 'opacity', value: String(style.opacity) });
    }

    if (override.visible === false) declarations.push({ property: 'display', value: 'none' });

    return declarations;
}

/** The CSS value for a sizing mode. */
function sizingValue(mode: 'fixed' | 'fill' | 'auto' | 'hug'): string {
    switch (mode) {
        case 'fill':
            return '100%';
        case 'hug':
            return 'fit-content';
        case 'auto':
            return 'auto';
        default:
            // Fixed without a number can't resolve to a length — the caller
            // emits the mode keyword only when no px value accompanies it.
            return 'auto';
    }
}

/** Format a number as an exact px length (up to 3 decimals). */
function lengthValue(value: number): string {
    return `${Math.round(value * 1000) / 1000}px`;
}

/** Render the collected rules as CSS text. */
function renderRules(rules: RuleMap): string {
    const selectors = [...rules.keys()].sort();

    // Group declarations by selector so output is stable and readable: base
    // rules first, then each @media tier in ascending min-width order.
    const blocks: string[] = [];
    for (const selector of selectors) {
        const byTier = rules.get(selector)!;
        const tiers = [...byTier.keys()].sort((a, b) => a - b);

        for (const tier of tiers) {
            const declarations = byTier.get(tier)!.map((d) => `    ${d.property}: ${d.value};`).join('\n');
            if (tier === 0) {
                blocks.push(`.${selector} {\n${declarations}\n}`);
            } else {
                blocks.push(`@media (min-width: ${tier}px) {\n    .${selector} {\n${declarations}\n    }\n}`);
            }
        }
    }

    if (blocks.length === 0) {
        return '/** No responsive behavior was extracted from the source document. */\n';
    }

    return `/**\n * Responsive styles extracted from the source document.\n * Media queries use the document's own breakpoints — not assumed defaults.\n */\n\n${blocks.join('\n\n')}\n`;
}
