/**
 * Framer document extraction.
 *
 * Reads the current Framer document (canvas root → pages → nodes) and
 * converts it into the platform-neutral FramerDocument shape.
 */

import type {
    FramerDocument,
    FramerImage,
    FramerImageRef,
    FramerNode,
    FramerResponsiveOverride,
} from '@framer/compiler-parser';

import {
    probeFontsCapability,
    probeImageGetDataCapability,
    type CapabilityProbe,
    type CapabilityReport,
} from './capabilities';
import { fetchCodeFiles } from './code-files';
import type { ModuleTextFetcher } from './modules';
import type { ExtractionStatus, FramerApi, FramerCanvasRoot, FramerNodeLike, FramerPage, FramerSdkFont } from './sdk';
import { SDK_CALL_TIMEOUT_MS, withTimeout } from './sdk';
import { safeParseNode, type ImageResolutionMap, type ParseContext, type UnmatchedInstance } from './node';
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
async function fetchComponentMasters(api: FramerApi, callTimeout: number): Promise<FetchResult> {
    const map = new Map<string, SdkNode>();
    const byName = new Map<string, SdkNode>();
    if (typeof api.getNodesWithType !== 'function') {
        return {
            map,
            byName,
            status: {
                status: 'unavailable',
                reason: 'The SDK does not expose getNodesWithType; component masters cannot be read.',
            },
        };
    }
    try {
        const componentNodes = await withTimeout(
            api.getNodesWithType('ComponentNode'),
            callTimeout,
            'getNodesWithType(ComponentNode)',
        );
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
            return {
                map,
                byName,
                status: { status: 'empty', reason: 'getNodesWithType resolved but returned no ComponentNode masters.' },
            };
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
    /**
     * How long a single SDK call may take before it is treated as a hang and
     * degrades like a throw (defaults to `SDK_CALL_TIMEOUT_MS`). Injectable
     * so tests can verify the timeout path without waiting 10s.
     */
    sdkCallTimeoutMs?: number;
    /**
     * Load-progress callback for UIs — called at extraction milestones
     * (canvas read, fonts, components, code files, node-walk progress).
     * A large canvas walks hundreds of postMessage round-trips, which can
     * take tens of seconds: the loading UI must show progress, not silence.
     */
    onProgress?: (phase: string) => void;
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
 *
 * The runtime capability probe (passed in) separates the two failure
 * families: `getFonts` missing on the SDK object is an SDK capability gap
 * (update the plugin SDK), while a present API with `url: null` fonts means
 * those fonts genuinely have no downloadable source (custom fonts are not
 * exposed to plugins) — never conflated, never silently dropped.
 */
async function collectProjectFonts(
    api: FramerApi,
    fetcher: FontBytesFetcher,
    fontsProbe: CapabilityProbe,
    callTimeout: number,
    onProgress?: (phase: string) => void,
): Promise<{ fonts: FramerFontAsset[]; status: ExtractionStatus }> {
    if (typeof api.getFonts !== 'function') {
        // The probe (passed in) classified this as an SDK capability gap — its
        // reason names the missing method and the consequence. Reused verbatim
        // so the diagnostics say WHY, and never confuse this with fonts that
        // genuinely have no downloadable source (a present API + url: null).
        return {
            fonts: [],
            status: {
                status: 'unavailable',
                reason: fontsProbe.available
                    ? 'The SDK does not expose framer.getFonts; fonts are exported as metadata only.'
                    : fontsProbe.reason,
            },
        };
    }

    let sdkFonts: FramerSdkFont[];
    try {
        sdkFonts = await withTimeout(api.getFonts(), callTimeout, 'getFonts()');
    } catch (error) {
        return { fonts: [], status: classifyError('getFonts()', error) };
    }

    if (sdkFonts.length === 0) {
        return {
            fonts: [],
            status: {
                status: 'empty',
                reason: 'getFonts resolved but returned no fonts (custom fonts are not exposed to plugins).',
            },
        };
    }

    // Download all font files IN PARALLEL (bounded) instead of one-by-one:
    // every entry is its own downloadable file, and a sequential walk of
    // slow font CDNs stalled the whole load with no visible progress — the
    // single worst "stuck loading" offender on font-heavy projects.
    interface PendingFont {
        slot: number;
        family: string;
        weight: number;
        style: FramerFontAsset['style'];
        url: string;
        format: FramerFontAsset['sources'][number]['format'];
    }
    const slots: (FramerFontAsset | null)[] = new Array(sdkFonts.length).fill(null);
    const noSource: string[] = [];
    const pending: PendingFont[] = [];
    let withSource = 0;

    sdkFonts.forEach((sdkFont, slot) => {
        const family = sdkFont.family?.trim();
        if (!family) return;
        const weight = typeof sdkFont.weight === 'number' ? sdkFont.weight : 400;
        const style: FramerFontAsset['style'] = sdkFont.style === 'italic' ? 'italic' : 'normal';

        if (!sdkFont.url) {
            noSource.push(family);
            slots[slot] = { family, weight, style, sources: [] };
            return;
        }

        withSource += 1;
        pending.push({
            slot,
            family,
            weight,
            style,
            url: sdkFont.url,
            format: fontFormatFromUrl(sdkFont.url),
        });
    });

    const CONCURRENCY = 6;
    let downloaded = 0;
    const queue = [...pending];
    await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
            for (;;) {
                const font = queue.shift();
                if (!font) return;
                const bytes = await fetcher(font.url);
                slots[font.slot] = {
                    family: font.family,
                    weight: font.weight,
                    style: font.style,
                    sources: [{ url: font.url, format: font.format, ...(bytes ? { data: bytes } : {}) }],
                };
                downloaded += 1;
                onProgress?.(`Reading fonts… ${downloaded}/${pending.length}`);
            }
        }),
    );

    const fonts = slots.filter((font): font is FramerFontAsset => font !== null);

    const status: ExtractionStatus =
        noSource.length === 0
            ? { status: 'ok', count: withSource }
            : {
                  status: 'partial',
                  count: withSource,
                  failed: noSource.length,
                  reason: `${noSource.length} font(s) have no downloadable source file (${Array.from(new Set(noSource))
                      .slice(0, 5)
                      .join(
                          ', ',
                      )}${noSource.length > 5 ? ', …' : ''}) — framer.getFonts IS available, but these fonts' url is null: custom fonts are not exposed to the plugin API. This is a property of the fonts, not a missing API; the rest are bundled.`,
              };
    return { fonts, status };
}

