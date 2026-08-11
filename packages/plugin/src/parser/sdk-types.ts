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
    /** Whether the run is italic (overrides the font face's natural style). */
    italic?: boolean | null;
    font?: SdkFont | null;
}

/** An image asset reference. */
export interface SdkImageAsset {
    /**
     * The asset id — stable across every reference to the same uploaded image,
     * so original bytes resolve exactly once per extraction.
     */
    id?: string;
    url?: string | undefined;
    src?: string | undefined;
    altText?: string | undefined;
    /** Downloaded bytes attached by the exporter before source normalization. */
    data?: Uint8Array;
    mimeType?: string;
    objectFit?: 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';
    objectPosition?: string;
    /**
     * The SDK's `ImageAsset.getData()`: the image's ORIGINAL bytes and MIME
     * type. Preferred over a URL fetch or canvas re-encode whenever the SDK
     * object exposes it — the adapter calls this first and falls back to the
     * URL only when it is absent or fails.
     */
    getData?: () => Promise<{ bytes: Uint8Array; mimeType: string }>;
}

/** A shadow reference. */
export interface SdkShadow {
    color?: SdkColor | string;
    x?: number;
    y?: number;
    blur?: number;
    spread?: number;
    inset?: boolean;
    offsetX?: number;
    offsetY?: number;
}

/** A fill reference from Framer SDK. */
export type SdkFill =
    | { type: 'color' | 'solid'; color: SdkColor }
    | { type: 'gradient'; gradient: SdkGradient }
    | { type: 'image'; image?: SdkImageAsset | string; url?: string };

/** A CSS length: "12px", "50%", "1fr", "fit-content", "fit-image". */
export type SdkLength = string;

/** The structural node shape consumed by the adapter. */
export interface SdkNode {
    id: string;
    name: string | null;
    nodeType?: string;

    /**
     * The engine's node class marker (e.g. `"ComponentInstanceNode"`).
     * Used to recognize slot placeholders inside component masters, which
     * have no dedicated public class in this SDK surface.
     */
    classKey?: string;

    visible?: boolean;
    locked?: boolean;
    opacity?: number;
    rotation?: number;
    overflow?: string | null;
    /** CSS cursor value (e.g. `'pointer'`, `'grab'`, `'ew-resize'`). */
    cursor?: string | null;
    /** Image rendering hint (e.g. `'auto'`, `'crisp-edges'`, `'pixelated'`). */
    imageRendering?: string | null;
    zIndex?: number | null;

    backgroundColor?: SdkColor | null;
    backgroundGradient?: SdkGradient | null;
    backgroundImage?: SdkImageAsset | string | null;
    image?: SdkImageAsset | string | null;
    src?: string | null;
    url?: string | null;
    fills?: SdkFill[] | null;
    borderRadius?: string | null;
    border?: SdkBorder | null;
    shadow?: string | SdkShadow | SdkShadow[] | null;
    shadows?: SdkShadow[] | null;
    boxShadow?: string | null;
    blur?: number | string | null;
    filter?: string | null;

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
    /** Downloaded SVG bytes when the source API exposes them separately. */
    svgData?: Uint8Array;
    font?: SdkFont | null;
    inlineTextStyle?: SdkTextStyle | null;

    componentIdentifier?: string;
    componentName?: string | null;
    /** The insertion URL — the secondary key for matching code components. */
    insertURL?: string | null;
    controls?: Record<string, unknown>;

    /**
     * Per-breakpoint responsive overrides (breakpoint name → override) when
     * the SDK exposes them. Deliberately structural: the adapter passes the
     * value through and the compiler-parser normalizes it.
     */
    responsive?: Record<string, unknown> | null;

    getChildren(): Promise<SdkNode[]>;
    getRect(): Promise<SdkRect | null>;
    getText?(): Promise<string | null>;
    getSVG?(): Promise<string | null>;
    getSvg?(): Promise<string | null>;
}

/** Structural type guards used by the adapter. */

/** A text node exposes getText(). */
export function isSdkTextNode(node: SdkNode): boolean {
    return typeof node.getText === 'function';
}

/** An SVG/vector node exposes raw svg property, getSVG() method, or vector type. */
export function isSdkVectorNode(node: SdkNode): boolean {
    if (typeof node.svg === 'string' && node.svg.length > 0) return true;
    if (typeof node.getSVG === 'function' || typeof node.getSvg === 'function') return true;
    const type = node.nodeType?.toLowerCase();
    return type === 'svgnode' || type === 'vectornode' || type === 'shapenode' || type === 'graphicnode';
}

/**
 * A component instance/definition.
 *
 * A `componentIdentifier` is the primary signal, but the engine can leave it
 * empty on instances of shared components (only the component name / insert
 * URL survive). Classifying by `componentName` alone keeps those instances
 * matchable instead of silently demoting them to plain frames — the
 * componentName field exists only on component nodes, so a canvas frame with
 * a display name never trips this.
 */
export function isSdkComponentNode(node: SdkNode): boolean {
    return typeof node.componentIdentifier === 'string' || typeof node.componentName === 'string';
}

/**
 * A slot placeholder inside a component master.
 *
 * The public `@framer/plugin` surface has no dedicated slot node class, so
 * detection is heuristic and best-effort: an engine class key that mentions
 * "slot", or a node named like a slot placeholder. When detection misses,
 * the node parses as a plain container and slot content falls back to the
 * appended-position behavior — never a regression, only lost fidelity.
 */
export function isSdkSlotNode(node: SdkNode): boolean {
    if (typeof node.classKey === 'string' && /slot/i.test(node.classKey)) return true;
    const name = (node.name ?? '').trim();
    return /^slot(?:\b|\s|$)/i.test(name) && name.length <= 24;
}

/**
 * The slot name carried into the model.
 *
 * A generic placeholder name ('Slot', 'slot', 'Children', '') maps to the
 * default children slot; designer-set names (e.g. 'Content', 'Footer') stay,
 * keying the matching per-slot content and props.
 */
export function normalizeSlotName(name: string | null | undefined): string {
    const trimmed = (name ?? '').trim();
    if (!trimmed || /^(slot|children)$/i.test(trimmed)) return 'children';
    return trimmed;
}

/**
 * A responsive breakpoint from the Framer canvas root (name → min-width).
 * Only present when the SDK exposes it — the adapter never invents one.
 */
export interface SdkBreakpoint {
    name: string;
    minWidth: number;
}

/** Extract standard image URL string from various Framer SDK image properties. */
export function getSdkImageUrl(node: SdkNode): string | undefined {
    if (typeof node.backgroundImage === 'string') return node.backgroundImage;
    if (node.backgroundImage && typeof node.backgroundImage === 'object') {
        const url = node.backgroundImage.url ?? node.backgroundImage.src;
        if (url) return url;
    }
    if (typeof node.image === 'string') return node.image;
    if (node.image && typeof node.image === 'object') {
        const url = node.image.url ?? node.image.src;
        if (url) return url;
    }
    if (typeof node.src === 'string' && /^https?:\/\//i.test(node.src)) return node.src;
    if (typeof node.url === 'string' && /^https?:\/\//i.test(node.url)) return node.url;
    return undefined;
}

/** An image-bearing node has an image URL or image fill. */
export function isSdkImageNode(node: SdkNode): boolean {
    return Boolean(getSdkImageUrl(node));
}
