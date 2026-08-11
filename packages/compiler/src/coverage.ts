/**
 * Source Property Coverage — the keystone fidelity diagnostic.
 *
 * Every Framer SDK property the plugin can read should survive through
 * the Framer → FramerDocument → DesignAST → generated code pipeline.
 * This module classifies each known property into one of:
 *
 *   discovered   — present on at least one source node (Framer doc)
 *   preserved    — survives into the DesignAST on every node that has it
 *   emitted      — the generator actually writes it into the React/CSS
 *   unsupported  — known to exist but not currently supported (warn)
 *   lost         — read but neither preserved in AST nor emitted (bug)
 *
 * Output is both machine-readable (for CI regression tests) and
 * human-readable (for the plugin's diagnostic panel).
 *
 * The registry below is the SOURCE OF TRUTH for known Framer SDK
 * properties. New SDK fields can be added by listing them in
 * SOURCE_PROPERTIES — coverage analysis auto-classifies them on the
 * next run. Unknown keys we still discover are reported separately as
 * undocumented properties so we know what the SDK exposes that we have
 * not yet cataloged.
 */

import type { DesignDocument, DesignNode } from '@framer/compiler-ast';
import type { FramerDocument, FramerNode } from '@framer/compiler-parser';
import type { VirtualFile } from '@framer/compiler-generators';

/** A logical "lifecycle stage" of a property. */
export type CoverageStage =
    | 'discovered'
    | 'framer-preserved'
    | 'ast-preserved'
    | 'emitted'
    | 'unsupported'
    | 'lost';

/** A single known Framer SDK property. */
export interface SourceProperty {
    /** Stable id (used in coverage reports and tests). */
    id: string;
    /** Human-readable name (used for warnings / UI). */
    name: string;
    /** Framer SDK attribute name (the property read off an SDK node). */
    sdkAttribute: string;
    /** Path on the FramerDocument/FramerNode tree where the value lands. */
    framerNodePath: string;
    /** Path on the DesignAST where the value should land. */
    designAstPath: string;
    /** What kind of value carries it (used to introspect the source). */
    kind: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'color' | 'gradient' | 'shadow' | 'image';
    /** A path expression inside the emitted code where the property lands when preserved end-to-end. */
    emittedAs?: string;
    /** Whether this property is category-unimplemented by the current compiler. */
    unsupported?: boolean;
    /** A short reason for the unsupported marker (shown in UI). */
    unsupportedReason?: string;
}

/**
 * The registry of every Framer SDK property we are tracking for fidelity.
 *
 * Each property carries a `framerNodePath` that may use:
 *   - dot-notation: `style.fills`
 *   - array-index: `style.fills[0]`
 *   - array-predicate: `interactions[trigger=tap].animation` — iterates the
 *     `interactions[]` array and matches the first entry whose own `trigger`
 *     field equals `tap`. This is how per-trigger animation properties stay
 *     separated in the coverage report.
 *
 * New SDK attributes MUST be added here: the analyzer keys off `id`, so an
 * unlisted attribute is simply reported as "undocumented" — never as
 * silently lost. This is how we avoid silent drops (Item #29 of the spec).
 */