/**
 * The outcome of folding replica overrides into their primaries.
 *
 * A replica is a breakpoint/variant override of a primary node (SDK
 * `isReplica` + `originalId`) — NOT a duplicated node. The fold attaches the
 * replica's overridden attributes to the primary's per-breakpoint
 * `responsive` behavior and prunes the replica from the emitted tree.
 */
export interface ReplicaFoldStats {
    /** Number of replica nodes recognized and folded into their primary. */
    folded: number;
    /**
     * Replicas whose primary could not be found in the document — kept as
     * independent nodes so nothing is silently dropped, and surfaced in the
     * extraction record.
     */
    unresolved: Array<{ id: string; name: string; originalId: string | null; breakpointName?: string }>;
    /**
     * Override kinds the responsive model cannot represent (e.g. an image
     * swap) — recorded so the export can say what could not fold, never
     * silently dropped.
     */
    unsupported: string[];
}

/**
 * Fold breakpoint/variant replica nodes into their primaries' responsive
 * behavior, pruning breakpoint tier frames and resolved replicas from the
 * emitted tree.
 *
 * Two passes: first index every primary node by id (non-replica, non-tier
 * nodes, recursively), then walk the tree folding each replica's overridden
 * attributes into `primary.responsive[breakpointName]` and dropping it.
 * Replicas whose primary is missing (walk order, engine-internal ids) are
 * KEPT as independent nodes and recorded — distinguishing them from the
 * resolved overrides is exactly what `isReplica` buys.
 */
