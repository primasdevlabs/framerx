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

import type {
    DesignDocument,
    DesignNode,
    FlexLayout,
    ResponsiveBehavior,
    ResponsiveOverride,
} from '@framer/compiler-ast';
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
    const behavior = node.layout.responsive;
    if (!behavior) return undefined;
    // An image node whose ONLY responsive behavior is image swaps renders as
    // <picture><source media> — the swap lives in the markup, not CSS. Skip
    // the class so the validator never sees a used class with no rule.
    if (node.type === 'image' && hasOnlyImageSwaps(behavior)) return undefined;
    return `${RESPONSIVE_CLASS_PREFIX}${sha256HexOfString(node.id).slice(0, 12)}`;
}

/**
 * Whether a responsive behavior contains NO CSS-representable override — every
 * breakpoint only carries an image swap (handled by <picture> in the JSX).
 */
function hasOnlyImageSwaps(behavior: ResponsiveBehavior): boolean {
    if ((behavior.hideOn ?? []).length > 0) return false;
    const overrides = Object.values(behavior.breakpoints ?? {});
    if (overrides.length === 0) return false;
    for (const override of overrides) {
        if (!override) return false;
        if (
            override.layout ||
            override.sizing ||
            override.spacing ||
            override.style ||
            override.visible !== undefined
        ) {
            return false;
        }
        if (!override.image) return false;
        // An image swap that also changes object-fit/position needs a CSS
        // rule (object-fit/object-position re-assertion), so the class stays.
        if (override.image.fit || override.image.position) return false;
    }
    return true;
}

/** A single CSS declaration, e.g. `width: 768px`. */
interface ResponsiveDeclaration {
    property: string;
    value: string;
}

/** The collected rules: selector → tier (min-width; 0 = base) → declarations. */
type RuleMap = Map<string, Map<number, ResponsiveDeclaration[]>>;

/**
 * Resolve a breakpoint name to its min-width: exact match first, then a
 * case-insensitive fallback. Replica overrides are keyed by the tier frame's
 * canvas name (e.g. 'Desktop') while breakpoint scales may spell names
 * differently (e.g. 'desktop') — the case fold keeps them resolvable.
 */
export function breakpointMinWidth(
    breakpoints: ReadonlyMap<string, number>,
    breakpointName: string,
): number | undefined {
    const exact = breakpoints.get(breakpointName);
    if (exact !== undefined) return exact;
    const lowered = breakpointName.toLowerCase();
    for (const [name, minWidth] of breakpoints) {
        if (name.toLowerCase() === lowered) return minWidth;
    }
    return undefined;
}

/** Generate the responsive.css file for a document. */
export function generateResponsiveCss(document: DesignDocument, assetPaths?: ReadonlyMap<string, string>): VirtualFile | null {
    const breakpoints = new Map(document.breakpoints.map((bp) => [bp.name, bp.minWidth]));
    const rules: RuleMap = new Map();

    /** Resolve a breakpoint name to its min-width (undefined when unknown). */
    const minWidthOf = (breakpointName: string): number | undefined => breakpointMinWidth(breakpoints, breakpointName);

    const add = (node: DesignNode, minWidth: number, declarations: ResponsiveDeclaration[]): void => {
        if (declarations.length === 0) return;
        const selector = responsiveClassName(node);
        if (!selector) return;

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

        // A frame whose image fill swaps per tier renders its BASE fill here
        // (base tier, min-width 0) instead of inline — an inline style would
        // beat the media-query swap (inline > class). The reference renderer
        // already emits the base fill in its class rule, so both pages agree.
        add(node, 0, baseImageFillDeclarations(node, assetPaths));

        // Explicit per-breakpoint overrides. A tier whose breakpoint is not
        // in the document scale cannot be placed — skip it. Falling back to 0
        // would emit an UNCONDITIONAL rule that silently applies the override
        // at every viewport. A real min-width-0 breakpoint still resolves (the
        // map returns 0, not undefined) and keeps its base-tier rule.
        for (const [breakpointName, override] of Object.entries(behavior.breakpoints ?? {})) {
            if (!override) continue;
            const minWidth = minWidthOf(breakpointName);
            if (minWidth === undefined) continue;
            const declarations = responsiveDeclarations(node, override, assetPaths);
            if (declarations.length > 0) add(node, minWidth, declarations);
        }

        // hideOn: hide the node at specific breakpoints.
        for (const breakpointName of behavior.hideOn ?? []) {
            const minWidth = minWidthOf(breakpointName);
            if (minWidth === undefined) continue;
            add(node, minWidth, [{ property: 'display', value: 'none' }]);
        }
    });

    // Nothing responsive resolved → no file at all (the main entry then also
    // skips the responsive.css import). Base-tier-only rules DO count: they
    // are unconditional selectors without a media query, and gating on
    // '@media' used to drop them, leaving referenced classes with no rule.
    if (rules.size === 0) return null;

    const content = renderRules(rules);
    return {
        path: 'src/styles/responsive.css',
        content,
    };
}

