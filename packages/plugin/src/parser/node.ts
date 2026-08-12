/**
 * Framer SDK node → FramerNode mapping.
 *
 * This is the Framer-specific half of the pipeline: it converts SDK design
 * objects into the platform-neutral FramerDocument shape consumed by the
 * @framer/compiler-parser package.
 */

import type { FramerInteraction, FramerNode } from '@framer/compiler-parser';

import { matchCodeFile, resolveCodeClosure, type CodeFileIndex } from './code-files';
import {
    isModuleBacked,
    moduleExportName,
    moduleUrlOf,
    resolveModuleClosure,
    type ModuleClosure,
    type ModuleTextFetcher,
} from './modules';
import { parseLayout } from './layout';
import { SDK_CALL_TIMEOUT_MS, withTimeout } from './sdk';
import type { SdkImageAsset, SdkNode } from './sdk-types';
import {
    getSdkImageUrl,
    isSdkComponentNode,
    isSdkImageNode,
    isSdkSlotNode,
    isSdkTextNode,
    isSdkVectorNode,
    normalizeSlotName,
} from './sdk-types';
import { parseStyle } from './style';
import { parseText } from './typography';

/** The outcome of resolving one image asset's ORIGINAL bytes. */
export type ImageResolution =
    { kind: 'resolved' } | { kind: 'unavailable'; url?: string } | { kind: 'failed'; url?: string; error: string };

/**
 * Per-asset image resolution outcomes, keyed by the asset id (or the asset
 * object when it carries no id) so repeated references count once.
 */
export type ImageResolutionMap = Map<string | SdkImageAsset, ImageResolution>;

/** An instance that resolved neither a master nor a code file (will be synthesized). */
export interface UnmatchedInstance {
    /** The instance's own node id. */
    id: string;
    /** The instance's display name (fallback: the component name). */
    name: string;
    /** The identifier the instance carried (may be null — a key we looked up). */
    componentIdentifier?: string | null;
    /** The insert URL the instance carried (may be null). */
    insertURL?: string | null;
    /** The component name the instance carried (may be null). */
    componentName?: string | null;
}

/**
 * The parse context threaded through the SDK tree.
 *
 * `masters` maps component identifier → SDK master definition; parsed masters
 * are cached in `parsedMasters` so the same master parses once per document
 * extraction (deterministic, no wasted work). `inMaster` scopes slot
 * detection to master bodies — a node named 'Slot' on the regular canvas is
 * ordinary content, not a placeholder.
 */