export function foldReplicaOverrides(nodes: FramerNode[]): { nodes: FramerNode[]; stats: ReplicaFoldStats } {
    const stats: ReplicaFoldStats = { folded: 0, unresolved: [], unsupported: [] };

    // Pass 1 — index the INPUT primaries (a replica's `originalId` targets
    // these ids) so the walk can tell a resolvable replica from an orphan.
    const primaries = new Map<string, FramerNode>();
    const indexNode = (node: FramerNode): void => {
        if (node.source?.isReplica !== true && node.source?.isBreakpoint !== true) {
            primaries.set(node.id, node);
        }
        for (const child of node.children ?? []) indexNode(child);
    };
    for (const node of nodes) indexNode(node);

    // Pass 2 — build the emitted tree: breakpoint tier frames are pruned
    // (their children lift into the parent level), resolved replicas are
    // pruned with their (primaryId, breakpoint) recorded for the fold, and
    // unresolved replicas are KEPT as independent nodes — never dropped. A
    // walk returns an ARRAY so a pruned tier can still surface its kept
    // children at the same position.
    const pending: Array<{ primaryId: string; replica: FramerNode; breakpointName: string }> = [];
    const walk = (node: FramerNode): FramerNode[] => {
        if (node.source?.isBreakpoint === true) {
            // A tier frame is structural, not content: its children fold
            // into their primaries; any kept (unresolved) children surface
            // at the frame's position in the parent.
            return (node.children ?? []).flatMap(walk);
        }
        if (node.source?.isReplica === true) {
            const originalId = node.source.originalId ?? null;
            const breakpointName = node.source.breakpointName;
            if (originalId) {
                const primary = primaries.get(originalId);
                if (primary && breakpointName) {
                    // Resolved: prune now, fold once the emitted tree exists.
                    pending.push({ primaryId: originalId, replica: node, breakpointName });
                    // Nested replicas inside the replica subtree fold on their
                    // own — their originalIds target the primary tree.
                    for (const child of node.children ?? []) walk(child);
                    return [];
                }
            }
            // No primary, or no enclosing breakpoint tier was detected — the
            // override cannot be placed. Keep the node and walk its subtree.
            stats.unresolved.push({
                id: node.id,
                name: node.name,
                originalId,
                ...(breakpointName ? { breakpointName } : {}),
            });
        }
        return [
            {
                ...node,
                children: (node.children ?? []).flatMap(walk),
            },
        ];
    };
    const emitted = nodes.flatMap(walk);

    // Pass 3 — fold each pending replica into ITS emitted-tree primary (the
    // emitted nodes are fresh copies, so folding into the input primaries
    // would mutate objects the tree no longer references).
    const emittedIndex = new Map<string, FramerNode>();
    const indexEmitted = (node: FramerNode): void => {
        emittedIndex.set(node.id, node);
        for (const child of node.children ?? []) indexEmitted(child);
    };
    for (const node of emitted) indexEmitted(node);

    for (const { primaryId, replica, breakpointName } of pending) {
        const primary = emittedIndex.get(primaryId);
        if (!primary) {
            stats.unresolved.push({
                id: replica.id,
                name: replica.name,
                originalId: primaryId,
                ...(breakpointName ? { breakpointName } : {}),
            });
            continue;
        }
        stats.folded += 1;
        foldReplicaIntoPrimary(primary, replica, breakpointName, stats);
    }

    return { nodes: emitted, stats };
}

/** Fold one replica's overridden attributes into its primary's responsive behavior. */
function foldReplicaIntoPrimary(
    primary: FramerNode,
    replica: FramerNode,
    breakpointName: string,
    stats: ReplicaFoldStats,
): void {
    const { override, unsupported } = buildResponsiveOverride(primary, replica);
    for (const reason of unsupported) stats.unsupported.push(reason);
    if (Object.keys(override).length === 0) return; // pure duplicate — inherits everything

    primary.responsive = {
        ...primary.responsive,
        [breakpointName]: mergeResponsiveOverride(primary.responsive?.[breakpointName], override),
    };
}

/**
 * Diff a replica's parsed attributes against its primary's — the overridden
 * values are the per-breakpoint override. Inherited (equal) values produce
 * nothing, so a replica that changed nothing folds to an empty override.
 */