export const SOURCE_PROPERTIES: readonly SourceProperty[] = Object.freeze([
    // ── Node identity & structure ─────────────────────────────────────
    { id: 'node.id', name: 'Node id', sdkAttribute: 'id', framerNodePath: 'id', designAstPath: 'id', kind: 'string', emittedAs: 'key prop / className hash' },
    { id: 'node.name', name: 'Node name', sdkAttribute: 'name', framerNodePath: 'name', designAstPath: 'name', kind: 'string', emittedAs: 'component identifier (sanitized)' },
    { id: 'node.rect', name: 'Bounding rect', sdkAttribute: 'getRect()', framerNodePath: 'frame', designAstPath: 'frame', kind: 'object', emittedAs: 'inline width/height (Tailwind/CSS)' },
    // Replica identity (SDK `isReplica` + `originalId`): a breakpoint/variant
    // override of a primary node, NOT a duplicate. Resolved replicas are
    // folded into their primary's responsive behavior (and counted in the
    // manifest's `replicas` section); replica nodes that SURVIVE the fold
    // (unresolved — kept as independent nodes) are marked `replicaOf` in the
    // AST, so the identity is tracked through every stage of the pipeline.
    { id: 'source.isReplica', name: 'Replica identity (breakpoint/variant override)', sdkAttribute: 'isReplica', framerNodePath: 'source.isReplica', designAstPath: 'metadata.custom.replicaOf', kind: 'boolean', emittedAs: 'export-manifest.json `replicas` section (replica folding counts)' },

    // ── Layout: strategy/shape ────────────────────────────────────────
    { id: 'layout.strategy', name: 'Layout strategy (stack / grid / auto)', sdkAttribute: 'layout', framerNodePath: 'layout.strategy', designAstPath: 'layout.style.strategy', kind: 'string', emittedAs: 'flex / grid / block' },
    { id: 'layout.stackDirection', name: 'Stack direction', sdkAttribute: 'stackDirection', framerNodePath: 'layout.direction', designAstPath: 'layout.style.direction', kind: 'string', emittedAs: 'flex-row / flex-col' },
    { id: 'layout.stackDistribution', name: 'Stack distribution', sdkAttribute: 'stackDistribution', framerNodePath: 'layout.justifyContent', designAstPath: 'layout.style.justifyContent', kind: 'string', emittedAs: 'justify-* Tailwind / inline style' },
    { id: 'layout.stackAlignment', name: 'Stack alignment', sdkAttribute: 'stackAlignment', framerNodePath: 'layout.alignItems', designAstPath: 'layout.style.alignItems', kind: 'string', emittedAs: 'items-* Tailwind / inline style' },
    { id: 'layout.stackWrapEnabled', name: 'Stack wrap', sdkAttribute: 'stackWrapEnabled', framerNodePath: 'layout.flexWrap', designAstPath: 'layout.style.flexWrap', kind: 'string', emittedAs: 'flex-wrap (when wrap=true) — nowrap is the documented Tailwind default and emits no extra class' },
    { id: 'layout.gap', name: 'Stack gap', sdkAttribute: 'gap', framerNodePath: 'layout.gap', designAstPath: 'layout.style.gap', kind: 'string', emittedAs: 'gap-N Tailwind / inline style' },
    { id: 'layout.padding', name: 'Padding', sdkAttribute: 'padding', framerNodePath: 'layout.padding', designAstPath: 'layout.spacing.padding', kind: 'string', emittedAs: 'p-/px-/py-* Tailwind / inline style' },
    { id: 'layout.gridColumnCount', name: 'Grid columns', sdkAttribute: 'gridColumnCount', framerNodePath: 'layout.columns', designAstPath: 'layout.style.columns', kind: 'string', emittedAs: 'grid-cols-*' },
    { id: 'layout.gridRowCount', name: 'Grid rows', sdkAttribute: 'gridRowCount', framerNodePath: 'layout.rows', designAstPath: 'layout.style.rows', kind: 'string', emittedAs: 'grid-rows-*' },
    // Grid column width — Framer's per-column fixed width in pixels (typically used
    // with `auto-fill`). Generator emits `grid-template-columns: repeat(N, Xpx)`.
    { id: 'layout.gridColumnWidth', name: 'Grid column width', sdkAttribute: 'gridColumnWidth', framerNodePath: 'layout.columnWidth', designAstPath: 'layout.style.columnWidth', kind: 'number', emittedAs: 'inline `gridTemplateColumns: repeat(<cols>, <columnWidth>px)` on grid nodes' },
    // Grid row height — symmetric counterpart of gridColumnWidth for row sizing.
    { id: 'layout.gridRowHeight', name: 'Grid row height', sdkAttribute: 'gridRowHeight', framerNodePath: 'layout.rowHeight', designAstPath: 'layout.style.rowHeight', kind: 'number', emittedAs: 'inline `gridTemplateRows: repeat(<rows>, <rowHeight>px)` on grid nodes' },

    { id: 'layout.position', name: 'CSS position', sdkAttribute: 'position', framerNodePath: 'layout.position', designAstPath: 'layout.position.mode', kind: 'string', emittedAs: 'relative / absolute className or inline `position:` (static is the documented default — no extra emission)' },
    { id: 'layout.top', name: 'Top offset', sdkAttribute: 'top', framerNodePath: 'layout.offsets.top', designAstPath: 'layout.position.top', kind: 'string', emittedAs: 'top-N inline style' },
    { id: 'layout.right', name: 'Right offset', sdkAttribute: 'right', framerNodePath: 'layout.offsets.right', designAstPath: 'layout.position.right', kind: 'string', emittedAs: 'right-N inline style' },
    { id: 'layout.bottom', name: 'Bottom offset', sdkAttribute: 'bottom', framerNodePath: 'layout.offsets.bottom', designAstPath: 'layout.position.bottom', kind: 'string', emittedAs: 'bottom-N inline style' },
    { id: 'layout.left', name: 'Left offset', sdkAttribute: 'left', framerNodePath: 'layout.offsets.left', designAstPath: 'layout.position.left', kind: 'string', emittedAs: 'left-N inline style' },
    { id: 'layout.zIndex', name: 'Stacking order', sdkAttribute: 'zIndex', framerNodePath: 'layout.zIndex', designAstPath: 'layout.position.zIndex', kind: 'number', emittedAs: 'z-N / z-[N]' },

    // ── Sizing ────────────────────────────────────────────────────────
    { id: 'sizing.width', name: 'Width', sdkAttribute: 'width', framerNodePath: 'layout.sizing.widthMode', designAstPath: 'layout.sizing.widthMode/width', kind: 'string', emittedAs: 'w-N / w-full / w-fit' },
    { id: 'sizing.height', name: 'Height', sdkAttribute: 'height', framerNodePath: 'layout.sizing.heightMode', designAstPath: 'layout.sizing.heightMode/height', kind: 'string', emittedAs: 'h-N / h-full / h-fit' },
    { id: 'sizing.minWidth', name: 'Min width', sdkAttribute: 'minWidth', framerNodePath: 'layout.sizing.minWidth', designAstPath: 'layout.sizing.minWidth', kind: 'string', emittedAs: 'min-w-N' },
    { id: 'sizing.maxWidth', name: 'Max width', sdkAttribute: 'maxWidth', framerNodePath: 'layout.sizing.maxWidth', designAstPath: 'layout.sizing.maxWidth', kind: 'string', emittedAs: 'max-w-N' },
    { id: 'sizing.minHeight', name: 'Min height', sdkAttribute: 'minHeight', framerNodePath: 'layout.sizing.minHeight', designAstPath: 'layout.sizing.minHeight', kind: 'string', emittedAs: 'min-h-N' },
    { id: 'sizing.maxHeight', name: 'Max height', sdkAttribute: 'maxHeight', framerNodePath: 'layout.sizing.maxHeight', designAstPath: 'layout.sizing.maxHeight', kind: 'string', emittedAs: 'max-h-N' },
    { id: 'sizing.aspectRatio', name: 'Aspect ratio', sdkAttribute: 'aspectRatio', framerNodePath: 'layout.sizing.aspectRatio', designAstPath: 'layout.sizing.aspectRatio', kind: 'number', emittedAs: 'aspect-[N/N]' },

    // ── Style ─────────────────────────────────────────────────────────
    { id: 'style.backgroundColor', name: 'Background color', sdkAttribute: 'backgroundColor', framerNodePath: 'style.fills[0].color', designAstPath: 'style.fills[0].color', kind: 'color', emittedAs: 'bg-* / tokens.yourColor' },
    { id: 'style.backgroundGradient', name: 'Background gradient', sdkAttribute: 'backgroundGradient', framerNodePath: 'style.fills[0].gradient', designAstPath: 'style.fills[0].gradient', kind: 'gradient', emittedAs: 'inline linear/radial gradient' },
    { id: 'style.fills', name: 'Fill list', sdkAttribute: 'fills', framerNodePath: 'style.fills', designAstPath: 'style.fills', kind: 'array', emittedAs: 'stacked CSS backgrounds / palette refs' },
    { id: 'style.stroke', name: 'Border', sdkAttribute: 'border', framerNodePath: 'style.strokes[0]', designAstPath: 'style.strokes[0]', kind: 'object', emittedAs: 'border-* Tailwind / inline border' },
    { id: 'style.borderRadius', name: 'Corner radius', sdkAttribute: 'borderRadius', framerNodePath: 'style.radius', designAstPath: 'style.radius', kind: 'object', emittedAs: 'rounded-N / inline border-radius' },
    { id: 'style.shadow', name: 'Shadow', sdkAttribute: 'shadow(s)', framerNodePath: 'style.shadows[0]', designAstPath: 'style.shadows[0]', kind: 'shadow', emittedAs: 'shadow-* / inline box-shadow' },
    { id: 'style.blur', name: 'Blur', sdkAttribute: 'blur', framerNodePath: 'style.filters[type=blur]', designAstPath: 'style.filters[type=blur]', kind: 'number', emittedAs: 'blur-N / inline filter' },
    { id: 'style.opacity', name: 'Opacity', sdkAttribute: 'opacity', framerNodePath: 'style.opacity', designAstPath: 'style.opacity', kind: 'number', emittedAs: 'opacity-N' },
    { id: 'style.visible', name: 'Visible', sdkAttribute: 'visible', framerNodePath: 'style.visible', designAstPath: 'style.visible', kind: 'boolean', emittedAs: 'hidden className' },
    { id: 'style.overflow', name: 'Overflow', sdkAttribute: 'overflow', framerNodePath: 'style.overflow', designAstPath: 'style.overflow', kind: 'string', emittedAs: 'overflow-* / inline' },
    { id: 'style.rotation', name: 'Rotation', sdkAttribute: 'rotation', framerNodePath: 'style.transform.rotate', designAstPath: 'style.transform.rotate', kind: 'number', emittedAs: '[transform:rotate(Ndeg)]' },
    // CSS cursor — the SDK exposes an arbitrary CSS cursor string. Tailwind
    // only covers a small set of named cursor utilities, so the generator
    // emits the verbatim value as inline `cursor: '<value>'`.
    { id: 'style.cursor', name: 'Cursor', sdkAttribute: 'cursor', framerNodePath: 'style.cursor', designAstPath: 'style.cursor', kind: 'string', emittedAs: 'inline `cursor: <value>` when the source specifies a cursor (Tailwind only covers named utilities like `cursor-pointer`)' },
    // Image rendering hint — directive for image scaling (auto, crisp-edges,
    // pixelated). Tailwind does not cover this; emitted verbatim inline.
    { id: 'style.imageRendering', name: 'Image rendering', sdkAttribute: 'imageRendering', framerNodePath: 'style.imageRendering', designAstPath: 'style.imageRendering', kind: 'string', emittedAs: 'inline `imageRendering: <value>` when the source specifies a rendering hint' },

    // ── Typography ────────────────────────────────────────────────────
    { id: 'text.fontFamily', name: 'Font family', sdkAttribute: 'font.family', framerNodePath: 'text.style.fontFamily', designAstPath: 'text.style.fontFamily', kind: 'string', emittedAs: 'font-{family} tokens / inline style' },
    { id: 'text.fontWeight', name: 'Font weight', sdkAttribute: 'font.weight', framerNodePath: 'text.style.fontWeight', designAstPath: 'text.style.fontWeight', kind: 'string', emittedAs: 'font-{weight} + @font-face generation' },
    // `font.style` is the italic-style string the SDK exposes on each text
    // node's font face. We deliberately do NOT synthesize 'normal' on every
    // text node (that would mask genuine drops); the value is only present
    // when the source actually has italic.
    { id: 'text.italic', name: 'Italic (font.style)', sdkAttribute: 'font.style', framerNodePath: 'text.style.italic', designAstPath: 'text.style.italic', kind: 'boolean', emittedAs: 'italic className / fontFamily variant' },
    { id: 'text.fontSize', name: 'Font size', sdkAttribute: 'inlineTextStyle.fontSize', framerNodePath: 'text.style.fontSize', designAstPath: 'text.style.fontSize', kind: 'number', emittedAs: 'text-[Npx] / fontSize inline' },
    { id: 'text.lineHeight', name: 'Line height', sdkAttribute: 'inlineTextStyle.lineHeight', framerNodePath: 'text.style.lineHeight', designAstPath: 'text.style.lineHeight', kind: 'number', emittedAs: 'leading-N / lineHeight inline' },
    { id: 'text.letterSpacing', name: 'Letter spacing', sdkAttribute: 'inlineTextStyle.letterSpacing', framerNodePath: 'text.style.letterSpacing', designAstPath: 'text.style.letterSpacing', kind: 'number', emittedAs: 'tracking-N / letterSpacing inline' },
    { id: 'text.color', name: 'Text color', sdkAttribute: 'inlineTextStyle.color', framerNodePath: 'text.style.color', designAstPath: 'text.style.color', kind: 'color', emittedAs: 'text-{color} / palette ref' },
    { id: 'text.alignment', name: 'Text alignment', sdkAttribute: 'inlineTextStyle.alignment', framerNodePath: 'text.style.textAlign', designAstPath: 'text.style.textAlign', kind: 'string', emittedAs: 'text-{align}' },
    { id: 'text.transform', name: 'Text transform', sdkAttribute: 'inlineTextStyle.transform', framerNodePath: 'text.style.textTransform', designAstPath: 'text.style.textTransform', kind: 'string', emittedAs: 'uppercase / lowercase / capitalize' },
    { id: 'text.decoration', name: 'Text decoration', sdkAttribute: 'inlineTextStyle.decoration', framerNodePath: 'text.style.textDecoration', designAstPath: 'text.style.textDecoration', kind: 'string', emittedAs: 'underline / line-through' },
    { id: 'text.italicInline', name: 'Italic (inline text style)', sdkAttribute: 'inlineTextStyle.italic', framerNodePath: 'text.style.italic', designAstPath: 'text.style.italic', kind: 'boolean', emittedAs: 'italic className / fontFamily variant' },

    // ── Asset references ──────────────────────────────────────────────
    // asset.image has two emission signals: (1) when local bytes are
    // available, the generator writes the file under src/assets/images/…
    // and the importer imports `'/assets/images/<name>'`; (2) when only
    // a remote URL is available (no bytes from the SDK), the generator
    // emits `<img src="<url>">` plus a placeholder note explaining the
    // missing local copy. The needle `'<img'` covers both signals.
    { id: 'asset.image', name: 'Image source', sdkAttribute: 'backgroundImage | image | src | url', framerNodePath: 'image.src', designAstPath: 'asset.src', kind: 'image', emittedAs: '<img src=…> (with local copy when bytes are available, else placeholder note for the remote URL)' },
    { id: 'asset.svg', name: 'SVG / vector', sdkAttribute: 'svg / getSVG()', framerNodePath: 'vector.svg', designAstPath: 'asset.text', kind: 'object', emittedAs: 'src/assets/svg/*.svg or inline <svg>' },
    { id: 'asset.alt', name: 'Alt text', sdkAttribute: 'backgroundImage.altText', framerNodePath: 'image.alt', designAstPath: 'asset.alt', kind: 'string', emittedAs: '<img alt="...">' },

    // ── Components ────────────────────────────────────────────────────
    { id: 'component.identifier', name: 'Component identifier', sdkAttribute: 'componentIdentifier', framerNodePath: 'component.id', designAstPath: 'componentId', kind: 'string', emittedAs: 'import path key' },
    { id: 'component.name', name: 'Component name', sdkAttribute: 'componentName', framerNodePath: 'component.name', designAstPath: 'componentName', kind: 'string', emittedAs: 'component file name' },
    { id: 'component.props', name: 'Component props', sdkAttribute: 'controls', framerNodePath: 'component.props', designAstPath: 'props', kind: 'object', emittedAs: '<Component prop={...} /> JSX props' },
    { id: 'component.slots', name: 'Slot placeholders', sdkAttribute: '(master body) named slot nodes', framerNodePath: 'component.slots', designAstPath: 'slots', kind: 'object', emittedAs: 'children JSX content + per-slot props' },
    { id: 'component.master', name: 'Master body', sdkAttribute: '(canvas master)', framerNodePath: 'component.master', designAstPath: 'template.metadata.custom.masterBody', kind: 'object', emittedAs: 'export-manifest.json `fromMasters` count when ≥1 master body was preserved end-to-end' },
    { id: 'component.code', name: 'Code component source', sdkAttribute: 'getCodeFiles()', framerNodePath: 'component.code', designAstPath: 'metadata.custom.code', kind: 'object', emittedAs: 'verbatim source under src/code/' },

    // ── Interaction ───────────────────────────────────────────────────
    { id: 'interaction.link', name: 'Link interaction', sdkAttribute: 'link', framerNodePath: 'interactions[type=link]', designAstPath: 'interactions.onClick[type=link]', kind: 'object', emittedAs: '<Link href="..."> or <a target="_blank">' },

    // ── Animation ─────────────────────────────────────────────────────
    // Every trigger uses its own predicate-keyed path so the source walker
    // counts hover/tap/mount/viewport entries separately instead of
    // collapsing every interaction with `animation` onto a single property.
    { id: 'animation.hover', name: 'Hover animation', sdkAttribute: '(interaction.animation)', framerNodePath: 'interactions[trigger=hover].animation', designAstPath: 'animations.animations[trigger=hover]', kind: 'object', emittedAs: 'whileHover motion props' },
    { id: 'animation.tap', name: 'Tap animation', sdkAttribute: '(interaction.animation)', framerNodePath: 'interactions[trigger=tap].animation', designAstPath: 'animations.animations[trigger=tap]', kind: 'object', emittedAs: 'whileTap motion props' },
    { id: 'animation.mount', name: 'Mount animation', sdkAttribute: '(interaction.animation)', framerNodePath: 'interactions[trigger=animate].animation', designAstPath: 'animations.animations[trigger=mount]', kind: 'object', emittedAs: 'initial + animate motion props' },
    { id: 'animation.viewport', name: 'Viewport animation', sdkAttribute: '(interaction.animation.viewport)', framerNodePath: 'interactions[trigger=whileInView].animation.viewport', designAstPath: 'animations.animations[trigger=viewport]', kind: 'object', emittedAs: 'whileInView motion props' },
]);

