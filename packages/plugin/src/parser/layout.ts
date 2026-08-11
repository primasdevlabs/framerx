/**
 * Framer SDK node layout → FramerLayout mapping.
 */

import type { FramerEdgeInsets, FramerLayout } from '@framer/compiler-parser';

import type { SdkLength, SdkNode } from './sdk-types';

/** Parse a leading px value from a CSS length string. */
export function parsePx(value: string | null | undefined): number | undefined {
    if (!value) return undefined;
    const match = /^(-?[\d.]+)px$/.exec(value.trim());
    return match ? Number(match[1]) : undefined;
}

/** Parse a padding/margin shorthand ("16px" | "8px 12px" | "1px 2px 3px 4px"). */
export function parseInsets(value: string | null | undefined): FramerEdgeInsets | undefined {
    if (!value) return undefined;
    const parts = value.trim().split(/\s+/).map(parsePx);
    if (parts.some((p) => p === undefined)) return undefined;
    const [a, b, c, d] = parts as number[];

    if (parts.length === 1) return { top: a, right: a, bottom: a, left: a };
    if (parts.length === 2) return { top: a, right: b, bottom: a, left: b };
    if (parts.length === 3) return { top: a, right: b, bottom: c, left: b };
    if (parts.length === 4) return { top: a, right: b, bottom: c, left: d };
    return undefined;
}

/** Map a CSS length to a sizing mode. */
export function sizingMode(value: SdkLength | null | undefined): 'fixed' | 'fill' | 'auto' | 'hug' {
    if (!value) return 'auto';
    if (value.includes('%') || value.includes('fr')) return 'fill';
    if (value === 'fit-content' || value === 'fit-image') return 'hug';
    return 'fixed';
}

/** Map a stack distribution to a flex justification. */
function mapJustifyContent(distribution?: string | null): string {
    switch (distribution) {
        case 'start':
            return 'flex-start';
        case 'end':
            return 'flex-end';
        case 'center':
        case 'space-between':
        case 'space-around':
        case 'space-evenly':
            return distribution;
        default:
            return 'flex-start';
    }
}

/**
 * Map a stack alignment to a flex cross-axis alignment.
 *
 * Framer's cross-axis alignment is start | center | end only — there is no
 * stretch. Children stretch by their own fill sizing (`w-full`/`h-full`), never
 * by the container's alignment. The default (designer never touched it) is
 * start, so a null alignment MUST NOT map to 'stretch': that would blow every
 * default-stack child up to fill the cross axis.
 */
function mapAlignItems(alignment?: string | null): string {
    switch (alignment) {
        case 'start':
            return 'flex-start';
        case 'end':
            return 'flex-end';
        case 'center':
            return 'center';
        default:
            return 'flex-start';
    }
}

/** Convert an SDK node's layout attributes to a FramerLayout. */
export function parseLayout(node: SdkNode): FramerLayout {
    const layout: FramerLayout = {};

    // Strategy
    if (node.layout === 'stack') {
        layout.strategy = 'flex';
        layout.direction = node.stackDirection === 'horizontal' ? 'row' : 'column';
        layout.justifyContent = mapJustifyContent(node.stackDistribution);
        layout.alignItems = mapAlignItems(node.stackAlignment);
        layout.flexWrap = node.stackWrapEnabled ? 'wrap' : 'nowrap';
    } else if (node.layout === 'grid') {
        layout.strategy = 'grid';
        layout.columns = node.gridColumnCount && node.gridColumnCount !== 'auto-fill' ? node.gridColumnCount : 1;
        layout.rows = node.gridRowCount ?? undefined;
        // `gridColumnWidth` / `gridRowHeight` are per-axis fixed sizes in
        // pixels; preserved through to the DesignAST so the generator
        // can emit `grid-template-columns / rows: repeat(N, <size>px)`.
        if (node.gridColumnWidth !== null && node.gridColumnWidth !== undefined && Number.isFinite(node.gridColumnWidth)) {
            layout.columnWidth = node.gridColumnWidth;
        }
        if (node.gridRowHeight !== null && node.gridRowHeight !== undefined && Number.isFinite(node.gridRowHeight)) {
            layout.rowHeight = node.gridRowHeight;
        }
    } else {
        layout.strategy = node.position === 'absolute' ? 'absolute' : 'auto';
    }

    // Gap
    const gap = parsePx(node.gap);
    if (gap !== undefined) layout.gap = gap;

    // Padding
    const padding = parseInsets(node.padding);
    if (padding) layout.padding = padding;

    // Position
    layout.position = (node.position as FramerLayout['position']) ?? 'static';
    const offsets = {
        left: parsePx(node.left),
        top: parsePx(node.top),
        right: parsePx(node.right),
        bottom: parsePx(node.bottom),
    };
    if (offsets.left !== undefined || offsets.top !== undefined || offsets.right !== undefined || offsets.bottom !== undefined) {
        layout.offsets = offsets;
    }
    layout.zIndex = node.zIndex ?? undefined;

    // Sizing
    layout.sizing = {
        widthMode: sizingMode(node.width),
        heightMode: sizingMode(node.height),
        minWidth: parsePx(node.minWidth),
        maxWidth: parsePx(node.maxWidth),
        minHeight: parsePx(node.minHeight),
        maxHeight: parsePx(node.maxHeight),
        aspectRatio: node.aspectRatio ?? undefined,
    };

    return layout;
}