function buildResponsiveOverride(
    primary: FramerNode,
    replica: FramerNode,
): { override: FramerResponsiveOverride; unsupported: string[] } {
    const override: FramerResponsiveOverride = {};
    const unsupported: string[] = [];
    const p = primary.layout ?? {};
    const r = replica.layout ?? {};

    // Layout (flex fields the responsive model can override).
    const layout: NonNullable<FramerResponsiveOverride['layout']> = {};
    if (r.direction && r.direction !== p.direction) layout.direction = r.direction;
    if (r.alignItems && r.alignItems !== p.alignItems) layout.alignItems = r.alignItems;
    if (r.justifyContent && r.justifyContent !== p.justifyContent) layout.justifyContent = r.justifyContent;
    if (r.flexWrap && r.flexWrap !== p.flexWrap) layout.flexWrap = r.flexWrap;
    if (r.gap !== undefined && r.gap !== p.gap) layout.gap = r.gap;
    if (Object.keys(layout).length > 0) override.layout = layout;

    // Sizing — explicit px width/height come from the frame rect (the layout
    // parser keeps only the mode); the rest compare sizing fields.
    const ps = p.sizing ?? {};
    const rs = r.sizing ?? {};
    const sizing: NonNullable<FramerResponsiveOverride['sizing']> = {};
    const primaryW = primary.frame?.width;
    const replicaW = replica.frame?.width;
    const primaryH = primary.frame?.height;
    const replicaH = replica.frame?.height;
    if (primaryW !== undefined && replicaW !== undefined && replicaW !== primaryW) sizing.width = replicaW;
    if (primaryH !== undefined && replicaH !== undefined && replicaH !== primaryH) sizing.height = replicaH;
    if (rs.widthMode && rs.widthMode !== ps.widthMode) sizing.widthMode = rs.widthMode;
    if (rs.heightMode && rs.heightMode !== ps.heightMode) sizing.heightMode = rs.heightMode;
    if (rs.minWidth !== undefined && rs.minWidth !== ps.minWidth) sizing.minWidth = rs.minWidth;
    if (rs.maxWidth !== undefined && rs.maxWidth !== ps.maxWidth) sizing.maxWidth = rs.maxWidth;
    if (rs.minHeight !== undefined && rs.minHeight !== ps.minHeight) sizing.minHeight = rs.minHeight;
    if (rs.maxHeight !== undefined && rs.maxHeight !== ps.maxHeight) sizing.maxHeight = rs.maxHeight;
    if (rs.aspectRatio !== undefined && rs.aspectRatio !== ps.aspectRatio) sizing.aspectRatio = rs.aspectRatio;
    if (Object.keys(sizing).length > 0) override.sizing = sizing;

    // Spacing (padding). The model carries a complete inset, so when any side
    // differs the replica's full padding is the override — unchanged sides
    // re-emit the primary's own values, which is redundant but exact.
    const rp = r.padding;
    if (rp) {
        const pp = p.padding;
        const changed = pp
            ? rp.top !== pp.top || rp.right !== pp.right || rp.bottom !== pp.bottom || rp.left !== pp.left
            : true;
        if (changed) override.spacing = { padding: rp };
    }

    // Typography (fontSize / color) + visual opacity.
    const style: NonNullable<FramerResponsiveOverride['style']> = {};
    const pt = primary.text?.style;
    const rt = replica.text?.style;
    if (rt?.fontSize !== undefined && rt.fontSize !== pt?.fontSize) style.fontSize = rt.fontSize;
    if (rt?.color !== undefined && rt.color !== pt?.color) style.color = rt.color;
    const po = primary.style?.opacity;
    const ro = replica.style?.opacity;
    if (ro !== undefined && ro !== po) style.opacity = ro;
    if (Object.keys(style).length > 0) override.style = style;

    // Visibility.
    const pv = primary.style?.visible;
    const rv = replica.style?.visible;
    if (rv !== undefined && rv !== pv) override.visible = rv;

    // Image swaps/removals — the replica overrides the image at this tier.
    // The responsive model now carries a per-breakpoint image (src + the
    // already-resolved bytes + fit), so a swap folds instead of being
    // recorded as unsupported. The alternate src ships as a local file
    // (collected from the override by collectAssets) and the generators
    // swap the rendered image per tier.
    const primaryImage = nodeImageRef(primary);
    const replicaImage = nodeImageRef(replica);
    if (replicaImage && replicaImage.src !== primaryImage?.src) {
        // A real swap: carry the replica's full image ref so the bytes the
        // plugin resolved (getData / fetch) survive the prune. Both node
        // shapes (FramerImage / FramerImageRef) carry the same rendered ref.
        override.image = replicaImage as FramerImageRef;
    } else if (!replicaImage && primaryImage) {
        // The image was REMOVED at this tier: a standalone image node is
        // gone entirely (hide it — no box), a frame keeps its box but loses
        // the background fill (`src: ''` → background-image: none).
        if (primary.type === 'Image') {
            override.visible = false;
        } else {
            override.image = {
                src: '',
                objectFit: primaryImage.objectFit as FramerImageRef['objectFit'],
                objectPosition: primaryImage.objectPosition,
            };
        }
    }
    if (replica.vector?.svg && replica.vector.svg !== primary.vector?.svg) {
        unsupported.push(`svg override on replica '${replica.name}' (${replica.id})`);
    }

    return { override, unsupported };
}

/**
 * The image reference a node renders: a standalone image node's `image`, else
 * its first image fill (a frame whose background is an image).
 */
function nodeImageRef(node: FramerNode): FramerImage | FramerImageRef | undefined {
    if (node.image?.src) return node.image;
    const fill = (node.style?.fills ?? []).find((f) => f.type === 'image' && f.image?.src);
    return fill?.image;
}

