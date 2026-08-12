/**
 * FramerDocument → self-contained HTML page.
 *
 * This is the *reference* renderer: what Framer's canvas would draw, derived
 * deterministically from the exact source model the plugin extracts. It is
 * independent of the React generator — two separate implementations of the
 * same source model, so visual regression measures real agreement.
 *
 * The page renders every top-level node as a full-width section (matching
 * the generated project's App layout), applies a strict CSS reset (Tailwind
 * preflight equivalent) so heading/margin defaults can't skew the diff, and
 * emits responsive media queries from the document's own breakpoints.
 *
 * Every node's CSS lives in a stylesheet class (`.fx-ref-<path>`) so
 * responsive media-query tiers can override it; elements carry only a class.
 * Text runs are the exception — they are leaf-level styled spans.
 */

import type { FramerDocument, FramerNode } from '@framer/compiler-parser';
import { DEFAULT_BREAKPOINTS } from '@framer/compiler-shared';

import { formatDeclarations, nodeCssWithOverrides, typographyCss } from './css';
import type { CssDeclaration, ReferenceRenderOptions, ResolvedBreakpoint } from './types';

// Re-exported for consumers/tests (the canonical implementation lives in css.ts).
export { typographyCss } from './css';
export type { CssDeclaration } from './types';

/** The CSS reset — mirrors Tailwind preflight so both pages start identical. */
const RESET_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Inter', system-ui, -apple-system, sans-serif; line-height: 1.5; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
img, svg, video { max-width: 100%; height: auto; display: block; }
/* Responsive image swaps render as <picture>; the wrapper must not become
   a layout box (the <img> is the flex item / positioned element). */
picture { display: contents; }
h1, h2, h3, h4, h5, h6, p { margin: 0; }
`;

/** Resolve the breakpoint scale for a document (source wins, else default). */
export function resolveBreakpoints(document: FramerDocument): ResolvedBreakpoint[] {
    if (document.breakpoints && document.breakpoints.length > 0) {
        return document.breakpoints
            .map((bp) => ({ name: bp.name, minWidth: bp.minWidth }))
            .sort((a, b) => a.minWidth - b.minWidth);
    }
    return DEFAULT_BREAKPOINTS.map((bp) => ({ name: bp.name, minWidth: bp.minWidth }));
}

/** Build the full HTML page for a document. */
export function renderReferencePage(document: FramerDocument, options: ReferenceRenderOptions = {}): string {
    const breakpoints = options.breakpoints
        ? options.breakpoints
              .map((bp) => ({ name: bp.name, minWidth: bp.minWidth }))
              .sort((a, b) => a.minWidth - b.minWidth)
        : resolveBreakpoints(document);

    const title = options.title ?? document.name ?? 'Reference';

    const rules: string[] = [];
    document.nodes.forEach((node, index) => {
        collectRules(node, `fx-ref-${index}`, breakpoints, rules);
    });

    const css = [RESET_CSS, ...rules].join('\n');
    const fontLinks = options.includeExternalFonts
        ? `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@400;500;600;700&display=swap" rel="stylesheet" />`
        : '';

    const sections = document.nodes.map((node, index) => renderNode(node, `fx-ref-${index}`, breakpoints)).join('\n');

    return `<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <title>${escapeHtml(title)}</title>
        ${fontLinks}
        <style>
${css}
        </style>
    </head>
    <body>
        <main style="min-height: 100vh; background: #ffffff;">
${indent(sections)}
        </main>
    </body>
</html>
`;
}

/**
 * The node whose layout/style CSS a rendered element must carry.
 *
 * For a master-backed component the instance div renders the MASTER root's
 * box (background, padding, flex layout) — exactly what the generated
 * component file does with the master body. The instance's own responsive
 * overrides still apply on top.
 */
function cssNodeOf(node: FramerNode): FramerNode {
    if (node.type === 'Component' && node.component?.master) {
        return { ...node.component.master, responsive: node.responsive };
    }
    return node;
}

/** Recursively emit base + responsive rules for a node and its descendants. */
function collectRules(node: FramerNode, className: string, breakpoints: ResolvedBreakpoint[], rules: string[]): void {
    const selector = `.${className}`;
    const cssNode = cssNodeOf(node);
    rules.push(`${selector} {\n${formatDeclarations(nodeCssWithOverrides(cssNode, undefined))}\n}`);

    const breakpointMinWidth = new Map(breakpoints.map((bp) => [bp.name, bp.minWidth]));
    if (node.responsive) {
        for (const [bpName, override] of Object.entries(node.responsive)) {
            if (!override) continue;
            const minWidth = breakpointMinWidth.get(bpName);
            if (minWidth === undefined) continue;
            rules.push(
                `@media (min-width: ${minWidth}px) {\n${selector} {\n${formatDeclarations(nodeCssWithOverrides(cssNode, override))}\n}\n}`,
            );
        }
    }

    const children = childrenOf(node);
    children.forEach((child, index) => {
        collectRules(child, `${className}-c${index}`, breakpoints, rules);
    });
}