/**
 * The base-tier declarations for a frame whose image fill swaps per tier.
 *
 * Mirrors what renderStyleAttrs would emit inline (background-image / size /
 * position), but as CSS so the tier's media-query swap can override it. Only
 * frames with responsive image overrides need this — every other image fill
 * stays inline. Standalone `<img>` nodes swap via `<picture>` and never emit
 * a background at all.
 */
function baseImageFillDeclarations(
    node: DesignNode,
    assetPaths?: ReadonlyMap<string, string>,
): ResponsiveDeclaration[] {
    if (node.type === 'image') return [];
    const behavior = node.layout.responsive;
    const hasImageOverrides =
        behavior?.breakpoints !== undefined &&
        Object.values(behavior.breakpoints).some((override) => Boolean(override?.image));
    if (!hasImageOverrides) return [];
    const fill = node.style.fills?.[0];
    if (!fill || fill.type !== 'image') return [];

    const url = resolveResponsiveImageSrc(fill.image.src, assetPaths);
    const declarations: ResponsiveDeclaration[] = [
        { property: 'background-image', value: `url("${url}")` },
        { property: 'background-size', value: imageSizeValue(fill.image.objectFit ?? 'cover') },
        { property: 'background-position', value: fill.image.objectPosition ?? 'center' },
    ];
    return declarations;
}

