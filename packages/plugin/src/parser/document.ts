/**
 * Framer document extraction.
 *
 * Reads the current Framer document (canvas root → pages → nodes) and
 * converts it into the platform-neutral FramerDocument shape.
 */

import type { FramerDocument, FramerNode } from '@framer/compiler-parser';

import type { ExtractionStatus, FramerApi, FramerCanvasRoot, FramerPage, FramerSdkFont } from './sdk';
import { fetchCodeFiles } from './code-files';
import type { ModuleTextFetcher } from './modules';
import { safeParseNode, type ParseContext, type UnmatchedInstance } from './node';
import type { SdkNode } from './sdk-types';

/** The font asset shape carried on `FramerDocument.fonts`. */
type FramerFontAsset = NonNullable<FramerDocument['fonts']>[number];

/** The outcome of a master/code-file enrichment fetch. */
interface FetchResult {
    /** The lookup map (empty when degraded). */
    map: Map<string, SdkNode>;
    /** Masters indexed by componentName (last-resort instance match). */
    byName: Map<string, SdkNode>;
    /** Why the fetch resolved the way it did — never silently degraded. */
    status: ExtractionStatus;
}

/** Classify a thrown enrichment error into a user-actionable status. */
function classifyError(apiName: string, error: unknown): ExtractionStatus {
    const message = error instanceof Error ? error.message : String(error);
    if (/permission|allowed|not allowed|denied/i.test(message)) {
        return { status: 'denied', reason: `${apiName} threw a permission error: ${message.slice(0, 120)}` };
    }
    return { status: 'error', reason: `${apiName} threw: ${message.slice(0, 120)}` };
}

/**
 * Fetch every component master (definition) from the SDK.
 *
 * Masters are fetched ONCE per extraction and parsed lazily into the parse
 * context cache, so the same master becomes the single definition body for
 * every instance that references it. Each master is indexed BOTH by its
 * componentIdentifier and its insertURL — instances may carry either key, and
 * shared components can expose different identifiers.
 */
async function fetchComponentMasters(api: FramerApi): Promise<FetchResult> {
    const map = new Map<string, SdkNode>();
    const byName = new Map<string, SdkNode>();
    if (typeof api.getNodesWithType !== 'function') {
        return { map, byName, status: { status: 'unavailable', reason: 'The SDK does not expose getNodesWithType; component masters cannot be read.' } };
    }
    try {
        const componentNodes = await api.getNodesWithType('ComponentNode');
        let count = 0;
        for (const master of componentNodes) {
            const sdk = master as unknown as SdkNode;
            if (sdk.componentIdentifier) {
                if (!map.has(sdk.componentIdentifier)) {
                    map.set(sdk.componentIdentifier, sdk);
                    count += 1;
                }
            }
            if (sdk.insertURL && !map.has(sdk.insertURL)) {
                map.set(sdk.insertURL, sdk);
            }
            // componentName is the last-resort instance key: instances whose
            // identifier/insertURL don't line up (shared components, engine-
            // internal ids) can still resolve to their real body by name.
            if (sdk.componentName && !map.has(sdk.componentName) && !byName.has(sdk.componentName)) {
                byName.set(sdk.componentName, sdk);
            }
        }
        if (count === 0) {
            return { map, byName, status: { status: 'empty', reason: 'getNodesWithType resolved but returned no ComponentNode masters.' } };
        }
        return { map, byName, status: { status: 'ok', count } };
    } catch (error) {
        return { map, byName, status: classifyError('getNodesWithType(ComponentNode)', error) };
    }
}

/** Fetch a font file's bytes (injectable for tests; defaults to `fetch`). */
export type FontBytesFetcher = (url: string) => Promise<Uint8Array | null>;

/** Options controlling document extraction. */
export interface ExtractFramerDocumentOptions {
    /**
     * The shared-module bundle fetcher (injectable for tests; defaults to
     * `fetch` against Framer's CORS-open module CDN).
     */
    moduleFetcher?: ModuleTextFetcher;
    /**
     * The font-file byte fetcher (injectable for tests; defaults to `fetch`
     * against the font URLs exposed by `framer.getFonts()`).
     */
    fontFetcher?: FontBytesFetcher;
}

/** Font file formats the registry can emit. */
const FONT_FORMATS: readonly FramerFontAsset['sources'][number]['format'][] = ['woff2', 'woff', 'ttf', 'otf'];

