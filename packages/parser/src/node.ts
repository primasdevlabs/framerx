/**
 * Framer node → Design AST node conversion.
 */

import type { DesignImageNode, DesignNode, DesignNodeType, LayoutStyle, ResponsiveBehavior, ResponsiveOverride } from '@framer/compiler-ast';
import type { Rect } from '@framer/compiler-shared';
import { normalizeColor, stableId } from '@framer/compiler-shared';

import { parseAnimations } from './animation';
import { parseInteractionState } from './interaction';
import { parseLayout } from './layout';
import { parseStyle } from './style';
import { parseText } from './typography';
import type { FramerNode, FramerResponsiveOverride } from './types';

/**
 * Convert a Framer node to a Design AST node.
 *
 * Identity is preserved end-to-end: the Design AST node id IS the Framer
 * source node id, so the same source node is always the same AST node — no
 * matter how many times the document is parsed or which traversal reaches it.
 * Nodes without a source id (defensive) fall back to a deterministic hash of
 * their own structure so ids stay stable between exports.
 *
 * `sharedMasters` memoizes master→DesignNode parses for one document parse:
 * every instance of a component shares the SAME parsed master body object
 * (the plugin adapter already shares one master object per component), so a
 * master never parses twice and its DesignNode identity is stable across
 * instances. The memoized template is immutable after this pass.
 */
export function parseNode(node: FramerNode, sharedMasters?: Map<FramerNode, DesignNode>): DesignNode {
    const base = {
        id: node.id || stableId('node', JSON.stringify([node.type, node.name, node.frame?.x, node.frame?.y])),
        name: node.name || 'Untitled',
        frame: parseFrame(node.frame),
        layout: {
            ...parseLayout(node.layout),
            responsive: parseResponsive(node.responsive),
        },
        style: parseStyle(node.style),
        constraints: {
            horizontal: 'left' as const,
            vertical: 'top' as const,
        },
        animations: parseAnimations(node.interactions),
        interactions: parseInteractionState(node.interactions),
        children: (node.children ?? []).map((child) => parseNode(child, sharedMasters)),
        metadata: {
            sourceId: node.id,
            sourceType: node.type,
            // Replica identity survives into the AST for replica nodes that
            // reached the model (unresolved overrides kept as independent
            // nodes) so the coverage registry can track it end-to-end.
            ...(node.source?.isReplica === true
                ? {
                      custom: {
                          replicaOf: node.source.originalId ?? null,
                          ...(node.source.breakpointName ? { breakpointName: node.source.breakpointName } : {}),
                      },
                  }
                : {}),
        },
    };

    switch (node.type) {
        case 'Text':
            return {
                ...base,
                type: 'text',
                text: parseText(node.text),
            };
        case 'Image':
            return {
                ...base,
                type: 'image',
                asset: {
                    id: stableId('asset', node.image?.src ?? node.id),
                    type: 'image',
                    src: node.image?.src ?? '',
                    name: node.image?.name,
                    width: node.image?.width,
                    height: node.image?.height,
                    mimeType: node.image?.mimeType,
                    size: node.image?.size,
                    alt: node.image?.alt,
                    data: node.image?.data,
                },
                objectFit: (node.image?.objectFit as DesignImageNode['objectFit']) ?? 'cover',
                objectPosition: node.image?.objectPosition,
            };
        case 'Vector':
        case 'Shape':
            return {
                ...base,
                type: 'vector',
                svg: node.vector?.svg,
                pathData: node.vector?.pathData,
                asset: node.vector?.src
                    ? {
                        id: stableId('asset', node.vector.src),
                        type: 'svg',
                        src: node.vector.src,
                        name: node.vector.name,
                        mimeType: node.vector.mimeType,
                        data: node.vector.data,
                    }
                    : undefined,
            };
        case 'Component':
            return {
                ...base,
                type: 'component',
                componentId: node.component?.id ?? node.id,
                componentName: node.component?.name ?? node.name,
                props: node.component?.props ?? node.props,
                // The real source of a code component (no canvas master)
                // survives into the model so the definition can emit it
                // verbatim as the true implementation.
                metadata: node.component?.code
                    ? {
                        ...base.metadata,
                        custom: {
                            ...(base.metadata.custom ?? {}),
                            code: node.component.code,
                        },
                    }
                    : base.metadata,
                slots: node.component?.slots
                    ? Object.fromEntries(
                        Object.entries(node.component.slots).map(([name, nodes]) => [
                            name,
                            nodes.map((child) => parseNode(child, sharedMasters)),
                        ]),
                    )
                    : undefined,
                // The master is the component's real definition body (slot
                // placeholders at their true positions). The separation pass
                // renders it as the single implementation — never a
                // synthesized approximation. The same master object parses
                // ONCE per document (shared across every instance of the
                // component) and is marked as master-backed so the definition
                // model can tell real masters from extraction templates.
                template: node.component?.master
                    ? parseSharedMaster(node.component.master, sharedMasters)
                    : undefined,
            };
        case 'Slot': {
            // Per-slot props (the master's slot placeholder controls) survive
            // into the model — nothing the SDK exposes is dropped.
            const slotProps = node.props && Object.keys(node.props).length > 0 ? node.props : undefined;
            return {
                ...base,
                type: 'slot',
                slotName: node.name,
                metadata: slotProps
                    ? {
                        sourceId: node.id,
                        sourceType: node.type,
                        custom: {
                            ...(base.metadata.custom ?? {}),
                            slotProps,
                        },
                    }
                    : base.metadata,
            };
        }
        case 'Group':
            return {
                ...base,
                type: 'group',
            };
        case 'Frame':
        default:
            return {
                ...base,
                type: 'frame',
                isSection: node.name.toLowerCase().includes('section'),
                isScrollContainer: node.name.toLowerCase().includes('scroll'),
            };
    }
}

