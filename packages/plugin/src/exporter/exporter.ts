/**
 * The exporter.
 *
 * Runs the compiler pipeline on a Framer document and delivers the resulting
 * project ZIP to the user. Everything runs locally inside the plugin — no
 * backend, no uploads.
 */

import { compileFramerDocument, type CompileResult } from '@framer/compiler';
import type { FramerDocument, FramerNode } from '@framer/compiler-parser';

import { type ExportOptions, validateDocument } from './schemas';

/** The extraction status recorded by the plugin adapter on `document.metadata.extraction`. */
interface ExtractionStatusRecord {
    status: string;
    count?: number;
    reason?: string;
}

interface ExtractionMetadata {
    masters?: ExtractionStatusRecord;
    codeFiles?: ExtractionStatusRecord;
    modules?: ExtractionStatusRecord;
}

/**
 * The exporter must NEVER knowingly ship a fully synthesized project.
 *
 * Framer v4 plugins have no manifest-declared permissions (framer.json carries
 * only id/name/modes/icon) and `getNodesWithType` / `getCodeFiles` are
 * always-allowed by the SDK — no permission grant can enable or block them.
 * So the only guarantee that real masters and code sources are never replaced
 * by approximations is to REFUSE the export when extraction shows both
 * enrichment paths degraded: every component definition would then be
 * synthesized from instance props, which is exactly the fidelity failure this
 * compiler exists to prevent.
 *
 * The gate is skipped when the document carries no extraction record (mock /
 * standalone / legacy documents) and when the document contains no component
 * instances (nothing would be synthesized). Single-side degradation (masters
 * OK but code files down, or vice versa) stays a surfaced warning — the
 * recoverable half still ships. Shared-module bundles also count as recovery:
 * a document whose components are all published modules has no local code
 * files by design, and the bundles ARE the real implementations.
 */
function assertNotFullySynthesized(document: FramerDocument): void {
    const extraction = (document.metadata as { extraction?: ExtractionMetadata } | undefined)?.extraction;
    if (!extraction) return;
    const masters = extraction.masters;
    const codeFiles = extraction.codeFiles;
    if (!masters || !codeFiles) return;
    const modulesRecovered = extraction.modules?.status === 'ok' && (extraction.modules.count ?? 0) > 0;
    if (masters.status === 'ok' || codeFiles.status === 'ok' || modulesRecovered) return;
    if (!containsComponentInstance(document.nodes)) return;

    const detail = (name: string, record: ExtractionStatusRecord): string =>
        `${name}: ${record.status}${record.reason ? ` (${record.reason})` : ''}`;
    throw new Error(
        `Export blocked — every component definition would be synthesized from instance props (approximate), not the real source. ` +
        `Both source enrichments failed: ${detail('component masters', masters)}; ${detail('code files', codeFiles)}. ` +
        'Close and reopen the plugin to reconnect to the Framer engine, then export again. ' +
        'If the problem persists, check that your project role grants design/content access.',
    );
}

/** Whether the document tree contains any component instance node. */
function containsComponentInstance(nodes: FramerNode[]): boolean {
    const visit = (node: FramerNode): boolean => {
        if (node.type === 'Component') return true;
        for (const child of node.children ?? []) {
            if (visit(child)) return true;
        }
        if (node.component?.slots) {
            for (const slotNodes of Object.values(node.component.slots)) {
                for (const slotNode of slotNodes) {
                    if (visit(slotNode)) return true;
                }
            }
        }
        return false;
    };
    return nodes.some(visit);
}

/** Compile a Framer document into a project + ZIP (no download). */
export async function compileProject(document: FramerDocument, options: ExportOptions = {}): Promise<CompileResult> {
    validateDocument(document);
    // Never silently synthesize the whole project: refuse when extraction
    // proves both enrichment paths are down (see assertNotFullySynthesized).
    assertNotFullySynthesized(document);
    await fetchRemoteAssets(document);
    return compileFramerDocument(document, {
        projectName: options.projectName,
        animations: options.animations ?? true,
        format: options.format ?? true,
        zip: true,
    });
}