export interface ParseContext {
    /** Raw SDK component masters keyed by componentIdentifier. */
    masters?: ReadonlyMap<string, SdkNode>;
    /** Raw SDK component masters keyed by componentName (last-resort match). */
    mastersByName?: ReadonlyMap<string, SdkNode>;
    /** Parsed masters cache (identifier → FramerNode body). */
    parsedMasters?: Map<string, FramerNode>;
    /** Master identifiers currently being parsed (mutual-recursion guard). */
    parsingMasters?: Set<string>;
    /** Whether this subtree is inside a component master body. */
    inMaster?: boolean;
    /** The master root node id (the master must not resolve itself). */
    masterRoot?: string;
    /**
     * The code-file index (code components have no canvas master — their
     * definition is the real source). Fetched once per extraction.
     */
    codeFiles?: CodeFileIndex;
    /**
     * Instances that resolved neither a master nor a code file. Surfaced in
     * `metadata.extraction.unmatchedInstances` so the export can name the
     * EXACT keys it looked up and failed — the difference between "the API
     * is down" and "the instance carries an id nothing matches".
     */
    unmatchedInstances?: UnmatchedInstance[];
    /**
     * Fetcher for shared-module bundles (published code components on Framer's
     * CDN — the instance's insertURL IS the bundle). Injectable for tests;
     * the document extraction installs a real `fetch`-based fetcher.
     */
    moduleFetcher?: ModuleTextFetcher;
    /** Resolved module closures by bundle URL (deduplicated across instances). */
    moduleCache?: Map<string, ModuleClosure | null>;
    /**
     * Local paths already assigned by module closures — shared across every
     * bundle of one extraction so two bundles with the same file name never
     * collide in the emitted project.
     */
    modulePaths?: Set<string>;
    /** Module bundles that could not be fetched — surfaced in extraction metadata. */
    moduleFailures?: Array<{ url: string; name: string }>;
    /**
     * Cache of `ImageAsset.getData()` results, keyed by the asset id (or the
     * asset object when it carries no id). The same uploaded image referenced
     * by many nodes resolves its ORIGINAL bytes exactly once per extraction.
     */
    imageDataCache?: Map<string | SdkImageAsset, { bytes: Uint8Array; mimeType: string }>;
    /**
     * Image byte-resolution outcomes, keyed by asset id (or object). Surfaced
     * in `metadata.extraction.images` so the export diagnostics can report
     * how many images got their ORIGINAL bytes via `getData()` vs. fell back
     * to a URL fetch (`unavailable`) vs. failed outright (`failed`, with
     * reasons) — never only a console log.
     */
    imageResolutions?: ImageResolutionMap;
    /**
     * Runtime capability probe for `ImageAsset.getData()`: whether any image
     * asset that needed ORIGINAL bytes was encountered (the probe ran) and
     * whether at least one of them exposed `getData` as a function. Feeds
     * `metadata.extraction.capabilities.imageGetData` so the diagnostics can
     * distinguish "the SDK surface cannot read original bytes" (capability
     * gap) from "getData exists but failed for these assets" (transient).
     */
    imageGetDataSeen?: boolean;
    imageGetDataAvailable?: boolean;
    /**
     * How long a single SDK call may take before it is treated as a hang and
     * degrades like a throw (defaults to `SDK_CALL_TIMEOUT_MS`). The document
     * extraction threads its injectable value through so tests can verify the
     * timeout path without waiting 10s.
     */
    sdkCallTimeoutMs?: number;
}

/** Map an SDK node to its Framer node type string. */
export function classifyNodeType(node: SdkNode): string {
    if (isSdkTextNode(node)) return 'Text';
    if (isSdkVectorNode(node)) return 'Vector';
    if (isSdkComponentNode(node)) return 'Component';
    if (isSdkImageNode(node)) return 'Image';
    return 'Frame';
}

/** Extract scalar props from a component's controls. */
export function extractProps(controls?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!controls) return undefined;
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(controls)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            props[key] = value;
        }
    }
    return Object.keys(props).length > 0 ? props : undefined;
}

/** Build interactions from a node's link attributes. */
function parseInteractions(node: SdkNode): FramerInteraction[] | undefined {
    if (!node.link) return undefined;
    return [
        {
            type: 'link',
            trigger: 'tap',
            url: node.link,
            newTab: node.linkOpenInNewTab ?? false,
        },
    ];
}

/**
 * Get the frame rect of a node, falling back to width/height attributes.
 *
 * A single node whose rect cannot be read must never abort the whole document
 * extraction — it degrades to its width/height attributes, or zeros.
 */
async function parseFrame(
    node: SdkNode,
    context: ParseContext,
): Promise<{ x: number; y: number; width: number; height: number }> {
    const callTimeout = context.sdkCallTimeoutMs ?? SDK_CALL_TIMEOUT_MS;
    let rect: { x: number; y: number; width: number; height: number } | null = null;
    try {
        rect = await withTimeout(node.getRect(), callTimeout, 'getRect');
    } catch {
        rect = null;
    }
    if (rect) return rect;
    const toNumber = (value?: string | null): number => {
        const match = value ? /^([\d.]+)px$/.exec(value) : null;
        return match ? Number(match[1]) : 0;
    };
    return {
        x: 0,
        y: 0,
        width: toNumber(node.width),
        height: toNumber(node.height),
    };
}

/**
 * Resolve the ORIGINAL image bytes for every image-bearing attribute on a
 * node, preferring the SDK's `ImageAsset.getData()` (raw bytes + MIME type)
 * over a URL fetch or a canvas re-encode that would destroy the original
 * format and quality.
 *
 * The resolved bytes/mimeType are written back onto the SDK image object so
 * every downstream consumer (style image fills, standalone image nodes) reads
 * the same source of truth. When `getData` is absent or fails, the object
 * keeps whatever pre-attached data it had — and ultimately the exporter's URL
 * fetch fallback — never silently degraded.
 */