/** The nodes to recurse into for a node (master body for components). */
function childrenOf(node: FramerNode): FramerNode[] {
    switch (node.type) {
        case 'Component':
            if (node.component?.master) return node.component.master.children ?? [];
            return node.children ?? [];
        default:
            return node.children ?? [];
    }
}

/** Render a node and its descendants into an HTML string. */
function renderNode(node: FramerNode, className: string, breakpoints: ResolvedBreakpoint[]): string {
    switch (node.type) {
        case 'Text':
            return renderText(node, className);
        case 'Image':
            return renderImage(node, className, breakpoints);
        case 'Vector':
            return renderVector(node, className);
        case 'Component':
            return renderComponent(node, className, breakpoints);
        default:
            return renderFrame(node, className, breakpoints);
    }
}

/** A generic container (Frame / Slot / unknown types). */
function renderFrame(node: FramerNode, className: string, breakpoints: ResolvedBreakpoint[]): string {
    const children = (node.children ?? [])
        .map((child, index) => renderNode(child, `${className}-c${index}`, breakpoints))
        .join('\n');
    return `<div class="${className}">\n${indent(children)}\n</div>`;
}

/** A text node: div + exact typography (heading semantics don't affect pixels). */
function renderText(node: FramerNode, className: string): string {
    const runs = node.text?.runs;
    let inner: string;
    if (runs && runs.length > 0) {
        inner = runs
            .map((run) => {
                const runDecl = typographyCss(run.style);
                const styleAttr = runDecl.length > 0 ? ` style="${escapeAttr(formatInline(runDecl))}"` : '';
                return `<span${styleAttr}>${escapeHtml(run.text)}</span>`;
            })
            .join('');
    } else {
        inner = escapeHtml(node.text?.text ?? '');
    }
    return `<div class="${className}">${inner}</div>`;
}

/** An image node. */
function renderImage(node: FramerNode, className: string, breakpoints: ResolvedBreakpoint[]): string {
    const image = node.image;
    const src = image?.src ?? '';
    const alt = image?.alt ?? '';
    const img = `<img class="${className}" src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" />`;

    // Responsive image swaps: one <source media> per tier that carries an
    // alternate image — mirroring the generated project's <picture> element
    // (object-fit stays honored because the <img> keeps its box and class).
    // Sources are emitted DESCENDING by min-width: browsers select the FIRST
    // matching <source> in tree order, so the largest breakpoint must come
    // first or a lower tier would shadow the higher one.
    const tiers = node.responsive
        ? Object.entries(node.responsive)
              .filter(([, override]) => override?.image?.src)
              .map(([breakpointName, override]) => ({
                  minWidth: breakpoints.find((b) => b.name === breakpointName)?.minWidth,
                  src: override!.image!.src,
              }))
              // A tier whose breakpoint is not in the document scale cannot be
              // placed — skip it (same rule as collectRules below).
              // `(min-width: 0px)` would match every viewport and, as the last
              // source in tree order, shadow the <img> fallback everywhere. A
              // real min-width-0 breakpoint still resolves (0, not undefined).
              .filter((tier): tier is { minWidth: number; src: string } => tier.minWidth !== undefined)
              .sort((a, b) => b.minWidth - a.minWidth)
        : [];
    if (tiers.length === 0) return img;

    const sources = tiers
        .map(
            ({ minWidth, src: tierSrc }) =>
                `    <source media="(min-width: ${minWidth}px)" srcset="${escapeAttr(tierSrc)}" />`,
        )
        .join('\n');
    return `<picture>\n${sources}\n${indent(img)}\n</picture>`;
}

/** A vector node: inline SVG from the source, or a neutral box. */
function renderVector(node: FramerNode, className: string): string {
    const svg = node.vector?.svg;
    if (svg) {
        return `<div class="${className}">${svg}</div>`;
    }
    return `<div class="${className}"></div>`;
}

/**
 * A component instance: render the master body when the SDK exposed one,
 * otherwise the instance children. CODE components (no canvas body) render a
 * neutral placeholder — their pixels come from arbitrary code, which a
 * source renderer cannot reproduce; the diff for those regions is expected.
 */
function renderComponent(node: FramerNode, className: string, breakpoints: ResolvedBreakpoint[]): string {
    const master = node.component?.master;
    if (master) {
        const body = (master.children ?? [])
            .map((child, index) => renderNode(child, `${className}-c${index}`, breakpoints))
            .join('\n');
        return `<div class="${className}">\n${indent(body)}\n</div>`;
    }
    if (node.component?.code) {
        return `<div class="${className}" data-code-component="${escapeAttr(node.component.code.fileName)}"></div>`;
    }
    return renderFrame(node, className, breakpoints);
}

/** Inline style attribute value from declarations. */
export function formatInline(declarations: CssDeclaration[]): string {
    return declarations.map((d) => `${d.property}: ${d.value};`).join(' ');
}

function indent(text: string): string {
    return text
        .split('\n')
        .map((line) => (line.length > 0 ? `    ${line}` : line))
        .join('\n');
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
    return escapeHtml(value).replace(/"/g, '&quot;');
}