/**
 * Tokenize a coverage path into segments.
 *
 * Supports dot-separated property access plus bracketed array syntax:
 *  - numeric: `style.fills[0]`
 *  - predicate: `animations.animations[trigger=tap]`
 *
 * Each bracket is one full token (`[trigger=tap]`); the closing `]` is
 * consumed by the tokenizer, not re-emitted as its own segment.
 */
function tokenizePath(path: string): string[] {
    const tokens: string[] = [];
    let buffer = '';
    for (let i = 0; i < path.length; i += 1) {
        const char = path[i];
        if (char === '.') {
            if (buffer) {
                tokens.push(buffer);
                buffer = '';
            }
        } else if (char === '[') {
            if (buffer) {
                tokens.push(buffer);
                buffer = '';
            }
            // Bracket ends at the matching `]`. The closing `]` is not a
            // token of its own — the bracket expression IS the segment.
            const close = path.indexOf(']', i);
            if (close < 0) {
                // Malformed path: treat the rest as raw text.
                tokens.push('[' + path.slice(i + 1));
                return tokens;
            }
            tokens.push(path.slice(i, close + 1));
            i = close; // Skip past the closing `]` (outer loop adds 1).
        } else {
            buffer += char;
        }
    }
    if (buffer) tokens.push(buffer);
    return tokens;
}