async function resolveNodeImageBytes(node: SdkNode, context: ParseContext): Promise<void> {
    const images: SdkImageAsset[] = [];
    if (node.image && typeof node.image === 'object') images.push(node.image);
    if (node.backgroundImage && typeof node.backgroundImage === 'object') images.push(node.backgroundImage);
    for (const fill of node.fills ?? []) {
        if (fill.type === 'image' && fill.image && typeof fill.image === 'object') images.push(fill.image);
    }
    for (const sdkImage of images) {
        await resolveSdkImageBytes(sdkImage, context);
    }
}

/**
 * Record an image resolution outcome once per asset (the first resolution
 * of a given asset wins; repeated references must not inflate the counts).
 */
function recordImageResolution(sdkImage: SdkImageAsset, context: ParseContext, outcome: ImageResolution): void {
    if (!context.imageResolutions) context.imageResolutions = new Map();
    const key: string | SdkImageAsset = sdkImage.id ?? sdkImage;
    if (!context.imageResolutions.has(key)) context.imageResolutions.set(key, outcome);
}

/** Prefer `getData()` raw bytes; keep attached data / URL fetch as fallback. */
async function resolveSdkImageBytes(sdkImage: SdkImageAsset, context: ParseContext): Promise<void> {
    // Already-attached original bytes win over a re-fetch — never overwrite
    // the source's own bytes.
    if (sdkImage.data && sdkImage.data.byteLength > 0) {
        recordImageResolution(sdkImage, context, { kind: 'resolved' });
        return;
    }
    // Original bytes are needed — this asset is the getData capability probe.
    context.imageGetDataSeen = true;
    if (typeof sdkImage.getData !== 'function') {
        // No getData on the SDK object — the exporter's URL fetch is the
        // documented fallback. Tracked (not only logged) so the export can
        // report how many images relied on a remote reference.
        recordImageResolution(sdkImage, context, { kind: 'unavailable', url: sdkImage.url ?? sdkImage.src });
        return;
    }
    // The SDK surface DOES expose getData — even a later throw is a
    // transient failure, not a missing capability.
    context.imageGetDataAvailable = true;

    const cache = context.imageDataCache ?? (context.imageDataCache = new Map());
    const key: string | SdkImageAsset = sdkImage.id ?? sdkImage;
    const cached = cache.get(key);
    if (cached) {
        sdkImage.data = cached.bytes;
        sdkImage.mimeType = cached.mimeType;
        recordImageResolution(sdkImage, context, { kind: 'resolved' });
        return;
    }
    const callTimeout = context.sdkCallTimeoutMs ?? SDK_CALL_TIMEOUT_MS;
    try {
        const result = await withTimeout(sdkImage.getData(), callTimeout, 'ImageAsset.getData()');
        if (result && result.bytes && result.bytes.byteLength > 0) {
            sdkImage.data = result.bytes;
            if (result.mimeType) sdkImage.mimeType = result.mimeType;
            cache.set(key, { bytes: result.bytes, mimeType: result.mimeType });
            recordImageResolution(sdkImage, context, { kind: 'resolved' });
        } else {
            recordImageResolution(sdkImage, context, { kind: 'unavailable', url: sdkImage.url ?? sdkImage.src });
        }
    } catch (error) {
        // getData failed (transient engine state, unexpected surface) — keep
        // the URL so the exporter's fetch fallback still produces a real file.
        recordImageResolution(sdkImage, context, {
            kind: 'failed',
            url: sdkImage.url ?? sdkImage.src,
            error: error instanceof Error ? error.message : String(error),
        });
        console.warn(
            '[framerx] image getData failed; falling back to URL fetch',
            error instanceof Error ? error.message : error,
        );
    }
}