/** Merge a new override into an existing one for the same (primary, breakpoint). */
function mergeResponsiveOverride(
    existing: FramerResponsiveOverride | undefined,
    incoming: FramerResponsiveOverride,
): FramerResponsiveOverride {
    return {
        ...(existing?.layout || incoming.layout ? { layout: { ...existing?.layout, ...incoming.layout } } : {}),
        ...(existing?.sizing || incoming.sizing ? { sizing: { ...existing?.sizing, ...incoming.sizing } } : {}),
        ...(existing?.spacing || incoming.spacing
            ? {
                  spacing: {
                      padding: incoming.spacing?.padding ?? existing?.spacing?.padding,
                  },
              }
            : {}),
        ...(existing?.style || incoming.style ? { style: { ...existing?.style, ...incoming.style } } : {}),
        ...(incoming.visible !== undefined ? { visible: incoming.visible } : {}),
        // Image override: last fold for the tier wins (one replica per tier).
        ...(() => {
            const image = incoming.image ?? existing?.image;
            return image ? { image } : {};
        })(),
    };
}

/**
 * Whether a node is a page node (`webPage` / `designPage`).
 *
 * Real SDK nodes carry their class kind in `nodeType`; the getChildren()
 * presence alone cannot tell a v4 page from a v4 content frame (both expose
 * it), which is exactly how the legacy-page heuristic dropped top-level
 * content when the page enumeration was unavailable.
 */
function isPageNode(node: FramerNodeLike | FramerPage): boolean {
    const type = typeof node.nodeType === 'string' ? node.nodeType.toLowerCase().replace(/[^a-z]/g, '') : '';
    return type === 'webpage' || type === 'designpage';
}

