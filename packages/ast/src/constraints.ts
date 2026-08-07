/**
 * Constraint definitions for the Design AST.
 */

/** The horizontal constraint for a node within its parent. */
export type HorizontalConstraint = 'left' | 'right' | 'center' | 'scale' | 'fill';

/** The vertical constraint for a node within its parent. */
export type VerticalConstraint = 'top' | 'bottom' | 'center' | 'scale' | 'fill';

/** The constraint behavior for a node. */
export interface Constraints {
    /** The horizontal constraint. */
    horizontal: HorizontalConstraint;
    /** The vertical constraint. */
    vertical: VerticalConstraint;
    /** The minimum width in px. */
    minWidth?: number;
    /** The maximum width in px. */
    maxWidth?: number;
    /** The minimum height in px. */
    minHeight?: number;
    /** The maximum height in px. */
    maxHeight?: number;
    /** The aspect ratio (width / height). */
    aspectRatio?: number;
    /** Whether the node can grow to fill available space. */
    grow?: boolean;
    /** Whether the node can shrink. */
    shrink?: boolean;
    /** The flex basis. */
    basis?: number | 'auto';
}