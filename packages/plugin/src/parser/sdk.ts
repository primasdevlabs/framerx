/**
 * Framer SDK bridge.
 *
 * The `@framer/plugin` SDK performs a postMessage handshake with the Framer
 * engine at module load (top-level await). Outside the Framer runtime — e.g.
 * during local development or in a plain browser preview — that handshake
 * never resolves, and the exported `framer` object is a Proxy that throws on
 * any property access.
 *
 * This bridge loads the SDK dynamically with a timeout so the rest of the app
 * can run standalone (demo mode with a mock document). In the Framer runtime
 * the handshake resolves instantly and the real API is used.
 */

/** The shape of the `@framer/plugin` module that the plugin consumes. */
export interface FramerSdkModule {
    framer: FramerApi;
}

/** A structural subset of the Framer plugin API used by the exporter UI. */
export interface FramerApi {
    showUI(options?: {
        title?: string;
        width?: number;
        height?: number;
        position?: 'center' | 'top left' | 'bottom left' | 'top right' | 'bottom right';
        resizable?: true | false | 'width' | 'height';
        minWidth?: number;
        minHeight?: number;
    }): Promise<void>;
    getCanvasRoot(): Promise<FramerCanvasRoot>;
    /**
     * Get every node of a given class in the project (e.g. `ComponentNode`
     * masters, `ComponentInstanceNode` instances). Optional: the adapter falls
     * back gracefully when the SDK surface does not expose it.
     */
    getNodesWithType?(type: 'ComponentNode' | 'ComponentInstanceNode'): Promise<FramerNodeLike[]>;
    /**
     * Every code file in the project (code components, overrides). Code
     * components have no canvas master — their definition is this source.
     * Optional: the adapter falls back gracefully when the SDK surface does
     * not expose it.
     */
    getCodeFiles?(): Promise<FramerCodeFile[]>;
    /**
     * Every font in the project (one entry per weight/style, each with its
     * own downloadable file URL usable in an `@font-face` rule). Custom fonts
     * are NOT exposed to plugins, and a font's url can be null when it has no
     * downloadable source file. Optional: the adapter falls back to
     * node-inferred font metadata when the SDK surface does not expose it.
     */
    getFonts?(): Promise<FramerSdkFont[]>;
    subscribeToCanvasRoot(callback: (root: FramerCanvasRoot) => void): () => void;
    closePlugin(): void;
}

/**
 * How a source-model enrichment (component masters / code files / shared
 * modules) resolved.
 *
 * Extraction must never silently degrade: when masters or code files are
 * unavailable, the export records WHY (`unavailable` = API surface missing,
 * `denied` = permission error, `error` = threw, `empty` = resolved with no
 * results, `partial` = some resolved and some failed) so the user-facing
 * diagnostics can explain that components will be synthesized and what to
 * check.
 */
export type ExtractionStatus =
    | { status: 'ok'; count: number }
    | { status: 'unavailable'; reason: string }
    | { status: 'denied'; reason: string }
    | { status: 'error'; reason: string }
    | { status: 'empty'; reason: string }
    | { status: 'partial'; count: number; failed: number; reason: string };

/**
 * A font listed by `framer.getFonts()`.
 *
 * `weight`/`style` are null for custom fonts (the engine does not calculate
 * them), and `url` is null when the font has no downloadable source file.
 */
export interface FramerSdkFont {
    /** An identifier used internally by the engine for differentiating fonts. */
    selector: string;
    /** The font family name. */
    family: string;
    /** The font weight, or null for custom fonts. */
    weight: number | null;
    /** The font style ('normal' | 'italic'), or null for custom fonts. */
    style: 'normal' | 'italic' | null;
    /**
     * URL of the font's primary file (usable in `@font-face`), or null when
     * the font has no downloadable source file.
     */
    url: string | null;
}

/** A code file in the Framer project (a code component or override). */
export interface FramerCodeFile {
    /** The unique identifier of the code file. */
    id: string;
    /** The file name (e.g. `Phosphor.tsx`). */
    name: string;
    /** The file system path within the project (e.g. `code/Phosphor.tsx`). */
    path: string;
    /** The full source code content of the file. */
    content: string;
    /** The exports available in the file (components and overrides). */
    exports: FramerCodeFileExport[];
    /** The current version id of the file. */
    versionId?: string;
}

/** A component export from a code file. */
export interface FramerCodeFileExport {
    /** The export name. */
    name: string;
    /** The component id — matches a canvas instance's `componentIdentifier`. */
    componentId: string;
    /** The insertion URL — matches a canvas instance's `insertURL`. */
    insertURL: string;
    /** Whether this is the default export of the file. */
    isDefaultExport: boolean;
    /** The export kind ('component' or 'override'). */
    type?: string;
}