/** Extract the full Framer document from the SDK. */
export async function extractFramerDocument(
    api: FramerApi,
    options: ExtractFramerDocumentOptions = {},
): Promise<FramerDocument> {
    // A canvas the engine cannot read must not abort the whole load — degrade
    // to an empty document rather than fail the extraction. The reason is
    // recorded so a timed-out / denied canvas root is never a SILENT empty
    // state (the export diagnostics can say the engine did not answer).
    const callTimeout = options.sdkCallTimeoutMs ?? SDK_CALL_TIMEOUT_MS;
    const onProgress = options.onProgress;
    const startedAt = Date.now();
    onProgress?.('Reading the canvas…');
    let root: FramerCanvasRoot | null = null;
    let rootError: string | null = null;
    try {
        root = await withTimeout(api.getCanvasRoot(), callTimeout, 'getCanvasRoot');
    } catch (error) {
        root = null;
        rootError = error instanceof Error ? error.message : String(error);
    }
    if (!root) {
        return {
            id: 'canvas',
            name: 'Framer Document',
            version: '1.0.0',
            nodes: [],
            metadata: {
                platform: 'framer',
                extraction: {
                    canvasRoot: {
                        status: 'error',
                        reason: `The Framer engine did not return a canvas root (${rootError ?? 'null'}). The project could not be read.`,
                    },
                },
            },
        };
    }

    // Enumerate the canvas pages to walk.
    //
    // Two SDK generations must be handled:
    //   • v4 `@framer/plugin` — `getCanvasRoot()` returns the ACTIVE page node
    //     whose `getChildren()` are the top-level canvas content nodes directly
    //     (NO intermediate pages layer). Any additional pages (web/design) are
    //     discovered via `getNodesWithType('WebPageNode'|'DesignPageNode')`.
    //   • legacy SDK — the root object's children WERE an array of pages, each
    //     with its own `getChildren()`.
    //
    // The reliable discriminator is the root's OWN node class — real SDK nodes
    // always carry `nodeType` — NOT the page enumeration (which can be
    // unavailable/denied) and NOT the children's getChildren() presence (v4
    // content frames expose getChildren exactly like legacy page nodes, so the
    // old heuristic silently misread v4 content as legacy pages and dropped
    // every top-level section when the page enumeration came up empty).
    let pages: FramerPage[] = [];
    let flatCanvasChildren: SdkNode[] = [];
    let rootChildren: FramerNodeLike[] = [];
    try {
        rootChildren = await withTimeout(root.getChildren(), callTimeout, 'getChildren(canvas root)');
    } catch {
        rootChildren = [];
    }

    let enumeratedPages: FramerPage[] = [];
    let rootIsEnumeratedPage = false;
    if (typeof api.getNodesWithType === 'function') {
        try {
            const [webPages, designPages] = await Promise.all([
                withTimeout(api.getNodesWithType('WebPageNode'), callTimeout, 'getNodesWithType(WebPageNode)'),
                withTimeout(api.getNodesWithType('DesignPageNode'), callTimeout, 'getNodesWithType(DesignPageNode)'),
            ]);
            const allPages = [...(webPages ?? []), ...(designPages ?? [])];
            rootIsEnumeratedPage = allPages.some((page) => page.id === root.id);
            enumeratedPages = allPages
                .filter((page) => page.id !== root.id)
                .map((page) => page as unknown as FramerPage);
        } catch {
            enumeratedPages = [];
        }
    }

    // v4: the root IS a page/content node (WebPageNode | DesignPageNode |
    // ComponentNode | VectorSetNode) whose children are top-level content —
    // even when the page enumeration is unavailable, the root's own nodeType
    // says so. This also covers editing a component: the root is a ComponentNode,
    // not a page, but its children are still content.
    const rootIsV4ContentNode = rootIsEnumeratedPage || typeof (root as FramerNodeLike).nodeType === 'string';
    if (rootIsV4ContentNode) {
        // v4: the root's children are top-level content; OTHER pages come
        // from the project-wide node enumeration.
        flatCanvasChildren = rootChildren as unknown as SdkNode[];
        pages = enumeratedPages;
    } else {
        // Legacy shape: the root is a plain root object whose children ARE
        // page nodes. Guarded by the page-node check so v4 content can never
        // be mistaken for legacy pages (a v4 content frame's nodeType is
        // 'frame'/'text'/…, never 'webPage'/'designPage').
        const rootChildrenAreLegacyPages =
            rootChildren.length > 0 &&
            rootChildren.every((child) => typeof (child as FramerPage).getChildren === 'function' && isPageNode(child));
        if (rootChildrenAreLegacyPages) {
            pages = rootChildren as unknown as FramerPage[];
        } else {
            flatCanvasChildren = rootChildren as unknown as SdkNode[];
            pages = enumeratedPages;
        }
    }

    // Project-wide fonts come from getFonts() (one entry per weight/style,
    // each with a downloadable file URL); the bytes are fetched so the export
    // is self-contained. Custom fonts are not exposed to plugins — recorded,
    // never silently dropped. The runtime capability probe runs first so the
    // "API missing" (SDK surface gap) and "font has no downloadable source"
    // (custom font) cases are never conflated in the diagnostics.
    onProgress?.('Reading fonts…');
    const fontsProbe = probeFontsCapability(api);
    const fontFetch = await collectProjectFonts(
        api,
        options.fontFetcher ?? defaultFontBytesFetcher,
        fontsProbe,
        callTimeout,
        onProgress,
    );

    // Component masters give every instance its real definition body (slot
    // positions + per-slot props) instead of a synthesized approximation.
    onProgress?.('Reading components…');
    const masters = await fetchComponentMasters(api, callTimeout);
    // Code files give every code-component instance its REAL source — the
    // true implementation instead of a synthesized approximation.
    onProgress?.('Reading code files…');
    const codeFiles = await fetchCodeFiles(api, callTimeout);
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
        sdkCallTimeoutMs: callTimeout,
        moduleCache: new Map(),
        modulePaths: new Set(),
        moduleFailures: [],
    };

    const walkedNodes: FramerNode[] = [];
    let walked = 0;
    const progressEvery = 25;
    // v4: the ACTIVE page's own children are top-level content (the root IS
    // the active page). Walk them first so the current canvas is never empty.
    for (const child of flatCanvasChildren) {
        walkedNodes.push(await safeParseNode(child, context));
        if (++walked % progressEvery === 0) onProgress?.(`Reading nodes… ${walked}`);
    }
    for (const page of pages) {
        // A page the SDK cannot walk must not abort the whole extraction —
        // the remaining pages still load.
        let children: SdkNode[] = [];
        try {
            children = (await withTimeout(page.getChildren(), callTimeout, `getChildren(${page.id})`)) as SdkNode[];
        } catch {
            children = [];
        }
        for (const child of children) {
            walkedNodes.push(await safeParseNode(child, context));
            if (++walked % progressEvery === 0) onProgress?.(`Reading nodes… ${walked}`);
        }
    }
    // Diagnostic: a zero-scan is immediately visible in the dev tools instead
    // of a silent empty state. The page count is the active root (when its
    // children were walked as content) plus the enumerated additional pages.
    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.info(
        `[framerx] extracted ${walkedNodes.length} top-level node(s) across ${(flatCanvasChildren.length > 0 ? 1 : 0) + pages.length} canvas page(s) in ${elapsedSeconds}s`,
    );
    onProgress?.('Building the document…');

    // Responsive replicas (SDK `isReplica`) are breakpoint/variant OVERRIDES
    // of a primary node, not duplicated content: fold each replica's
    // overridden attributes into the primary's per-breakpoint responsive
    // behavior and prune the replica from the emitted tree. Breakpoint tier
    // frames (structural) are pruned too. The stats surface how many folded
    // and which could not (no primary / no tier / unsupported override kind).
    const { nodes, stats: replicaStats } = foldReplicaOverrides(walkedNodes);

    // NOTE: metadata deliberately carries no export timestamp — the exporter
    // must be deterministic: the same document must produce the same output
    // on every run.
    // Instances that matched neither a master nor a code file — the EXACT
    // keys they carried, so the export can say "this instance looked up
    // componentIdentifier X / insertURL Y and nothing matched" instead of a
    // flat "synthesized". Shared only when something actually went unmatched.
    const unmatched = (context.unmatchedInstances ?? []).filter(
        (instance, index, all) => all.findIndex((other) => other.id === instance.id) === index,
    );
    // Shared-module resolution outcome: how many published bundles resolved
    // to real implementations vs. failed to fetch (each counted once per
    // unique URL). Omitted when the document carries no module instances.
    const moduleStats = moduleExtractionStatus(context);
    // Image byte-resolution outcome: how many images got their ORIGINAL bytes
    // via `getData()` vs. fell back to a URL fetch (`unavailable`) vs. failed
    // outright (`failed`, with reasons). Omitted when the document carries no
    // SDK image assets.
    const imageStats = imageExtractionStatus(context);
    // Runtime capability report: whether the SDK surface exposes the APIs the
    // export depends on (framer.getFonts, ImageAsset.getData) — the probe that
    // tells "SDK capability gap" apart from "entity genuinely has no
    // downloadable source" (a font whose url is null). The image probe is
    // omitted when the document carried no image assets.
    const imageProbe = probeImageGetDataCapability(context);
    const capabilityReport: CapabilityReport = {
        getFonts: fontsProbe,
        ...(imageProbe ? { imageGetData: imageProbe } : {}),
    };
    // Replica folding outcome: how many breakpoint/variant overrides were
    // recognized and folded into their primary (ok), vs. how many could not
    // be placed (partial — kept as independent nodes / unsupported kinds).
    // Omitted when the document carries no replicas.
    const replicaStatus = replicaExtractionStatus(replicaStats);
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
                capabilities: capabilityReport,
                ...(imageStats ? { images: imageStats } : {}),
                ...(replicaStatus ? { replicas: replicaStatus } : {}),
                ...(moduleStats ? { modules: moduleStats } : {}),
                ...(unmatched.length > 0 ? { unmatchedInstances: unmatched as UnmatchedInstance[] } : {}),
            },
        },
    };

    // Responsive breakpoints: prefer an explicit SDK scale; otherwise derive
    // the scale from the canvas's own breakpoint tier frames (name + design
    // width). The SDK v4 canvas root exposes NO breakpoint scale, so without
    // the tier-derived fallback every folded override (keyed by tier name)
    // fails to resolve during code generation and the responsive styles are
    // silently dropped.
    if (Array.isArray(root.breakpoints) && root.breakpoints.length > 0) {
        document.breakpoints = root.breakpoints.map((bp) => ({ name: bp.name, minWidth: bp.minWidth }));
    } else {
        const tiers = collectBreakpointTiers(walkedNodes);
        if (tiers.length > 0) document.breakpoints = tiers;
    }

    return document;
}

