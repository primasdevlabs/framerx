/**
 * Framer layout → Design AST layout conversion.
 */

import type { FlexLayout, Layout, LayoutStyle, Positioning, Sizing, Spacing } from '@framer/compiler-ast';
import type { EdgeInsets } from '@framer/compiler-shared';

import type { FramerLayout } from './types';

/** Convert Framer edge insets to a shared EdgeInsets. */
export function parseEdgeInsets(insets?: FramerLayout['padding']): EdgeInsets | undefined {
    if (!insets) return undefined;
    return {
        top: insets.top ?? 0,
        right: insets.right ?? 0,
        bottom: insets.bottom ?? 0,
        left: insets.left ?? 0,
    };
}

/** Convert Framer layout to a Design AST Layout. */
export function parseLayout(layout?: FramerLayout): Layout {
    const style = parseLayoutStyle(layout);
    const position = parsePositioning(layout);
    const sizing = parseSizing(layout);
    const spacing = parseSpacing(layout);

    return {
        style,
        position,
        sizing,
        spacing,
    };
}

/** Convert Framer layout strategy to a Design AST LayoutStyle. */
export function parseLayoutStyle(layout?: FramerLayout): LayoutStyle {
    const strategy = layout?.strategy ?? 'auto';

    switch (strategy) {
        case 'flex':
            return {
                strategy: 'flex',
                direction: layout?.direction ?? 'row',
                // Framer's cross-axis default is start — children stretch via
                // their own fill sizing, never the container's alignment.
                alignItems: (layout?.alignItems as FlexLayout['alignItems']) ?? 'flex-start',
                justifyContent: (layout?.justifyContent as FlexLayout['justifyContent']) ?? 'flex-start',
                flexWrap: (layout?.flexWrap as FlexLayout['flexWrap']) ?? 'nowrap',
                gap: layout?.gap ?? 0,
                rowGap: layout?.rowGap,
                columnGap: layout?.columnGap,
            };
        case 'grid':
            return {
                strategy: 'grid',
                columns: (layout?.columns as number | string[] | undefined) ?? 1,
                rows: (layout?.rows as number | string[] | undefined) ?? 1,
                columnWidth: layout?.columnWidth,
                rowHeight: layout?.rowHeight,
                columnGap: layout?.columnGap ?? 0,
                rowGap: layout?.rowGap ?? 0,
                alignItems: 'stretch',
                justifyItems: 'stretch',
            };
        case 'absolute':
            return { strategy: 'absolute' };
        case 'stack':
            return {
                strategy: 'stack',
                align: 'center',
            };
        case 'auto':
        default:
            return { strategy: 'auto' };
    }
}

/** Convert Framer positioning to a Design AST Positioning. */
export function parsePositioning(layout?: FramerLayout): Positioning {
    const mode = layout?.position ?? 'static';
    const offsets = layout?.offsets;

    return {
        mode,
        left: offsets?.left,
        top: offsets?.top,
        right: offsets?.right,
        bottom: offsets?.bottom,
        zIndex: layout?.zIndex,
    };
}

/** Convert Framer sizing to a Design AST Sizing. */
export function parseSizing(layout?: FramerLayout): Sizing {
    const sizing = layout?.sizing;

    return {
        widthMode: sizing?.widthMode ?? 'fixed',
        heightMode: sizing?.heightMode ?? 'fixed',
        minWidth: sizing?.minWidth,
        maxWidth: sizing?.maxWidth,
        minHeight: sizing?.minHeight,
        maxHeight: sizing?.maxHeight,
        aspectRatio: sizing?.aspectRatio,
    };
}

/** Convert Framer spacing to a Design AST Spacing. */
export function parseSpacing(layout?: FramerLayout): Spacing {
    return {
        padding: parseEdgeInsets(layout?.padding),
        margin: parseEdgeInsets(layout?.margin),
    };
}