/** Convert a responsive override into CSS declarations (exact values). */
function responsiveDeclarations(
    node: DesignNode,
    override: ResponsiveOverride,
    assetPaths?: ReadonlyMap<string, string>,
): ResponsiveDeclaration[] {
    const declarations: ResponsiveDeclaration[] = [];

    // Sizing
    const sizing = override.sizing;
    if (sizing) {
        if (sizing.width !== undefined) declarations.push({ property: 'width', value: lengthValue(sizing.width) });
        else if (sizing.widthMode) declarations.push({ property: 'width', value: sizingValue(sizing.widthMode) });
        if (sizing.height !== undefined) declarations.push({ property: 'height', value: lengthValue(sizing.height) });
        else if (sizing.heightMode) declarations.push({ property: 'height', value: sizingValue(sizing.heightMode) });
        if (sizing.minWidth !== undefined)
            declarations.push({ property: 'min-width', value: lengthValue(sizing.minWidth) });
        if (sizing.maxWidth !== undefined)
            declarations.push({ property: 'max-width', value: lengthValue(sizing.maxWidth) });
        if (sizing.minHeight !== undefined)
            declarations.push({ property: 'min-height', value: lengthValue(sizing.minHeight) });
        if (sizing.maxHeight !== undefined)
            declarations.push({ property: 'max-height', value: lengthValue(sizing.maxHeight) });
        if (sizing.aspectRatio !== undefined)
            declarations.push({ property: 'aspect-ratio', value: String(sizing.aspectRatio) });
    }

    // Spacing (padding)
    const padding = override.spacing?.padding;
    if (padding) {
        if (padding.top !== undefined) declarations.push({ property: 'padding-top', value: lengthValue(padding.top) });
        if (padding.right !== undefined)
            declarations.push({ property: 'padding-right', value: lengthValue(padding.right) });
        if (padding.bottom !== undefined)
            declarations.push({ property: 'padding-bottom', value: lengthValue(padding.bottom) });
        if (padding.left !== undefined)
            declarations.push({ property: 'padding-left', value: lengthValue(padding.left) });
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
        if (style.fontSize !== undefined)
            declarations.push({ property: 'font-size', value: lengthValue(style.fontSize) });
        if (style.color !== undefined) declarations.push({ property: 'color', value: style.color });
        if (style.opacity !== undefined) declarations.push({ property: 'opacity', value: String(style.opacity) });
    }

    // Visibility. `visible: false` hides the node; `visible: true` RESTORES a
    // node that is hidden at base (a replica's override — the static `hidden`
    // class stays on the element, so the media rule must re-assert the node's
    // natural display at this tier or it would stay hidden forever).
    if (override.visible === true) {
        declarations.push({ property: 'display', value: restoreDisplay(node) });
    } else if (override.visible === false) {
        declarations.push({ property: 'display', value: 'none' });
    }

    // Responsive image swap (folded from a replica's image override).
    //   - standalone <img>: the src swap is handled by the JSX
    //     `<picture><source media>` emission, NOT here — CSS content: url()
    //     would drop object-fit on the content-replaced image, while
    //     <picture> keeps the img's `object-<fit>` class at every tier. The
    //     tier's OBJECT-FIT/POSITION can still differ from the primary's, so
    //     those re-assert here (the base class only covers the primary's fit).
    //   - frame with an image fill: `background-image: url(...)` swaps the
    //     background layer, preserving the frame's box exactly
    //   - `src: ''` removes the image at this tier (`background-image: none`)
    const image = override.image;
    if (image) {
        if (node.type === 'image') {
            // object-fit keywords map 1:1 to their CSS values (unlike
            // background-size, where `fill` is 100% 100%).
            if (image.fit) declarations.push({ property: 'object-fit', value: image.fit });
            if (image.position) declarations.push({ property: 'object-position', value: image.position });
        } else {
            const url = image.src ? resolveResponsiveImageSrc(image.src, assetPaths) : null;
            declarations.push({ property: 'background-image', value: url ? `url("${url}")` : 'none' });
            if (image.fit) declarations.push({ property: 'background-size', value: imageSizeValue(image.fit) });
            if (image.position) declarations.push({ property: 'background-position', value: image.position });
        }
    }

    return declarations;
}

/**
 * Resolve an override image's source URL through the asset registry, so the
 * tier's swap references the same local file the JSX `<img>`/fill uses.
 * Falls back to the raw source URL when the registry has no mapping (e.g. a
 * remote-only alternate the exporter could not fetch).
 */
function resolveResponsiveImageSrc(src: string, assetPaths?: ReadonlyMap<string, string>): string {
    const resolved = assetPaths?.get(src);
    if (resolved) {
        // Assets live under public/ and are referenced ABSOLUTELY
        // (`/assets/images/x.png`) so the same URL works in dev (Vite serves
        // public/ at the root) and in the production build (Vite copies it
        // verbatim into dist/). A relative ../ reference from src/styles/ would
        // resolve outside dist/ and 404 once built.
        if (resolved.startsWith('public/')) return `/${resolved.slice('public/'.length)}`;
        if (resolved.startsWith('src/')) return `../${resolved.slice('src/'.length)}`;
        return resolved;
    }
    return src;
}

/** CSS background-size for an object-fit value. */
function imageSizeValue(fit: NonNullable<ResponsiveOverride['image']>['fit']): string {
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

/**
 * The display value that restores a node hidden at base.
 *
 * Matches what the node's static Tailwind classes produce: flex and grid
 * strategies carry `flex`/`grid` classes, everything else renders as a
 * block-level element (div/p/img are all block under Tailwind's preflight).
 * Emitting the wrong display would break the layout the tier restores.
 */
function restoreDisplay(node: DesignNode): string {
    const strategy = node.layout.style.strategy;
    if (strategy === 'flex') return 'flex';
    if (strategy === 'grid') return 'grid';
    return 'block';
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
            const declarations = byTier
                .get(tier)!
                .map((d) => `    ${d.property}: ${d.value};`)
                .join('\n');
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