/**
 * Breakpoint tiers discovered in the parsed canvas: non-primary breakpoint
 * frames (`source.isBreakpoint`), keyed by their canvas name — the EXACT key
 * replica overrides are folded under — with the frame's design width as the
 * mobile-first min-width. Sorted smallest first.
 */
function collectBreakpointTiers(nodes: FramerNode[]): Array<{ name: string; minWidth: number }> {
    const byName = new Map<string, { name: string; minWidth: number }>();
    for (const node of nodes) {
        if (node.source?.isBreakpoint !== true) continue;
        const name = node.name?.trim();
        const width = node.frame?.width ?? 0;
        if (!name || width <= 0) continue;
        if (!byName.has(name)) byName.set(name, { name, minWidth: Math.round(width) });
    }
    return [...byName.values()].sort((a, b) => a.minWidth - b.minWidth);
}

/**
 * The outcome of image byte resolution for one extraction.
 *
 * `ok` when every SDK image asset resolved its ORIGINAL bytes (via `getData()`
 * or pre-attached data), `partial` when some fell back to a URL fetch
 * (`unavailable` — no `getData` on the object, the documented fallback) or
 * failed outright (`failed` — `getData()` threw; the reason names the exact
 * URLs and errors). Undefined when the document carried no SDK image assets.
 */