/**
 * Read a nested object path supporting array indices, including predicates.
 *
 * Two index syntaxes are supported:
 *  - numeric → `style.fills[0]` reads the first array entry.
 *  - predicate → `animations.animations[trigger=tap]` iterates the array and
 *    returns the first entry whose own `trigger` field equals `tap`.
 *
 * Returns undefined when any segment along the path is missing or when a
 * predicate finds no matching array entry.
 */
function readPath(input: unknown, path: string): unknown {
    if (input == null) return undefined;
    const segments = tokenizePath(path);
    let value: unknown = input;
    for (const segment of segments) {
        if (value == null) return undefined;
        if (segment.startsWith('[')) {
            if (!Array.isArray(value)) return undefined;
            const inner = segment.slice(1, -1);
            const eqIndex = inner.indexOf('=');
            if (eqIndex >= 0) {
                const key = inner.slice(0, eqIndex);
                const wanted = inner.slice(eqIndex + 1);
                const match = value.find((entry) => {
                    if (entry == null || typeof entry !== 'object') return false;
                    return String((entry as Record<string, unknown>)[key]) === wanted;
                });
                if (!match) return undefined;
                value = match;
            } else {
                const index = Number(inner);
                if (!Number.isFinite(index)) return undefined;
                value = value[index];
            }
        } else {
            if (typeof value !== 'object') return undefined;
            value = (value as Record<string, unknown>)[segment];
        }
    }
    return value;
}

