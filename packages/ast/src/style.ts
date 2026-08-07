/**
 * Visual style definitions for the Design AST.
 */

import type { BlendMode, CornerRadius, Fill, Shadow, Stroke } from '@framer/compiler-shared';

/** The visual style for a node. */
export interface VisualStyle {
    /** Background fills (applied in order). */
    fills?: Fill[];
    /** Border strokes. */
    strokes?: Stroke[];
    /** Corner radius. */
    radius?: CornerRadius;
    /** Box shadows. */
    shadows?: Shadow[];
    /** Opacity (0-1). */
    opacity?: number;
    /** Blend mode. */
    blendMode?: BlendMode;
    /** Whether the node is visible. */
    visible?: boolean;
    /** CSS overflow behavior. */
    overflow?: 'visible' | 'hidden' | 'scroll' | 'auto';
    /** Cursor style. */
    cursor?: string;
    /** CSS transform (applied after layout). */
    transform?: Transform;
    /** CSS filter effects. */
    filters?: Filter[];
}

/** A CSS transform definition. */
export interface Transform {
    rotate?: number;
    scaleX?: number;
    scaleY?: number;
    skewX?: number;
    skewY?: number;
    translateX?: number;
    translateY?: number;
}

/** A CSS filter effect. */
export type Filter =
    | { type: 'blur'; radius: number }
    | { type: 'brightness'; amount: number }
    | { type: 'contrast'; amount: number }
    | { type: 'grayscale'; amount: number }
    | { type: 'hue-rotate'; angle: number }
    | { type: 'invert'; amount: number }
    | { type: 'saturate'; amount: number }
    | { type: 'sepia'; amount: number };