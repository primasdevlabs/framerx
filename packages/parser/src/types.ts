/**
 * Minimal Framer SDK node type definitions.
 *
 * These types define the surface of the Framer document that the parser consumes.
 * They are intentionally minimal — the parser only reads what it needs.
 * When running inside the Framer plugin, the real SDK types map onto these.
 */

/** A Framer node in the document tree. */
export interface FramerNode {
    /** The unique ID of the node. */
    id: string;
    /** The type of the node. */
    type: string;
    /** The name of the node. */
    name: string;
    /** The bounding box of the node. */
    frame: FramerFrame;
    /** The child nodes. */
    children?: FramerNode[];
    /** The style properties of the node. */
    style?: FramerStyle;
    /** The layout properties of the node. */
    layout?: FramerLayout;
    /** The text content (for text nodes). */
    text?: FramerText;
    /** The image properties (for image nodes). */
    image?: FramerImage;
    /** The vector properties (for vector nodes). */
    vector?: FramerVector;
    /** The component properties (for component nodes). */
    component?: FramerComponent;
    /** The interactions on the node. */
    interactions?: FramerInteraction[];
    /** The variants of the node (for component nodes). */
    variants?: FramerVariant[];
    /** The props of the node (for component nodes). */
    props?: Record<string, unknown>;
    /**
     * Per-breakpoint overrides (breakpoint name → override). Breakpoint
     * definitions live on the document (`FramerDocument.breakpoints`).
     */
    responsive?: Record<string, FramerResponsiveOverride>;
    /** The source metadata of the node. */
    source?: FramerSource;
}