/** Infer the font file format from its URL extension (fallback: woff2). */
function fontFormatFromUrl(url: string): FramerFontAsset['sources'][number]['format'] {
    const match = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(url);
    const ext = match?.[1]?.toLowerCase();
    if (ext && (FONT_FORMATS as readonly string[]).includes(ext)) {
        return ext as FramerFontAsset['sources'][number]['format'];
    }
    return 'woff2';
}

/**
 * Collect every font the SDK exposes (`framer.getFonts()`) and download each
 * font file so the export can be self-contained.
 *
 * Custom fonts are NOT available to the plugin API, so they never appear in
 * the returned list; a font whose `url` is null (no downloadable source) is
 * still recorded as a `FontAsset` with empty sources — never silently
 * dropped — so the FontRegistry warns for it instead of substituting a
 * look-alike. A font whose URL could not be fetched keeps its URL (the
 * registry then warns that it remains network-dependent).
 */
async function collectProjectFonts(api: FramerApi, fetcher: FontBytesFetcher): Promise<{ fonts: FramerFontAsset[]; status: ExtractionStatus }> {
    const fonts: FramerFontAsset[] = [];
    if (typeof api.getFonts !== 'function') {
        return { fonts, status: { status: 'unavailable', reason: 'The SDK does not expose getFonts; fonts are exported as metadata only.' } };
    }

    let sdkFonts: FramerSdkFont[];
    try {
        sdkFonts = await api.getFonts();
    } catch (error) {
        return { fonts, status: classifyError('getFonts()', error) };
    }

    if (sdkFonts.length === 0) {
        return { fonts, status: { status: 'empty', reason: 'getFonts resolved but returned no fonts (custom fonts are not exposed to plugins).' } };
    }

    let withSource = 0;
    const noSource: string[] = [];
    for (const sdkFont of sdkFonts) {
        const family = sdkFont.family?.trim();
        if (!family) continue;
        const weight = typeof sdkFont.weight === 'number' ? sdkFont.weight : 400;
        const style: FramerFontAsset['style'] = sdkFont.style === 'italic' ? 'italic' : 'normal';

        if (!sdkFont.url) {
            noSource.push(family);
            fonts.push({ family, weight, style, sources: [] });
            continue;
        }

        const format = fontFormatFromUrl(sdkFont.url);
        const bytes = await fetcher(sdkFont.url);
        fonts.push({
            family,
            weight,
            style,
            sources: [{ url: sdkFont.url, format, ...(bytes ? { data: bytes } : {}) }],
        });
        withSource += 1;
    }

    const status: ExtractionStatus =
        noSource.length === 0
            ? { status: 'ok', count: withSource }
            : {
                  status: 'partial',
                  count: withSource,
                  failed: noSource.length,
                  reason: `${noSource.length} font(s) have no downloadable source file (${Array.from(new Set(noSource))
                      .slice(0, 5)
                      .join(', ')}${noSource.length > 5 ? ', …' : ''}) — custom fonts are not available to the plugin API; the rest are bundled.`,
              };
    return { fonts, status };
}