/** A robot-truthful definition that the value at this path is "present". */
function isPresent(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.length > 0 && value !== '0';
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return true;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value as object).length > 0;
    return false;
}

/**
 * Whether a coverage path uses the predicate-style array index
 * (`[key=value]`). Such paths cannot be resolved through the SDL-shape
 * shortcut and must be walked directly against the FramerDocument.
 */
export function hasPredicateIndex(path: string): boolean {
    return /\[[^\]]+=[^\]]+\]/.test(path);
}

/** Build the SDK-shaped node map (matches the plugin adapter path-keyed names). */
function toSdkShape(framerNode: FramerNode, sdkShape: Record<string, unknown>): void {
    sdkShape['id'] = framerNode.id;
    sdkShape['name'] = framerNode.name;
    sdkShape['getRect()'] = framerNode.frame;
    // Layout (already in Framer-layout shape).
    sdkShape['layout'] = framerNode.layout?.strategy;
    sdkShape['stackDirection'] = framerNode.layout?.direction;
    sdkShape['stackDistribution'] = framerNode.layout?.justifyContent;
    sdkShape['stackAlignment'] = framerNode.layout?.alignItems;
    sdkShape['stackWrapEnabled'] = framerNode.layout?.flexWrap;
    sdkShape['gap'] = framerNode.layout?.gap;
    sdkShape['padding'] = framerNode.layout?.padding;
    sdkShape['gridColumnCount'] = framerNode.layout?.columns;
    sdkShape['gridRowCount'] = framerNode.layout?.rows;
    sdkShape['position'] = framerNode.layout?.position;
    sdkShape['top'] = framerNode.layout?.offsets?.top;
    sdkShape['right'] = framerNode.layout?.offsets?.right;
    sdkShape['bottom'] = framerNode.layout?.offsets?.bottom;
    sdkShape['left'] = framerNode.layout?.offsets?.left;
    sdkShape['zIndex'] = framerNode.layout?.zIndex;
    sdkShape['width'] = framerNode.layout?.sizing?.widthMode;
    sdkShape['height'] = framerNode.layout?.sizing?.heightMode;
    sdkShape['minWidth'] = framerNode.layout?.sizing?.minWidth;
    sdkShape['maxWidth'] = framerNode.layout?.sizing?.maxWidth;
    sdkShape['minHeight'] = framerNode.layout?.sizing?.minHeight;
    sdkShape['maxHeight'] = framerNode.layout?.sizing?.maxHeight;
    sdkShape['aspectRatio'] = framerNode.layout?.sizing?.aspectRatio;
    // Style.
    sdkShape['backgroundColor'] = framerNode.style?.fills?.find?.((fill) => fill?.type === 'solid')?.type === 'solid'
        ? (framerNode.style?.fills?.find?.((fill) => fill?.type === 'solid') as { color?: string } | undefined)?.color
        : undefined;
    sdkShape['backgroundGradient'] = framerNode.style?.fills?.find?.((fill) => fill?.type === 'linear' || fill?.type === 'radial');
    sdkShape['fills'] = framerNode.style?.fills;
    sdkShape['border'] = framerNode.style?.strokes?.[0];
    sdkShape['borderRadius'] = framerNode.style?.radius;
    sdkShape['shadow(s)'] = framerNode.style?.shadows;
    sdkShape['blur'] = framerNode.style?.filters?.find?.((filter) => typeof filter === 'object' && (filter as { type?: string }).type === 'blur');
    sdkShape['opacity'] = framerNode.style?.opacity;
    sdkShape['visible'] = framerNode.style?.visible;
    sdkShape['overflow'] = framerNode.style?.overflow;
    sdkShape['rotation'] = framerNode.style?.transform?.rotate;
    sdkShape['cursor'] = framerNode.style?.cursor;
    sdkShape['imageRendering'] = framerNode.style?.imageRendering;
    sdkShape['gridColumnWidth'] = framerNode.layout?.columnWidth;
    sdkShape['gridRowHeight'] = framerNode.layout?.rowHeight;
    // Typography (single source: text.style). For `font.style` we deliberately
    // DO NOT synthesize 'normal' — that would inflate the discovery count for
    // every text node and mask real italics that get dropped.
    sdkShape['font.family'] = framerNode.text?.style?.fontFamily;
    sdkShape['font.weight'] = framerNode.text?.style?.fontWeight;
    sdkShape['font.style'] = framerNode.text?.style?.italic === true ? 'italic' : undefined;
    sdkShape['inlineTextStyle.fontSize'] = framerNode.text?.style?.fontSize;
    sdkShape['inlineTextStyle.lineHeight'] = framerNode.text?.style?.lineHeight;
    sdkShape['inlineTextStyle.letterSpacing'] = framerNode.text?.style?.letterSpacing;
    sdkShape['inlineTextStyle.color'] = framerNode.text?.style?.color;
    sdkShape['inlineTextStyle.alignment'] = framerNode.text?.style?.textAlign;
    sdkShape['inlineTextStyle.transform'] = framerNode.text?.style?.textTransform;
    sdkShape['inlineTextStyle.decoration'] = framerNode.text?.style?.textDecoration;
    sdkShape['inlineTextStyle.italic'] = framerNode.text?.style?.italic;
    // Asset references.
    sdkShape['backgroundImage | image | src | url'] = framerNode.image?.src ?? firstImageFill(framerNode.style?.fills);
    // Components.
    sdkShape['componentIdentifier'] = framerNode.component?.id;
    sdkShape['componentName'] = framerNode.component?.name;
    sdkShape['controls'] = framerNode.component?.props;
    // Interaction.
    sdkShape['link'] = linkInteraction(framerNode);
    sdkShape['(interaction.animation)'] = framerNode.interactions?.find?.((interaction) => interaction?.animation != null)?.animation;
    sdkShape['(interaction.animation.viewport)'] = framerNode.interactions?.find?.((interaction) => interaction?.animation?.viewport != null)?.animation?.viewport;
}