/** The canvas root node (the document). */
export interface FramerCanvasRoot {
    id: string;
    name: string | null;
    /** The document's responsive breakpoints (when the SDK exposes them). */
    breakpoints?: Array<{ name: string; minWidth: number }>;
    getChildren(): Promise<FramerPage[]>;
}

/** A page node in the document. */
export interface FramerPage {
    id: string;
    name: string | null;
    getChildren(): Promise<FramerNodeLike[]>;
}

/** The SDK nodes understood by the adapter. */
export interface FramerNodeLike {
    id: string;
    name: string | null;
    nodeType?: string;
    getChildren(): Promise<FramerNodeLike[]>;
    getRect(): Promise<{ x: number; y: number; width: number; height: number } | null>;
}

/** The number of ms to wait for the Framer engine handshake per attempt. */
const SDK_TIMEOUT_MS = 8000;

/** Force standalone mode (skips the SDK entirely) via VITE_FRAMER_STANDALONE=1. */
function isStandaloneForced(): boolean {
    return import.meta.env.VITE_FRAMER_STANDALONE === '1';
}

/**
 * Whether the plugin is running inside the Framer host iframe.
 *
 * The Framer plugin runtime always embeds the plugin panel in an iframe, so a
 * top-level window is a plain browser preview (standalone/demo mode). This is
 * the reliable environment signal — the SDK handshake itself cannot be used to
 * probe for the engine, because importing the SDK module hangs forever on its
 * top-level await outside Framer.
 */
export function isInFramerIframe(): boolean {
    return typeof window !== 'undefined' && window.self !== window.top;
}

let sdkPromise: Promise<FramerSdkModule | null> | null = null;

/**
 * Load the Framer SDK module, resolving to null when no engine is present.
 *
 * Inside the Framer iframe the module resolves once the engine handshake
 * completes; a timeout (the engine attaching slowly on a cold start) resolves
 * null but is NOT cached — the next call re-attempts the (module-cached)
 * import, which resolves as soon as the handshake lands. Outside the iframe (a
 * browser preview) there is no engine, so this resolves immediately instead of
 * hanging on the never-resolving handshake.
 */
export function loadFramerSdk(): Promise<FramerSdkModule | null> {
    if (isStandaloneForced()) return Promise.resolve(null);
    if (sdkPromise) return sdkPromise;

    if (!isInFramerIframe()) {
        sdkPromise = Promise.resolve(null);
        return sdkPromise;
    }

    sdkPromise = Promise.race([
        // The bridge is deliberately duck-typed: the SDK module is structurally
        // unrelated to our subset interface (classes with private fields, union
        // exports), so the cast goes through `unknown` — compatibility is
        // asserted at runtime, not by the type system.
        import('@framer/plugin') as unknown as Promise<FramerSdkModule>,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), SDK_TIMEOUT_MS)),
    ]).catch(() => null);
    // A timeout is a retry, not a verdict: clear the cached null so the next
    // caller re-attempts the import once the engine is reachable.
    void sdkPromise.then((sdk) => {
        if (sdk === null) sdkPromise = null;
    });
    return sdkPromise;
}

/**
 * Get the Framer API, or null when running outside the Framer runtime.
 * In Node (tests) the handshake resolves to the throwing Proxy, so the
 * probe below fails fast and returns null.
 */
export async function getFramerApi(): Promise<FramerApi | null> {
    const sdk = await loadFramerSdk();
    if (!sdk) return null;
    try {
        // Touching a member of the Proxy throws when the engine is missing.
        void sdk.framer.getCanvasRoot;
        return sdk.framer;
    } catch {
        return null;
    }
}

/** Whether the plugin is running outside the Framer runtime. */
export async function isStandaloneEnvironment(): Promise<boolean> {
    return (await getFramerApi()) === null;
}

/**
 * Connect to the Framer engine with retry.
 *
 * On a cold start the engine's message listener can attach later than the
 * plugin iframe, so the first handshake attempt may time out. Each retry
 * re-imports the (module-cached) SDK, which resolves as soon as the handshake
 * lands. Returns null only when no engine is reachable (browser preview, or
 * the engine never responded after all attempts).
 */
export async function connectToFramer(): Promise<FramerApi | null> {
    if (isStandaloneForced()) return null;
    if (!isInFramerIframe()) return null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const api = await getFramerApi();
        if (api) return api;
        // The first attempt already waited the full SDK timeout; later
        // attempts check in faster in case the handshake landed meanwhile.
        if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 750));
        }
    }
    return null;
}