/** Pre-fetch remote asset binaries so exported ZIPs contain offline image files. */
async function fetchRemoteAssets(document: FramerDocument): Promise<void> {
    // Collect every unique remote URL → the mutable objects that hold that URL.
    // After fetching, we write the binary ArrayBuffer back to each object's `data`
    // key so that collectAssets (which runs next inside compileFramerDocument) will
    // read non-null `data` and emit a real binary file in the ZIP instead of a
    // placeholder .txt reference.
    const urlToRefs = new Map<string, Array<{ target: Record<string, unknown>; key: string }>>();

    const addRef = (url: string | undefined | null, target: Record<string, unknown>, key: string): void => {
        if (!url || !/^https?:\/\//i.test(url)) return;
        const existing = target[key];
        // Original bytes already attached (ImageAsset.getData()) are the
        // source of truth — a URL fetch must never overwrite them.
        if (existing instanceof Uint8Array && existing.byteLength > 0) return;
        const refs = urlToRefs.get(url) ?? [];
        refs.push({ target, key });
        urlToRefs.set(url, refs);
    };

    const gatherUrls = (node: any): void => {
        if (!node) return;

        // ── Standalone image node (node.image.src → node.image.data) ──────────
        if (node.image?.src) {
            addRef(node.image.src, node.image, 'data');
        }

        // ── Vector node with external SVG URL (node.vector.src → node.vector.svgData) ──
        if (node.vector?.src) {
            addRef(node.vector.src, node.vector, 'svgData');
        }

        // ── Image fills: cards, hero frames, testimonial backgrounds ──────────
        // fill.image is a FramerImageRef which already has data?: Uint8Array.
        if (Array.isArray(node.style?.fills)) {
            for (const fill of node.style.fills) {
                if (fill.type === 'image' && fill.image?.src) {
                    addRef(fill.image.src, fill.image, 'data');
                }
            }
        }

        // ── Strokes that use an image fill ────────────────────────────────────
        if (Array.isArray(node.style?.strokes)) {
            for (const stroke of node.style.strokes) {
                if (stroke.fill?.type === 'image' && stroke.fill.image?.src) {
                    addRef(stroke.fill.image.src, stroke.fill.image, 'data');
                }
            }
        }

        // ── Component / slot props containing remote asset URLs ───────────────
        if (node.props && typeof node.props === 'object') {
            for (const [propKey, val] of Object.entries(node.props as Record<string, unknown>)) {
                if (typeof val === 'string' && /^https?:\/\//i.test(val)) {
                    addRef(val, node.props as Record<string, unknown>, propKey);
                }
            }
        }

        // ── Recurse into children, slots, and variants ────────────────────────
        for (const child of node.children ?? []) {
            gatherUrls(child);
        }
        if (node.component?.slots) {
            for (const slotNodes of Object.values(node.component.slots as Record<string, unknown[]>)) {
                for (const slotNode of slotNodes) gatherUrls(slotNode);
            }
        }
        if (Array.isArray(node.variants)) {
            for (const variant of node.variants) {
                for (const variantNode of variant.nodes ?? []) gatherUrls(variantNode);
            }
        }
    };

    for (const root of document.nodes ?? []) {
        gatherUrls(root);
    }

    if (urlToRefs.size === 0) return;

    const fetches = Array.from(urlToRefs.entries()).map(async ([url, refs]) => {
        try {
            const res = await fetch(url);
            if (res.ok) {
                const buf = new Uint8Array(await res.arrayBuffer());
                if (buf.byteLength > 0) {
                    for (const { target, key } of refs) {
                        target[key] = buf;
                    }
                }
            }
        } catch {
            // Soft fail: remote asset placeholder will be used if offline/CORS blocked.
        }
    });

    await Promise.all(fetches);
}

/** Trigger a browser download of the given bytes. */
export function triggerDownload(bytes: Uint8Array, fileName: string, mimeType = 'application/zip'): void {
    const blob = new Blob([bytes as BlobPart], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Allow the download to start before revoking the URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Compile a document and download the resulting ZIP. */
export async function exportProject(document: FramerDocument, options: ExportOptions = {}): Promise<CompileResult> {
    const result = await compileProject(document, options);
    if (result.zip) {
        triggerDownload(result.zip, `${result.name}.zip`);
    }
    return result;
}