function imageExtractionStatus(context: ParseContext): ExtractionStatus | undefined {
    const resolutions: ImageResolutionMap | undefined = context.imageResolutions;
    if (!resolutions || resolutions.size === 0) return undefined;

    let resolved = 0;
    const unavailable: string[] = [];
    const failed: Array<{ url?: string; error: string }> = [];
    for (const outcome of resolutions.values()) {
        if (outcome.kind === 'resolved') {
            resolved += 1;
        } else if (outcome.kind === 'unavailable') {
            unavailable.push(outcome.url ?? '(no URL)');
        } else {
            failed.push({ url: outcome.url, error: outcome.error });
        }
    }

    if (failed.length === 0 && unavailable.length === 0) {
        return { status: 'ok', count: resolved };
    }

    const reasonParts: string[] = [];
    if (failed.length > 0) {
        const sample = failed
            .slice(0, 3)
            .map((f) => `${f.url ?? '(no URL)'}: ${f.error}`)
            .join('; ');
        reasonParts.push(
            `${failed.length} image(s) could not read original bytes via getData (${sample}${failed.length > 3 ? '; …' : ''})`,
        );
    }
    if (unavailable.length > 0) {
        reasonParts.push(
            `${unavailable.length} image(s) exposed no getData (the SDK surface did not provide ImageAsset.getData on those assets) — exported via URL fetch (remote reference)`,
        );
    }
    return {
        status: 'partial',
        count: resolved,
        failed: failed.length + unavailable.length,
        reason: reasonParts.join('; '),
    };
}

/**
 * The outcome of replica folding for one extraction.
 *
 * `ok` when every replica was recognized and folded into its primary's
 * responsive behavior, `partial` when some could not be placed (no matching
 * primary / no enclosing breakpoint tier / an override kind the responsive
 * model cannot represent), and undefined when the document carried no
 * replicas at all — nothing to report.
 */
function replicaExtractionStatus(stats: ReplicaFoldStats): ExtractionStatus | undefined {
    if (stats.folded === 0 && stats.unresolved.length === 0 && stats.unsupported.length === 0) return undefined;
    if (stats.unresolved.length === 0 && stats.unsupported.length === 0) {
        return { status: 'ok', count: stats.folded };
    }

    const reasonParts: string[] = [];
    if (stats.unresolved.length > 0) {
        const sample = stats.unresolved
            .slice(0, 3)
            .map((u) => `'${u.name}' (${u.originalId ?? 'no originalId'})`)
            .join('; ');
        reasonParts.push(
            `${stats.unresolved.length} replica(s) had no matching primary node (${sample}${stats.unresolved.length > 3 ? '; …' : ''}) and were kept as independent nodes`,
        );
    }
    if (stats.unsupported.length > 0) {
        const sample = stats.unsupported.slice(0, 3).join('; ');
        reasonParts.push(`unsupported override kind(s): ${sample}${stats.unsupported.length > 3 ? '; …' : ''}`);
    }
    return {
        status: 'partial',
        count: stats.folded,
        failed: stats.unresolved.length + stats.unsupported.length,
        reason: reasonParts.join('; '),
        // Exact counts for the export manifest (the manifest's `replicas`
        // section reports discovered / folded / unresolved / unsupported).
        unresolved: stats.unresolved.length,
        unsupported: stats.unsupported.length,
    };
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
        const response = await withTimeout(fetch(url), SDK_CALL_TIMEOUT_MS, `fetch module ${url}`);
        if (!response.ok) return null;
        return await withTimeout(response.text(), SDK_CALL_TIMEOUT_MS, `read module ${url}`);
    } catch {
        return null;
    }
};

/** Fetch a font file's bytes (font URLs are CORS-open for @font-face use). */
const defaultFontBytesFetcher: FontBytesFetcher = async (url) => {
    try {
        const response = await withTimeout(fetch(url), SDK_CALL_TIMEOUT_MS, `fetch font ${url}`);
        if (!response.ok) return null;
        return new Uint8Array(await withTimeout(response.arrayBuffer(), SDK_CALL_TIMEOUT_MS, `read font ${url}`));
    } catch {
        return null;
    }
};