/** The bounding box of a Framer node. */
export interface FramerFrame {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The style properties of a Framer node. */
export interface FramerStyle {
    /** Background fills. */
    fills?: FramerFill[];
    /** Border strokes. */
    strokes?: FramerStroke[];
    /** Corner radius. */
    radius?: number | FramerCornerRadius;
    /** Box shadows. */
    shadows?: FramerShadow[];
    /** Opacity (0-1). */
    opacity?: number;
    /** Blend mode. */
    blendMode?: string;
    /** Whether the node is visible. */
    visible?: boolean;
    /** Overflow behavior. */
    overflow?: string;
    /** Cursor style. */
    cursor?: string;
    /** Image rendering hint (e.g. 'crisp-edges', 'pixelated'). */
    imageRendering?: string;
    /** CSS transform. */
    transform?: FramerTransform;
    /** CSS filters. */
    filters?: FramerFilter[];
}

/** A fill in a Framer node. */
export interface FramerFill {
    type: 'solid' | 'linear' | 'radial' | 'image';
    color?: string;
    gradient?: FramerGradient;
    image?: FramerImageRef;
    visible?: boolean;
}

/** A gradient in a Framer node. */
export interface FramerGradient {
    angle?: number;
    center?: { x: number; y: number };
    radius?: number;
    stops: Array<{
        position: number;
        color: string;
    }>;
}

/** A stroke in a Framer node. */
export interface FramerStroke {
    fill: FramerFill;
    width: number;
    align?: string;
    dashPattern?: number[];
    visible?: boolean;
}

/** A corner radius in a Framer node. */
export interface FramerCornerRadius {
    topLeft: number;
    topRight: number;
    bottomRight: number;
    bottomLeft: number;
}

/** A shadow in a Framer node. */
export interface FramerShadow {
    color: string;
    offsetX: number;
    offsetY: number;
    blur: number;
    spread: number;
    inset?: boolean;
    visible?: boolean;
}

/** A transform in a Framer node. */
export interface FramerTransform {
    rotate?: number;
    scaleX?: number;
    scaleY?: number;
    skewX?: number;
    skewY?: number;
    translateX?: number;
    translateY?: number;
}

/** A filter in a Framer node. */
export interface FramerFilter {
    type: string;
    value: number;
}

/** The layout properties of a Framer node. */
export interface FramerLayout {
    /** The layout strategy. */
    strategy?: 'flex' | 'grid' | 'absolute' | 'stack' | 'auto';
    /** The flex direction. */
    direction?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
    /** The cross-axis alignment. */
    alignItems?: string;
    /** The main-axis justification. */
    justifyContent?: string;
    /** The flex wrap behavior. */
    flexWrap?: string;
    /** The gap between children. */
    gap?: number;
    /** The row gap (for grid). */
    rowGap?: number;
    /** The column gap (for grid). */
    columnGap?: number;
    /** The grid columns. */
    columns?: number | string[];
    /** The grid rows. */
    rows?: number | string[];
    /** Per-column width in px (when grid is auto-fill or unconstrained). */
    columnWidth?: number;
    /** Per-row height in px (when grid rows is auto / unconstrained). */
    rowHeight?: number;
    /** The padding. */
    padding?: FramerEdgeInsets;
    /** The margin. */
    margin?: FramerEdgeInsets;
    /** The positioning mode. */
    position?: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
    /** The position offsets. */
    offsets?: {
        left?: number;
        top?: number;
        right?: number;
        bottom?: number;
    };
    /** The sizing modes. */
    sizing?: {
        widthMode?: 'fixed' | 'fill' | 'auto' | 'hug';
        heightMode?: 'fixed' | 'fill' | 'auto' | 'hug';
        minWidth?: number;
        maxWidth?: number;
        minHeight?: number;
        maxHeight?: number;
        aspectRatio?: number;
    };
    /** The z-index. */
    zIndex?: number;
}

/** Edge insets in a Framer node. */
export interface FramerEdgeInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/** The text content of a Framer text node. */
export interface FramerText {
    text: string;
    style?: FramerTypography;
    runs?: FramerTextRun[];
}

/** A text run in a Framer text node. */
export interface FramerTextRun {
    text: string;
    style?: FramerTypography;
}

/** The typography style of a Framer text node. */
export interface FramerTypography {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number | string;
    lineHeight?: number;
    letterSpacing?: number;
    color?: string;
    textAlign?: string;
    textDecoration?: string;
    textTransform?: string;
    verticalAlign?: string;
    whiteSpace?: string;
    textOverflow?: string;
    lineClamp?: number;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    textIndent?: number;
    textShadow?: string;
}

/** The image properties of a Framer image node. */
export interface FramerImage {
    src: string;
    name?: string;
    width?: number;
    height?: number;
    mimeType?: string;
    size?: number;
    alt?: string;
    objectFit?: string;
    objectPosition?: string;
    /** Pre-fetched binary data (populated by the exporter before compilation). */
    data?: Uint8Array;
}

/** A reference to an image in a Framer node. */
export interface FramerImageRef {
    src: string;
    name?: string;
    width?: number;
    height?: number;
    mimeType?: string;
    /** Alt text for the image (accessibility). */
    alt?: string;
    /** Pre-fetched binary data (populated by the exporter). */
    data?: Uint8Array;
    /** CSS object-fit for an image fill. */
    objectFit?: 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';
    /** CSS object-position for an image fill. */
    objectPosition?: string;
}

/** The vector properties of a Framer vector node. */
export interface FramerVector {
    svg?: string;
    /** Binary SVG bytes when the source API returned a downloadable asset. */
    data?: Uint8Array;
    pathData?: string;
    src?: string;
    name?: string;
    mimeType?: string;
}

/** The component properties of a Framer component node. */
export interface FramerComponent {
    id: string;
    name: string;
    props?: Record<string, unknown>;
    slots?: Record<string, FramerNode[]>;
    /**
     * The component master (definition) body, when the SDK exposes it.
     *
     * Parsed as a plain container (`type: 'Frame'`) whose children are the
     * definition's real body — including slot placeholder nodes (`type:
     * 'Slot'`) at their true positions. The definition/instance separation
     * pass uses it as the single implementation body, so named slot content
     * and per-slot props come from the master instead of being appended to a
     * synthesized body.
     */
    master?: FramerNode;
    /**
     * The real source of a CODE component (a component with no canvas
     * master), when the SDK exposes the code file. The generator emits this
     * source verbatim as the implementation — the true definition instead of
     * a synthesized approximation. `dependencies` are the transitive closure
     * of code files referenced through relative imports (also emitted).
     */
    code?: {
        /** The full source code of the component file. */
        source: string;
        /** The file name (e.g. `Phosphor.tsx`). */
        fileName: string;
        /** The file path inside the project (e.g. `code/Phosphor.tsx`). */
        path: string;
        /** The export name of the component inside the file. */
        exportName: string;
        /** Whether the component is the file's default export. */
        isDefaultExport: boolean;
        /** Transitive relative-import dependencies (path + source). */
        dependencies?: Array<{ path: string; source: string }>;
        /**
         * Whether the source is a published shared-module bundle fetched from
         * Framer's CDN (the instance's insertURL IS the bundle) rather than a
         * code file from the project itself. The generator adapts these
         * differently: `from 'framer'` rewrites to a local runtime shim, and
         * instances pass content as a `slots` prop (the module contract).
         */
        isModule?: boolean;
    };
}

/** A variant of a Framer component. */
export interface FramerVariant {
    id: string;
    name: string;
    nodes: FramerNode[];
}

/** An interaction on a Framer node. */
export interface FramerInteraction {
    type: string;
    trigger: string;
    target?: string;
    url?: string;
    newTab?: boolean;
    offset?: number;
    smooth?: boolean;
    state?: string;
    name?: string;
    payload?: Record<string, unknown>;
    animation?: FramerAnimation;
}

/** An animation in a Framer interaction. */
export interface FramerAnimation {
    type: 'spring' | 'tween';
    duration?: number;
    delay?: number;
    ease?: string | number[];
    stiffness?: number;
    damping?: number;
    mass?: number;
    bounce?: number;
    repeat?: number;
    repeatType?: string;
    repeatDelay?: number;
    properties?: Record<string, unknown>;
    initial?: Record<string, unknown>;
    exit?: Record<string, unknown>;
    viewport?: {
        amount?: number | string;
        once?: boolean;
        margin?: string;
    };
}

/**
 * A responsive breakpoint definition from the source document.
 *
 * Breakpoints are extracted from the source — never assumed to match
 * Tailwind's sm/md/lg defaults. `minWidth` is the mobile-first threshold in
 * px; a minWidth of 0 is the base (mobile) tier.
 */
export interface FramerBreakpoint {
    name: string;
    minWidth: number;
}

/**
 * A per-breakpoint override of a Framer node's layout/sizing/spacing/style.
 * Keyed by breakpoint name in `FramerNode.responsive`.
 */
export interface FramerResponsiveOverride {
    layout?: {
        direction?: string;
        alignItems?: string;
        justifyContent?: string;
        gap?: number;
        flexWrap?: string;
    };
    sizing?: {
        widthMode?: 'fixed' | 'fill' | 'auto' | 'hug';
        heightMode?: 'fixed' | 'fill' | 'auto' | 'hug';
        /** The explicit width/height in px (fixed overrides). */
        width?: number;
        height?: number;
        minWidth?: number;
        maxWidth?: number;
        minHeight?: number;
        maxHeight?: number;
        aspectRatio?: number;
    };
    spacing?: {
        padding?: FramerEdgeInsets;
    };
    style?: {
        fontSize?: number;
        color?: string;
        opacity?: number;
    };
    visible?: boolean;
    /**
     * The alternate image for this breakpoint — a responsive image swap on a
     * replica, folded into the primary's behavior. Carries the replica's
     * full image ref (src + already-resolved bytes + fit) so the asset
     * collector can ship the alternate as a local file and the generators
     * can swap the rendered image per tier. `src: ''` removes the image.
     */
    image?: FramerImageRef;
}

/** The source metadata of a Framer node. */
export interface FramerSource {
    /** The source platform. */
    platform: string;
    /** The source document ID. */
    documentId?: string;
    /** The source node ID. */
    nodeId?: string;
    /** The source node type. */
    nodeType?: string;
    /**
     * Whether the node is a non-primary breakpoint tier frame (SDK
     * `isBreakpoint` on FrameNode). Its children are the replica tree for
     * that breakpoint; the frame itself is structural, never content.
     */
    isBreakpoint?: boolean;
    /**
     * Whether the node is a replica — a breakpoint/variant override of a
     * primary node (SDK `isReplica`). Replicas inherit from the primary until
     * an attribute is overridden, so they are "override, not a duplicate".
     */
    isReplica?: boolean;
    /** The id of the primary node this replica derives from (SDK `originalId`). */
    originalId?: string | null;
    /**
     * The source breakpoint name whose replica tree this node belongs to
     * (the enclosing breakpoint tier frame's name).
     */
    breakpointName?: string;
}

/** The root Framer document. */
export interface FramerDocument {
    /** The document ID. */
    id: string;
    /** The document name. */
    name: string;
    /** The root nodes of the document. */
    nodes: FramerNode[];
    /** Font files/URLs collected directly from the source API, when exposed. */
    fonts?: import('@framer/compiler-ast').FontAsset[];
    /**
     * The document's responsive breakpoints. When absent, the compiler falls
     * back to its default breakpoint scale (extraction stays honest: the
     * source defines the behavior).
     */
    breakpoints?: FramerBreakpoint[];
    /** The document version. */
    version?: string;
    /** The document metadata. */
    metadata?: Record<string, unknown>;
}