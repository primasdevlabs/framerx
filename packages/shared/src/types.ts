/**
 * Common primitive types shared across the compiler.
 */

/** A color value in any supported format. */
export type ColorValue = string;

/** A 2D point. */
export interface Point {
    x: number;
    y: number;
}

/** A size in abstract units (px by default). */
export interface Size {
    width: number;
    height: number;
}

/** Edge insets (padding / margin). */
export interface EdgeInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/** A rectangular region. */
export interface Rect extends Point, Size { }

/** A border radius definition. */
export interface CornerRadius {
    topLeft: number;
    topRight: number;
    bottomRight: number;
    bottomLeft: number;
}

/** A shadow definition. */
export interface Shadow {
    color: ColorValue;
    offsetX: number;
    offsetY: number;
    blur: number;
    spread: number;
    inset: boolean;
}

/** A gradient stop. */
export interface GradientStop {
    position: number;
    color: ColorValue;
}

/** A linear gradient definition. */
export interface LinearGradient {
    type: 'linear';
    angle: number;
    stops: GradientStop[];
}

/** A radial gradient definition. */
export interface RadialGradient {
    type: 'radial';
    center: Point;
    radius: number;
    stops: GradientStop[];
}

/** A fill definition. */
export type Fill =
    | { type: 'solid'; color: ColorValue }
    | LinearGradient
    | RadialGradient;

/** A stroke definition. */
export interface Stroke {
    fill: Fill;
    width: number;
    align: 'inside' | 'center' | 'outside';
    dashPattern?: number[];
}

/** A blend mode. */
export type BlendMode =
    | 'normal'
    | 'multiply'
    | 'screen'
    | 'overlay'
    | 'darken'
    | 'lighten'
    | 'color-dodge'
    | 'color-burn'
    | 'hard-light'
    | 'soft-light'
    | 'difference'
    | 'exclusion'
    | 'hue'
    | 'saturation'
    | 'color'
    | 'luminosity';

/** A responsive breakpoint definition. */
export interface Breakpoint {
    name: string;
    minWidth: number;
    maxWidth?: number;
}

/** A design token (color, spacing, typography, etc.). */
export interface DesignToken<T = unknown> {
    name: string;
    value: T;
    description?: string;
}