/**
 * Convert a single SDK node (and its subtree) to a FramerNode.
 *
 * `breakpointName` is the enclosing breakpoint tier (a node with
 * `isBreakpoint === true` and not the primary): its children are the replica
 * tree for that breakpoint, so they carry `source.breakpointName`. Replica
 * nodes (`isReplica === true`) additionally carry their `originalId` — the
 * primary node they derive from — so the fold pass can attach their
 * overrides to the primary instead of emitting them as duplicated content.
 */
export async function parseSdkNode(
    node: SdkNode,
    context: ParseContext = {},
    breakpointName?: string,
): Promise<FramerNode> {
    const callTimeout = context.sdkCallTimeoutMs ?? SDK_CALL_TIMEOUT_MS;
    // Original image bytes first: `getData()` (raw bytes + MIME) beats a URL
    // fetch / canvas re-encode. Runs before `base` is built so parseStyle and
    // the image branch read the resolved bytes.
    await resolveNodeImageBytes(node, context);
    let type = classifyNodeType(node);
    // Slot placeholders exist only inside component masters — recognize them
    // there so the master's slot positions survive into the definition body.
    if (context.inMaster && isSdkSlotNode(node)) type = 'Slot';

    // A non-primary breakpoint frame is a responsive TIER, not content: its
    // children are the replica tree for breakpoint `node.name`.
    const isBreakpointTier = node.isBreakpoint === true && node.isPrimaryBreakpoint !== true;
    const childBreakpointName = isBreakpointTier ? (node.name ?? breakpointName) : breakpointName;
    const isReplica = node.isReplica === true;
    const originalId = node.originalId ?? null;

    const base: FramerNode = {
        id: node.id,
        type,
        name: type === 'Slot' ? normalizeSlotName(node.name) : (node.name ?? 'Untitled'),
        frame: await parseFrame(node, context),
        layout: parseLayout(node),
        style: parseStyle(node),
        source: {
            platform: 'framer',
            nodeId: node.id,
            nodeType: node.nodeType,
            // A non-primary breakpoint frame is a responsive TIER: its
            // children are the replica tree for that breakpoint, so the fold
            // pass prunes the frame itself and keeps only the folded
            // overrides.
            ...(isBreakpointTier ? { isBreakpoint: true } : {}),
            // Replica identity: the source signal that separates a
            // breakpoint/variant override (same entity, different tier) from
            // a genuinely duplicated node (different source entity).
            ...(isReplica ? { isReplica: true } : {}),
            ...(isReplica && originalId ? { originalId } : {}),
            ...(isReplica && childBreakpointName ? { breakpointName: childBreakpointName } : {}),
        },
    };

    if (type === 'Slot') {
        // A slot placeholder is not an empty shell: its controls are the
        // slot's per-slot props, and its children are the DEFAULT content
        // shown when a consumer passes nothing. Both carry into the model so
        // the master-authored placeholder renders faithfully.
        const slotProps = extractProps(node.controls);
        if (slotProps) base.props = slotProps;
        const defaultChildren = await safeChildren(node, context);
        if (defaultChildren.length > 0) {
            base.children = await Promise.all(defaultChildren.map((child) => safeParseNode(child, context)));
        }
        return base;
    }

    const interactions = parseInteractions(node);
    if (interactions) base.interactions = interactions;

    // Responsive overrides pass through when the SDK exposes them (structural).
    if (node.responsive && typeof node.responsive === 'object' && Object.keys(node.responsive).length > 0) {
        base.responsive = node.responsive as FramerNode['responsive'];
    }

    if (isSdkTextNode(node)) {
        base.text = parseText(node);
        try {
            const text = await withTimeout(node.getText?.() ?? Promise.resolve(null), callTimeout, 'getText');
            if (text !== null && text !== undefined) base.text.text = text;
        } catch (error) {
            // The engine rejected the text read (e.g. "node is not a text
            // node"). Reclassify as a plain container so the node and its
            // children still load instead of becoming a phantom text node or
            // failing the whole extraction. Logged so the offending node is
            // diagnosable.
            console.warn(
                '[framerx] text read rejected for node',
                node.id,
                node.name,
                error instanceof Error ? error.message : error,
            );
            type = 'Frame';
            base.type = type;
            base.name = node.name ?? 'Untitled';
            delete base.text;
        }
    } else if (isSdkVectorNode(node)) {
        let svg = node.svg;
        if (!svg && typeof node.getSVG === 'function') {
            try {
                svg = (await withTimeout(node.getSVG(), callTimeout, 'getSVG')) ?? undefined;
            } catch {
                // soft fallback
            }
        }
        if (!svg && typeof node.getSvg === 'function') {
            try {
                svg = (await withTimeout(node.getSvg(), callTimeout, 'getSvg')) ?? undefined;
            } catch {
                // soft fallback
            }
        }
        base.vector = {
            svg,
            data: node.svgData,
            name: node.name ?? undefined,
            mimeType: node.svgData ? 'image/svg+xml' : undefined,
        };
    } else if (isSdkComponentNode(node)) {
        const component: FramerNode['component'] = {
            id: node.componentIdentifier ?? node.id,
            name: node.componentName ?? node.name ?? 'Component',
            props: extractProps(node.controls),
        };

        // Attach the real master (definition body) when the SDK exposes it:
        // slot positions and per-slot props then come from the master, never
        // from a synthesized approximation. Masters are indexed by
        // componentIdentifier, insertURL, AND componentName — instances may
        // carry any one of these keys (shared components can expose engine-
        // internal identifiers that differ from the instance's). The master
        // root never resolves itself (that would recurse forever), and masters
        // currently being parsed are skipped (mutual recursion guard).
        const selfOrInProgress = node.id === context.masterRoot || (context.parsingMasters?.has(component.id) ?? false);
        const master = selfOrInProgress
            ? undefined
            : (context.masters?.get(component.id) ??
              (node.insertURL ? context.masters?.get(node.insertURL) : undefined) ??
              (node.componentName ? context.mastersByName?.get(node.componentName) : undefined));
        if (master) {
            let parsed = context.parsedMasters?.get(component.id);
            if (!parsed) {
                parsed = await parseMasterNode(master, context);
                context.parsedMasters?.set(component.id, parsed);
            }
            component.master = parsed;
        } else {
            // No canvas master → this is a CODE component: its definition is
            // the real source fetched through the SDK. Attach it (with the
            // transitive closure of its relative-import dependencies) so the
            // generator emits the true implementation instead of a
            // synthesized approximation.
            const codeFiles = context.codeFiles;
            let codeMatch: ReturnType<typeof matchCodeFile>;
            if (codeFiles) {
                codeMatch = matchCodeFile(
                    { id: component.id, name: component.name, insertURL: node.insertURL },
                    codeFiles,
                );
                if (codeMatch) {
                    component.code = {
                        source: codeMatch.file.content,
                        fileName: codeMatch.file.name,
                        path: codeMatch.file.path.replace(/^\/+/, ''),
                        exportName: codeMatch.export.name,
                        isDefaultExport: codeMatch.export.isDefaultExport,
                        dependencies: resolveCodeClosure(codeMatch.file, codeFiles),
                    };
                }
            }
            // Still unresolved → a SHARED MODULE-backed code component. The
            // project's own getCodeFiles() legitimately has nothing for it:
            // its source is a published ES-module bundle on Framer's CDN, and
            // the instance's insertURL IS that bundle. Fetch the bundle + its
            // remote-import closure so the true implementation ships instead
            // of a synthesized approximation.
            if (!codeMatch && context.moduleFetcher && isModuleBacked(node)) {
                const moduleUrl = moduleUrlOf(node);
                if (moduleUrl) {
                    let closure = context.moduleCache?.get(moduleUrl);
                    if (closure === undefined) {
                        closure = await resolveModuleClosure(moduleUrl, context.moduleFetcher, {
                            usedPaths: context.modulePaths,
                        });
                        context.moduleCache?.set(moduleUrl, closure);
                    }
                    if (closure) {
                        const { exportName, isDefaultExport } = moduleExportName(node.componentIdentifier);
                        component.code = {
                            source: closure.entrySource,
                            fileName: closure.entryPath.split('/').pop() ?? 'module.js',
                            path: closure.entryPath,
                            exportName,
                            isDefaultExport,
                            dependencies: closure.dependencies,
                            isModule: true,
                        };
                    } else {
                        // Fetch failed — record the exact bundle that could
                        // not be read so the export names it.
                        context.moduleFailures?.push({ url: moduleUrl, name: node.name ?? component.name });
                    }
                }
            }
            // Neither enrichment resolved this instance. Record the EXACT keys
            // it carried so the export can diagnose why (id mismatch vs. API
            // down) instead of silently synthesizing. The master root itself
            // is the definition, not an unmatched consumer — never recorded.
            if (!codeMatch && !component.code && !selfOrInProgress) {
                context.unmatchedInstances?.push({
                    id: node.id,
                    name: node.name ?? component.name,
                    componentIdentifier: node.componentIdentifier ?? null,
                    insertURL: node.insertURL ?? null,
                    componentName: node.componentName ?? null,
                });
            }
        }
        base.component = component;
    }

    const children = await safeChildren(node, context);
    if (children.length > 0) {
        base.children = await Promise.all(children.map((child) => safeParseNode(child, context, childBreakpointName)));
    }

    const imageUrl = getSdkImageUrl(node);
    if (imageUrl && (base.children?.length ?? 0) === 0) {
        const imageMeta =
            typeof node.image === 'object'
                ? node.image
                : typeof node.backgroundImage === 'object'
                  ? node.backgroundImage
                  : undefined;
        base.image = {
            src: imageUrl,
            alt: imageMeta?.altText,
            name: node.name ?? undefined,
            width: undefined,
            height: undefined,
            mimeType: imageMeta?.mimeType,
            data: imageMeta?.data,
        };
    } else if (imageUrl && (base.children?.length ?? 0) > 0) {
        // Reclassify: container with bg-image stays as Frame.
        base.type = 'Frame';
    }

    return base;
}