/** Find the first link interaction's URL. */
function linkInteraction(framerNode: FramerNode): string | undefined {
    for (const interaction of framerNode.interactions ?? []) {
        if (interaction?.type === 'link') return interaction.url;
    }
    return undefined;
}

/** Find the first image-bearing fill's source URL. */
function firstImageFill(fills: ReadonlyArray<{ type?: string; image?: { src?: string } }> | undefined): string | undefined {
    if (!fills) return undefined;
    for (const fill of fills) {
        if (fill?.type === 'image') {
            const src = fill.image?.src;
            if (src) return src;
        }
    }
    return undefined;
}

/** Walk every node in a FramerDocument tree. */
function walkFramer(roots: FramerNode[], visit: (node: FramerNode) => void): void {
    const recurse = (node: FramerNode): void => {
        visit(node);
        for (const child of node.children ?? []) recurse(child);
        if (node.component?.slots) {
            for (const slotNodes of Object.values(node.component.slots)) {
                for (const slotNode of slotNodes) recurse(slotNode);
            }
        }
        if (node.variants) {
            for (const variant of node.variants) {
                for (const variantNode of variant.nodes) recurse(variantNode);
            }
        }
    };
    for (const root of roots) recurse(root);
}

/** Walk every node in a Design AST tree (templates + slots included). */
function walkDesign(roots: DesignNode[], visit: (node: DesignNode) => void): void {
    const recurse = (node: DesignNode): void => {
        visit(node);
        for (const child of node.children) recurse(child);
        if (node.type === 'component' && node.template) recurse(node.template);
        if (node.type === 'component' && node.slots) {
            for (const slotNodes of Object.values(node.slots)) {
                for (const slotNode of slotNodes) recurse(slotNode);
            }
        }
    };
    for (const root of roots) recurse(root);
}

/**
 * A single coverage report entry — one per registered SourceProperty.
 */
export interface PropertyCoverage {
    id: string;
    name: string;
    sdkAttribute: string;
    emittedAs?: string;
    /** Number of source nodes where the property was discovered. */
    discoveredCount: number;
    /** Whether the property appears at least once in the source. */
    discovered: boolean;
    /** Whether the property appears at least once in the DesignAST. */
    preserved: boolean;
    /** Whether the property appears at least once in the generated code (skipped when emittedAs is undefined). */
    emitted: boolean;
    /** Whether this property is currently mark-unsupported. */
    unsupported: boolean;
    unsupportedReason?: string;
    /** The classification stage the property is currently in. */
    stage: CoverageStage;
}

