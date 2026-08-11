/**
 * Reference-renderer types.
 *
 * The reference renderer is an INDEPENDENT implementation of the Framer
 * source model → pixels. It consumes the exact `FramerDocument` that the
 * plugin extracts and emits plain HTML + CSS. It deliberately does NOT reuse
 * the React generator or the Design AST — the whole point of visual
 * regression is that two independently-written renderers must agree.
 */

import type { FramerBreakpoint, FramerNode } from '@framer/compiler-parser';

/** A single CSS declaration, e.g. `{ property: 'display', value: 'flex' }`. */
export interface CssDeclaration {
    property: string;
    value: string;
}

/** A resolved breakpoint: name + mobile-first min-width in px. */
export interface ResolvedBreakpoint {
    name: string;
    minWidth: number;
}

/** A node's effective visual box, after merging responsive overrides. */
export interface EffectiveNode {
    /** The original source node (frame, children, text, image, vector…). */
    node: FramerNode;
    /** The merged layout (base + active override). */
    layout: FramerNode['layout'];
    /** The merged style (base + active override). */
    style: FramerNode['style'];
}

/** Options for the reference renderer. */
export interface ReferenceRenderOptions {
    /**
     * Breakpoints to use. Defaults to the document's own breakpoints, then
     * to the compiler's default Tailwind-compatible scale.
     */
    breakpoints?: FramerBreakpoint[];
    /** Include the Google-Fonts link tags the generated page ships. Default false. */
    includeExternalFonts?: boolean;
    /** HTML title. Defaults to the document name. */
    title?: string;
}
