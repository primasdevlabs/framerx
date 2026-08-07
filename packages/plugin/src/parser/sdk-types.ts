/**
 * Structural types for the Framer SDK node attributes consumed by the adapter.
 *
 * These deliberately mirror the public shape of the `@framer/plugin` design
 * objects (FrameNode, TextNode, SVGNode, ComponentInstanceNode, …) without
 * importing the SDK classes. The adapter duck-types on these, which keeps it
 * unit-testable with plain object fixtures and decoupled from the SDK's
 * internal class layout.
 */

/** A position/size rectangle. */
export interface SdkRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A color — either a plain CSS color string or a named ColorStyle. */
export type SdkColor = string | { light?: string | null; dark?: string | null };

/** A gradient fill. */
export interface SdkGradient {
    angle?: number | null;
    width?: number | null;
    height?: number | null;
    x?: number | null;
    y?: number | null;
    stops: Array<{ position: number; color: SdkColor }>;
}

/** A border. */
export interface SdkBorder {
    width: string;
    color: SdkColor;
    style: string;
}

/** A font reference. */
export interface SdkFont {
    family: string;
    weight: number;
    style: string;
}

/** An inline text style. */
export interface SdkTextStyle {
    fontSize?: number | null;
    letterSpacing?: number | null;
    lineHeight?: number | null;
    color?: SdkColor | null;
    alignment?: string | null;
    transform?: string | null;
    decoration?: string | null;
    font?: SdkFont | null;
}

/** An image asset reference. */
export interface SdkImageAsset {
    url: string;
    altText?: string | undefined;
}

/** A CSS length: "12px", "50%", "1fr", "fit-content", "fit-image". */
export type SdkLength = string;

/** The structural node shape consumed by the adapter. */
export interface SdkNode {
    id: string;
    name: string | null;
    nodeType?: string;

    visible?: boolean;
    locked?: boolean;
    opacity?: number;
    rotation?: number;
    overflow?: string | null;
    zIndex?: number | null;

    backgroundColor?: SdkColor | null;
    backgroundGradient?: SdkGradient | null;
    backgroundImage?: SdkImageAsset | null;
    borderRadius?: string | null;
    border?: SdkBorder | null;

    layout?: 'stack' | 'grid' | null;
    stackDirection?: 'horizontal' | 'vertical' | null;
    stackDistribution?: string | null;
    stackAlignment?: string | null;
    stackWrapEnabled?: boolean | null;
    gap?: string | null;
    padding?: string | null;
    gridColumnCount?: number | 'auto-fill' | null;
    gridRowCount?: number | null;
    gridColumnWidth?: number | null;
    gridRowHeight?: number | null;

    position?: 'relative' | 'absolute' | 'fixed' | 'sticky' | null;
    top?: string | null;
    right?: string | null;
    bottom?: string | null;
    left?: string | null;
    width?: SdkLength | null;
    height?: SdkLength | null;
    minWidth?: SdkLength | null;
    maxWidth?: SdkLength | null;
    minHeight?: SdkLength | null;
    maxHeight?: SdkLength | null;
    aspectRatio?: number | null;

    link?: string | null;
    linkOpenInNewTab?: boolean | null;

    svg?: string;
    font?: SdkFont | null;
    inlineTextStyle?: SdkTextStyle | null;

    componentIdentifier?: string;
    componentName?: string | null;
    controls?: Record<string, unknown>;

    getChildren(): Promise<SdkNode[]>;
    getRect(): Promise<SdkRect | null>;
    getText?(): Promise<string | null>;
}

/** Structural type guards used by the adapter. */

/** A text node exposes getText(). */
export function isSdkTextNode(node: SdkNode): boolean {
    return typeof node.getText === 'function';
}

/** An SVG/vector node exposes its raw svg. */
export function isSdkVectorNode(node: SdkNode): boolean {
    return typeof node.svg === 'string';
}

/** A component instance/definition has a component identifier. */
export function isSdkComponentNode(node: SdkNode): boolean {
    return typeof node.componentIdentifier === 'string';
}

/** An image-bearing node has a background image. */
export function isSdkImageNode(node: SdkNode): boolean {
    return Boolean(node.backgroundImage?.url);
}