/**
 * Parse a component master as the shared definition body.
 *
 * Memoized per document (keyed by the master FramerNode object, which the
 * plugin adapter shares across all instances of a component): the same
 * DesignNode object backs every instance, so a master parses exactly once
 * and its identity is stable. The parsed root is marked `masterBody` (on
 * `metadata.custom`, idempotently) so the definition model can distinguish
 * real masters from repeated-subtree extraction templates.
 */
function parseSharedMaster(master: FramerNode, sharedMasters?: Map<FramerNode, DesignNode>): DesignNode {
    const cached = sharedMasters?.get(master);
    if (cached) return cached;

    const parsed = parseNode(master, sharedMasters);
    if (!parsed.metadata?.custom?.masterBody) {
        parsed.metadata = {
            ...parsed.metadata,
            custom: {
                ...(parsed.metadata?.custom ?? {}),
                masterBody: true,
            },
        };
    }
    sharedMasters?.set(master, parsed);
    return parsed;
}

/**
 * Convert Framer per-breakpoint overrides into the Design AST responsive
 * model (`ResponsiveBehavior` on the node layout). Overrides stay keyed by
 * the source breakpoint names; the document's breakpoint definitions map them
 * to concrete min-widths during code generation — the compiler never assumes
 * Tailwind sm/md/lg.
 */
export function parseResponsive(responsive?: Record<string, FramerResponsiveOverride>): ResponsiveBehavior | undefined {
    if (!responsive || Object.keys(responsive).length === 0) return undefined;

    const breakpoints: Record<string, ResponsiveOverride> = {};
    for (const [breakpointName, override] of Object.entries(responsive)) {
        if (!override) continue;
        const parsed: ResponsiveOverride = {};

        if (override.layout) {
            const layout: Record<string, unknown> = {};
            if (override.layout.direction) layout.direction = override.layout.direction;
            if (override.layout.alignItems) layout.alignItems = override.layout.alignItems;
            if (override.layout.justifyContent) layout.justifyContent = override.layout.justifyContent;
            if (override.layout.flexWrap) layout.flexWrap = override.layout.flexWrap;
            if (override.layout.gap !== undefined) layout.gap = override.layout.gap;
            parsed.layout = layout as Partial<LayoutStyle>;
        }

        if (override.sizing) {
            parsed.sizing = { ...override.sizing };
        }

        if (override.spacing?.padding) {
            parsed.spacing = {
                padding: {
                    top: override.spacing.padding.top ?? 0,
                    right: override.spacing.padding.right ?? 0,
                    bottom: override.spacing.padding.bottom ?? 0,
                    left: override.spacing.padding.left ?? 0,
                },
            };
        }

        if (override.style) {
            parsed.style = {};
            if (override.style.fontSize !== undefined) parsed.style.fontSize = override.style.fontSize;
            if (override.style.color !== undefined) parsed.style.color = normalizeColor(override.style.color);
            if (override.style.opacity !== undefined) parsed.style.opacity = override.style.opacity;
        }

        if (override.visible !== undefined) parsed.visible = override.visible;

        // Responsive image swap (folded from a replica): the tier's alternate
        // image + fit/position. `src: ''` removes the image at this tier.
        if (override.image) {
            parsed.image = { src: override.image.src };
            if (override.image.objectFit) parsed.image.fit = override.image.objectFit as NonNullable<ResponsiveOverride['image']>['fit'];
            if (override.image.objectPosition) parsed.image.position = override.image.objectPosition;
        }
        breakpoints[breakpointName] = parsed;
    }

    return Object.keys(breakpoints).length > 0 ? { breakpoints } : undefined;
}

/** Convert a Framer frame to a shared Rect. */
export function parseFrame(frame: FramerNode['frame']): Rect {
    return {
        x: frame.x ?? 0,
        y: frame.y ?? 0,
        width: frame.width ?? 0,
        height: frame.height ?? 0,
    };
}

/** Map a Framer node type to a Design AST node type. */
export function mapNodeType(type: string): DesignNodeType {
    switch (type) {
        case 'Text':
            return 'text';
        case 'Image':
            return 'image';
        case 'Vector':
        case 'Shape':
            return 'vector';
        case 'Component':
            return 'component';
        case 'Slot':
            return 'slot';
        case 'Group':
            return 'group';
        case 'Frame':
        default:
            return 'frame';
    }
}