/** Aggregated coverage report. */
export interface CoverageReport {
    /** Per-property coverage by `SourceProperty.id`. */
    properties: PropertyCoverage[];
    /** Properties present in the source that we have not yet registered. */
    undocumentedSdKKeys: string[];
    /** Convenience counts. */
    summary: {
        /** Total registered properties. */
        registered: number;
        /** Discovered on at least one source node. */
        discovered: number;
        /** Preserved in the DesignAST on at least one matching node. */
        preserved: number;
        /** Emitted into generated code on at least one node. */
        emitted: number;
        /** Known but unsupported. */
        unsupported: number;
        /** Lost (discovered on source but neither preserved nor emitted). */
        lost: number;
    };
    /**
     * The presence of a property in the generated code is detected by simple
     * needle matching. Each property that `emittedAs` lists is searched for
     * that string in the union of file contents. A hit on any single file is
     * enough to claim `emitted = true`.
     */
    fileEmittedHints: Record<string, string>;
}

/**
 * Compute the Source Property Coverage report for a Framer document → AST →
 * generated-code pipeline run.
 */
export function collectCoverage(input: { source: FramerDocument; ast: DesignDocument; files: VirtualFile[] }): CoverageReport {
    const sourceNodes: FramerNode[] = input.source.nodes;
    const astNodes: DesignNode[] = input.ast.nodes;

    /** Discovered flag per registered property — derived from the source shape. */
    const discoveredOnSource = new Map<string, { count: number }>();
    walkFramer(sourceNodes, (node) => {
        const sdkShape: Record<string, unknown> = {};
        toSdkShape(node, sdkShape);
        for (const property of SOURCE_PROPERTIES) {
            // Properties whose framerNodePath is predicate-keyed MUST be
            // resolved through readPath on the actual FramerDocument — the
            // SDK-shape probe cannot distinguish between hover/tap/mount
            // interactions that share the same `(interaction.animation)`
            // value, and using it would over-count every trigger variant.
            const value = hasPredicateIndex(property.framerNodePath)
                ? readPath(node, property.framerNodePath)
                : (sdkShape[property.sdkAttribute] ?? readPath(node, property.framerNodePath));
            if (!isPresent(value)) continue;
            const existing = discoveredOnSource.get(property.id) ?? { count: 0 };
            existing.count += 1;
            discoveredOnSource.set(property.id, existing);
        }
    });

    /** Preserved flag per registered property — derived from the DesignAST. */
    const preservedOnAst = new Set<string>();
    walkDesign(astNodes, (node) => {
        for (const property of SOURCE_PROPERTIES) {
            const value = readPath(node, property.designAstPath);
            if (!isPresent(value)) continue;
            preservedOnAst.add(property.id);
        }
    });

    /** Emitted flag — needle match across the union of all generated file contents. */
    const emittedHintMap: Record<string, string[]> = {};
    for (const property of SOURCE_PROPERTIES) {
        if (!property.emittedAs) continue;
        // Some properties emit multiple signals (Tailwind class + inline
        // style + manifest counter). Each is its own needle; any match is
        // enough to flip the property to `emitted`.
        emittedHintMap[property.id] = stableEmittedNeedles(property);
    }
    const fileContents = input.files.map((file) => file.content ?? '').join('\n');
    const emittedInCode = new Set<string>();
    for (const [id, needles] of Object.entries(emittedHintMap)) {
        if (needles.length === 0) continue;
        if (needles.some((needle) => needle.length === 0 || fileContents.includes(needle))) {
            emittedInCode.add(id);
        }
    }

    // Compose the per-property entries.
    const properties: PropertyCoverage[] = SOURCE_PROPERTIES.map((property) => {
        const discovered = discoveredOnSource.get(property.id) ?? { count: 0 };
        const discoveredCount = discovered.count;
        const preserved = preservedOnAst.has(property.id);
        const emitted = emittedInCode.has(property.id);
        let stage: CoverageStage;
        if (property.unsupported) stage = 'unsupported';
        else if (!property.emittedAs) stage = 'ast-preserved'; // No emission target: report AST fidelity only.
        else if (emitted) stage = 'emitted';
        else if (preserved) stage = 'ast-preserved';
        else if (discoveredCount > 0) stage = 'framer-preserved';
        else stage = 'discovered'; // never discovered — vacuous stage

        return {
            id: property.id,
            name: property.name,
            sdkAttribute: property.sdkAttribute,
            emittedAs: property.emittedAs,
            discoveredCount,
            discovered: discoveredCount > 0,
            preserved,
            emitted,
            unsupported: property.unsupported === true,
            unsupportedReason: property.unsupportedReason,
            stage,
        };
    });

    const summary = {
        registered: SOURCE_PROPERTIES.length,
        discovered: properties.filter((p) => p.discovered).length,
        preserved: properties.filter((p) => p.preserved).length,
        emitted: properties.filter((p) => p.emitted).length,
        unsupported: properties.filter((p) => p.unsupported).length,
        lost: properties.filter((p) => p.discovered && !p.emitted && !p.unsupported && !p.preserved).length,
    };

    return {
        properties,
        undocumentedSdKKeys: [], // future: diff SDK keys against the static registry
        summary,
        fileEmittedHints: Object.fromEntries(
            Object.entries(emittedHintMap).map(([id, list]) => [id, list.join(' | ')]),
        ),
    };
}