/**
 * Read a node's children defensively — a subtree the SDK cannot walk must not
 * abort the whole document extraction (the node keeps its own attributes).
 */
async function safeChildren(node: SdkNode, context: ParseContext): Promise<SdkNode[]> {
    const callTimeout = context.sdkCallTimeoutMs ?? SDK_CALL_TIMEOUT_MS;
    try {
        return await withTimeout(node.getChildren(), callTimeout, `getChildren(${node.id})`);
    } catch {
        return [];
    }
}

/**
 * Parse a node, degrading to an empty frame on failure.
 *
 * The last line of defense for the whole walk: whatever an individual node
 * throws (engine rejects, transient state, unexpected node kind), the document
 * extraction must continue with the remaining nodes. The failure is logged so
 * the offending node is diagnosable.
 */
export async function safeParseNode(
    node: SdkNode,
    context: ParseContext,
    breakpointName?: string,
): Promise<FramerNode> {
    try {
        return await parseSdkNode(node, context, breakpointName);
    } catch (error) {
        console.warn(
            '[framerx] failed to parse node',
            node.id,
            node.name,
            error instanceof Error ? error.message : error,
        );
        return {
            id: node.id,
            type: 'Frame',
            name: node.name ?? 'Untitled',
            frame: { x: 0, y: 0, width: 0, height: 0 },
            layout: { strategy: 'auto' },
            style: {},
            source: { platform: 'framer', nodeId: node.id, nodeType: node.nodeType },
        };
    }
}

/**
 * Parse a component master as the definition body.
 *
 * The master is a definition container, not an instance of itself: it parses
 * as a plain Frame whose children are the real body (slot placeholders at
 * their true positions). Nested instances inside the master resolve their own
 * masters through the same context.
 */
async function parseMasterNode(master: SdkNode, context: ParseContext): Promise<FramerNode> {
    const id = master.componentIdentifier ?? master.id;
    context.parsingMasters?.add(id);
    try {
        const parsed = await parseSdkNode(master, { ...context, inMaster: true, masterRoot: master.id });
        parsed.type = 'Frame';
        delete parsed.component;
        return parsed;
    } finally {
        context.parsingMasters?.delete(id);
    }
}
