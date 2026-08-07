/**
 * Layout style definitions for the Design AST.
 */

import type { EdgeInsets } from '@framer/compiler-shared';

/** The layout strategy for a node. */
export type LayoutStrategy = 'flex' | 'grid' | 'absolute' | 'stack' | 'auto';

/** The main axis direction for flex layouts. */
export type FlexDirection = 'row' | 'column' | 'row-reverse' | 'column-reverse';

/** The cross-axis alignment for flex layouts. */
export type AlignItems = 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';

/** The main-axis justification for flex layouts. */
export type JustifyContent = 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';

/** The wrapping behavior for flex layouts. */
export type FlexWrap = 'nowrap' | 'wrap' | 'wrap-reverse';

/** The alignment of grid items. */
export type GridAlign = 'start' | 'end' | 'center' | 'stretch';

/** A flex layout definition. */
export interface FlexLayout {
    strategy: 'flex';
    direction: FlexDirection;
    alignItems: AlignItems;
    justifyContent: JustifyContent;
    flexWrap: FlexWrap;
    gap: number;
    rowGap?: number;
    columnGap?: number;
}

/** A grid layout definition. */
export interface GridLayout {
    strategy: 'grid';
    columns: number | string[];
    rows: number | string[];
    columnGap: number;
    rowGap: number;
    alignItems: GridAlign;
    justifyItems: GridAlign;
}

/** An absolute layout definition (positioned children). */
export interface AbsoluteLayout {
    strategy: 'absolute';
}

/** A stack layout definition (overlapping children). */
export interface StackLayout {
    strategy: 'stack';
    align: 'start' | 'center' | 'end' | 'stretch';
}

/** An auto layout definition (no explicit layout). */
export interface AutoLayout {
    strategy: 'auto';
}

/** The layout style for a node. */
export type LayoutStyle = FlexLayout | GridLayout | AbsoluteLayout | StackLayout | AutoLayout;

/** The positioning mode for a node within its parent. */
export type PositionMode = 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';

/** The sizing mode for a node. */
export type SizingMode = 'fixed' | 'fill' | 'auto' | 'hug';

/** The sizing behavior for a node. */
export interface Sizing {
    widthMode: SizingMode;
    heightMode: SizingMode;
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    aspectRatio?: number;
}

/** The positioning of a node within its parent. */
export interface Positioning {
    mode: PositionMode;
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
    zIndex?: number;
}

/** The spacing (padding and margin) for a node. */
export interface Spacing {
    padding?: EdgeInsets;
    margin?: EdgeInsets;
}

/** The responsive behavior for a node. */
export interface ResponsiveBehavior {
    /** Breakpoint-specific overrides keyed by breakpoint name. */
    breakpoints?: Record<string, ResponsiveOverride>;
    /** Whether the node should hide on specific breakpoints. */
    hideOn?: string[];
}

/** A responsive override for a node at a specific breakpoint. */
export interface ResponsiveOverride {
    layout?: Partial<LayoutStyle>;
    sizing?: Partial<Sizing>;
    spacing?: Partial<Spacing>;
    visible?: boolean;
}

/** The complete layout definition for a node. */
export interface Layout {
    style: LayoutStyle;
    position: Positioning;
    sizing: Sizing;
    spacing: Spacing;
    responsive?: ResponsiveBehavior;
}