/**
 * Stable, file-greppable needles that prove a property made it into code.
 *
 * Returns a list (any match flips the property to `emitted`). When multiple
 * distinct emission paths exist — e.g. an inline `position:` style OR
 * a Tailwind `absolute` class — each is its own needle so the property is
 * reported honestly regardless of which path the generator took.
 */
function stableEmittedNeedles(property: SourceProperty): string[] {
    const KNOWN_NEEDLES: Record<string, string[]> = {
        'node.id': ['className'],
        'node.name': ['className'],
        'node.rect': ['width'],
        'source.isReplica': ['replicas'],
        'layout.strategy': ['flex'],
        'layout.stackDirection': ['flex-row'],
        'layout.stackDistribution': ['justify-center'],
        'layout.stackAlignment': ['items-center'],
        'layout.stackWrapEnabled': ['flex-wrap', 'flex flex-row', 'flex flex-col'],
        'layout.gap': ['gap-'],
        'layout.padding': ['p-', 'py-', 'px-'],
        'layout.gridColumnCount': ['grid-cols'],
        'layout.gridRowCount': ['grid-rows'],
        'layout.gridColumnWidth': ['gridTemplateColumns'],
        'layout.gridRowHeight': ['gridTemplateRows'],
        // Position emits either an inline `position: …` style or a Tailwind
        // class (`absolute | relative | fixed | sticky`).
        'layout.position': ['position:', 'absolute', 'relative', 'fixed', 'sticky'],
        'layout.top': ['top-'],
        'layout.right': ['right-'],
        'layout.bottom': ['bottom-'],
        'layout.left': ['left-'],
        'layout.zIndex': ['z-'],
        'sizing.width': ['w-'],
        'sizing.height': ['h-'],
        'sizing.minWidth': ['min-w-'],
        'sizing.maxWidth': ['max-w-'],
        'sizing.minHeight': ['min-h-'],
        'sizing.maxHeight': ['max-h-'],
        'sizing.aspectRatio': ['aspect-'],
        'style.backgroundColor': ['bg-'],
        'style.backgroundGradient': ['linear-gradient'],
        'style.fills': ['background'],
        'style.stroke': ['border'],
        'style.borderRadius': ['rounded'],
        'style.shadow': ['shadow'],
        'style.blur': ['blur'],
        'style.opacity': ['opacity'],
        'style.visible': ['hidden'],
        'style.overflow': ['overflow'],
        'style.rotation': ['rotate'],
        'style.cursor': ['cursor'],
        'style.imageRendering': ['imageRendering'],
        'text.fontFamily': ['font-'],
        'text.fontWeight': ['font-bold'],
        'text.italic': ['italic'],
        'text.italicInline': ['italic'],
        'text.fontSize': ['text-'],
        'text.lineHeight': ['leading'],
        'text.letterSpacing': ['tracking'],
        'text.color': ['text-'],
        'text.alignment': ['text-center'],
        'text.transform': ['uppercase'],
        'text.decoration': ['underline'],
        'asset.image': ['<img', '/assets/images/'],
        'asset.svg': ['<svg'],
        'asset.alt': ['alt='],
        'component.identifier': ['import'],
        'component.name': ['function'],
        'component.props': ['interface '],
        'component.slots': ['children'],
        'component.master': ['fromMasters'],
        // The verbatim source is shipped inside the project at `src/code/<basename>`
        // and the parent section imports it (e.g. `import Default from '../code/<basename>'`).
        // Either signal proves end-to-end preservation.
        'component.code': ['../code/', 'src/code/'],
        'interaction.link': ['href'],
        'animation.hover': ['whileHover'],
        'animation.tap': ['whileTap'],
        'animation.mount': ['initial'],
        'animation.viewport': ['whileInView'],
    };
    const known = KNOWN_NEEDLES[property.id];
    if (known) return known;
    return [property.sdkAttribute.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)];
}

/**
 * Render a human-friendly block from a CoverageReport (used by the plugin
 * UI and the demo script). The shape is stable so the diagnostic panel can
 * key off stage names without parsing locale-specific text.
 */
export function renderCoverageText(report: CoverageReport): string {
    const lines: string[] = [];
    lines.push('SOURCE PROPERTY COVERAGE');
    lines.push('');
    lines.push(`Registered:        ${report.summary.registered}`);
    lines.push(`Discovered:        ${report.summary.discovered}`);
    lines.push(`Preserved (AST):   ${report.summary.preserved}`);
    lines.push(`Emitted (code):    ${report.summary.emitted}`);
    lines.push(`Unsupported:       ${report.summary.unsupported}`);
    lines.push(`Lost:              ${report.summary.lost}`);
    lines.push('');
    const groups = new Map<CoverageStage, PropertyCoverage[]>();
    for (const property of report.properties) {
        const bucket = groups.get(property.stage) ?? [];
        bucket.push(property);
        groups.set(property.stage, bucket);
    }
    const stageOrder: CoverageStage[] = ['lost', 'unsupported', 'framer-preserved', 'ast-preserved', 'emitted', 'discovered'];
    for (const stage of stageOrder) {
        const bucket = groups.get(stage);
        if (!bucket || bucket.length === 0) continue;
        lines.push(`── ${stage.toUpperCase()} (${bucket.length}) ──`);
        for (const property of bucket) {
            const flag = property.unsupported ? '[unsupported]' : '';
            const reason = property.unsupportedReason ? ` — ${property.unsupportedReason}` : '';
            const count = property.discoveredCount > 0 ? ` (${property.discoveredCount} sources)` : '';
            lines.push(`  - ${property.id}  ${property.sdkAttribute}  ${flag}${count}${reason}`);
        }
        lines.push('');
    }
    return lines.join('\n').trimEnd();
}