/** Extract the full Framer document from the SDK. */
export async function extractFramerDocument(
    api: FramerApi,
    options: ExtractFramerDocumentOptions = {},
): Promise<FramerDocument> {
    // A canvas the engine cannot read must not abort the whole load — degrade
    // to an empty document rather than fail the extraction.
    let root: FramerCanvasRoot | null = null;
    try {
        root = await api.getCanvasRoot();
    } catch {
        root = null;
    }
    if (!root) {
        return {
            id: 'canvas',
            name: 'Framer Document',
            version: '1.0.0',
            nodes: [],
            metadata: { platform: 'framer' },
        };
    }
    let pages: FramerPage[] = [];
    try {
        pages = await root.getChildren();
    } catch {
        pages = [];
    }

    // Project-wide fonts come from getFonts() (one entry per weight/style,
    // each with a downloadable file URL); the bytes are fetched so the export
    // is self-contained. Custom fonts are not exposed to plugins — recorded,
    // never silently dropped.
    const fontFetch = await collectProjectFonts(api, options.fontFetcher ?? defaultFontBytesFetcher);

    // Component masters give every instance its real definition body (slot
    // positions + per-slot props) instead of a synthesized approximation.
    const masters = await fetchComponentMasters(api);
    // Code files give every code-component instance its REAL source — the
    // true implementation instead of a synthesized approximation.
    const codeFiles = await fetchCodeFiles(api);
    const context: ParseContext = {
        masters: masters.map,
        mastersByName: masters.byName,
        codeFiles: codeFiles.index,
        parsedMasters: new Map<string, FramerNode>(),
        parsingMasters: new Set<string>(),
        unmatchedInstances: [],
        // Shared module bundles (published code components on Framer's CDN)
        // are fetched with plain fetch — CORS is open on the CDN — and each
        // bundle resolves once per extraction (deduped across instances).
        moduleFetcher: options.moduleFetcher ?? defaultModuleFetcher,
        moduleCache: new Map(),
        modulePaths: new Set(),
        moduleFailures: [],
    };

    const nodes: FramerNode[] = [];
    for (const page of pages) {
        // A page the SDK cannot walk must not abort the whole extraction —
        // the remaining pages still load.
        let children: SdkNode[] = [];
        try {
            children = (await page.getChildren()) as SdkNode[];
        } catch {
            children = [];
        }
        for (const child of children) {
            nodes.push(await safeParseNode(child, context));
        }
    }

    // NOTE: metadata deliberately carries no export timestamp — the exporter
    // must be deterministic: the same document must produce the same output
    // on every run.
    // Instances that matched neither a master nor a code file — the EXACT
    // keys they carried, so the export can say "this instance looked up
    // componentIdentifier X / insertURL Y and nothing matched" instead of a
    // flat "synthesized". Shared only when something actually went unmatched.
    const unmatched = (context.unmatchedInstances ?? []).filter(
        (instance, index, all) =>
            all.findIndex((other) => other.id === instance.id) === index,
    );
    // Shared-module resolution outcome: how many published bundles resolved
    // to real implementations vs. failed to fetch (each counted once per
    // unique URL). Omitted when the document carries no module instances.
    const moduleStats = moduleExtractionStatus(context);
    const document: FramerDocument = {
        id: root.id,
        name: root.name ?? 'Framer Document',
        version: '1.0.0',
        nodes,
        // Only explicit API-collected fonts enter the model; an empty result
        // falls back to node-inferred metadata (no spurious warnings).
        ...(fontFetch.fonts.length > 0 ? { fonts: fontFetch.fonts } : {}),
        metadata: {
            platform: 'framer',
            // Why components may be synthesized — never silent. The compiler
            // surfaces these as root-cause warnings in the export diagnostics.
            extraction: {
                masters: masters.status,
                codeFiles: codeFiles.status,
                fonts: fontFetch.status,
                ...(moduleStats ? { modules: moduleStats } : {}),
                ...(unmatched.length > 0 ? { unmatchedInstances: unmatched as UnmatchedInstance[] } : {}),
            },
        },
    };

    // Responsive breakpoints come from the source when the SDK exposes them;
    // otherwise the compiler falls back to its default scale.
    if (Array.isArray(root.breakpoints) && root.breakpoints.length > 0) {
        document.breakpoints = root.breakpoints.map((bp) => ({ name: bp.name, minWidth: bp.minWidth }));
    }

    return document;
}

/**
 * The outcome of shared-module resolution for one extraction.
 *
 * `ok` when every module bundle resolved, `partial` when some failed (the
 * failures name the exact bundle URLs), and undefined when the document
 * carried no module instances at all — nothing to report.
 */
function moduleExtractionStatus(context: ParseContext): ExtractionStatus | undefined {
    const cache = context.moduleCache;
    if (!cache || cache.size === 0) return undefined;
    let resolved = 0;
    for (const closure of cache.values()) {
        if (closure) resolved += 1;
    }
    const failed = cache.size - resolved;
    if (failed === 0) return { status: 'ok', count: resolved };
    const failures = context.moduleFailures ?? [];
    const sample = failures
        .slice(0, 3)
        .map((failure) => `${failure.name} [${failure.url}]`)
        .join('; ');
    return {
        status: 'partial',
        count: resolved,
        failed,
        reason: `${failed} module bundle(s) could not be fetched (${sample}${failures.length > 3 ? `; ${failures.length - 3} more` : ''}).`,
    };
}

/** Fetch a module bundle's text (CORS is open on Framer's module CDN). */
const defaultModuleFetcher: ModuleTextFetcher = async (url) => {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.text();
    } catch {
        return null;
    }
};

/** Fetch a font file's bytes (font URLs are CORS-open for @font-face use). */
const defaultFontBytesFetcher: FontBytesFetcher = async (url) => {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return new Uint8Array(await response.arrayBuffer());
    } catch {
        return null;
    }
};
