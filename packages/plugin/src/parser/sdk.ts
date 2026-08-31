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
    getNodesWithType?(
        type: 'ComponentNode' | 'ComponentInstanceNode' | 'WebPageNode' | 'DesignPageNode',
    ): Promise<FramerNodeLike[]>;
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
    | {
          status: 'partial';
          count: number;
          failed: number;
          reason: string;
          /** Replicas kept as independent nodes (no matching primary / tier). */
          unresolved?: number;
          /** Replica override kinds the responsive model cannot represent (e.g. SVG swaps). */
          unsupported?: number;
      };

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

/**
 * The canvas root returned by `framer.getCanvasRoot()`.
 *
 * In the current `@framer/plugin` API (v4+) this IS the active page node
 * (`WebPageNode` | `DesignPageNode` | …), and `getChildren()` returns the
 * top-level canvas content nodes directly — there is NO intermediate "pages"
 * layer. (An older SDK returned a root object whose children were an array of
 * pages; the walker detects and handles both so the adapter is robust across
 * SDK generations.)
 */
export interface FramerCanvasRoot {
    id: string;
    name: string | null;
    /** The node class of the root (`webPage`, `designPage`, `component`, …). */
    nodeType?: string;
    /** The document's responsive breakpoints (when the SDK exposes them). */
    breakpoints?: Array<{ name: string; minWidth: number }>;
    getChildren(): Promise<FramerNodeLike[]>;
}

/** A page node in the document (a `WebPageNode`/`DesignPageNode` child of the root). */
export interface FramerPage {
    id: string;
    name: string | null;
    /** The node class of the page (`webPage` | `designPage`). */
    nodeType?: string;
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

/**
 * The number of ms a single SDK method invocation may take before it is
 * treated as a hang.
 *
 * The SDK's `invoke` posts a `methodInvocation` and waits for the host's
 * `methodResponse` with NO timeout of its own — a host that never answers a
 * call leaves the promise pending forever. The plugin wraps every SDK call in
 * `withTimeout` so a silent host degrades exactly like a throwing one (the
 * extraction's catch paths already handle that) instead of leaving the panel
 * stuck on "No document available." while it waits forever.
 */
export const SDK_CALL_TIMEOUT_MS = 10_000;

/**
 * Race a promise against a deadline; rejects with a descriptive error when
 * the deadline expires so a hanging SDK call degrades like a throw.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timed out after ${ms}ms waiting for ${label}`));
        }, ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

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

/** The engine's response to the plugin-ready signal. */
interface EngineHandshakeResponse {
    type: string;
    mode?: string;
    permissionMap?: unknown;
    environmentInfo?: unknown;
    theme?: unknown;
    initialState?: unknown;
}

/**
 * Why the connection to the Framer engine failed, for the retry panel.
 *
 * The most useful discriminator is `receivedAnyResponse`: when it is false the
 * engine never answered ANY plugin-ready signal (a registration / reachability
 * problem — the plugin page loads but the engine is not listening for it); when
 * true the engine answered but the SDK still did not come up (a protocol or
 * SDK-surface mismatch).
 */
export interface FramerConnectDiagnostics {
    /** How many handshake attempts ran before giving up. */
    attempts: number;
    /** Total time spent trying (ms). */
    elapsedMs: number;
    /** Whether the engine answered any plugin-ready signal during this connect. */
    receivedAnyResponse: boolean;
}

let lastConnectDiagnostics: FramerConnectDiagnostics | null = null;
let engineRespondedThisConnect = false;

/** The most recent failed connection's diagnostics, for the retry panel. */
export function lastFramerConnectDiagnostics(): FramerConnectDiagnostics | null {
    return lastConnectDiagnostics;
}

/**
 * Post the plugin-ready signal and wait for the engine's response.
 *
 * The `@framer/plugin` SDK fires its own handshake exactly once, as a
 * top-level await when the module first evaluates (`pluginReadySignal` →
 * `pluginReadyResponse`). If the engine's listener is not attached at that
 * moment (a slow cold start), the module import stays pending FOREVER —
 * re-importing the ESM-cached module never re-posts the signal, so a lost
 * handshake could never be retried without reloading the iframe. Probing the
 * engine ourselves BEFORE importing keeps the import from ever starting while
 * the engine is unreachable, so a later retry can genuinely re-attempt the
 * handshake as soon as the engine is listening. The engine answers every
 * signal (it must — a plugin iframe reload re-posts the signal), so the extra
 * probe is harmless when the engine is healthy.
 */
function probeEngineHandshake(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (result: boolean): void => {
            if (settled) return;
            settled = true;
            window.removeEventListener('message', onMessage);
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        function onMessage(event: MessageEvent): void {
            const data = event.data as EngineHandshakeResponse | undefined;
            if (!data || typeof data !== 'object' || data.type !== 'pluginReadyResponse') return;
            engineRespondedThisConnect = true;
            finish(true);
        }
        window.addEventListener('message', onMessage);
        window.parent.postMessage({ type: 'pluginReadySignal' }, '*');
    });
}

/**
 * Load the Framer SDK module, resolving to null when no engine is present.
 *
 * Inside the Framer iframe the engine is probed FIRST and the SDK is only
 * imported once the engine answered — the module's own handshake is a one-shot
 * top-level await, so an import started while the engine was not listening
 * would hang forever and could never be retried. A probe timeout resolves null
 * but is NOT cached — the next call re-probes, so a retry re-attempts the
 * handshake as soon as the engine is reachable. Outside the iframe (a browser
 * preview) there is no engine, so this resolves immediately instead of hanging
 * on the never-resolving handshake.
 */
export function loadFramerSdk(): Promise<FramerSdkModule | null> {
    if (isStandaloneForced()) return Promise.resolve(null);
    if (sdkPromise) return sdkPromise;

    if (!isInFramerIframe()) {
        sdkPromise = Promise.resolve(null);
        return sdkPromise;
    }

    sdkPromise = probeEngineHandshake(SDK_TIMEOUT_MS).then((enginePresent) => {
        if (!enginePresent) return null;
        // The engine just answered, so its response to the SDK's own signal is
        // already guaranteed; the race only guards a pathological mismatch.
        // The bridge is deliberately duck-typed: the SDK module is structurally
        // unrelated to our subset interface (classes with private fields, union
        // exports), so the cast goes through `unknown` — compatibility is
        // asserted at runtime, not by the type system.
        return Promise.race([
            import('@framer/plugin') as unknown as Promise<FramerSdkModule>,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), SDK_TIMEOUT_MS)),
        ]).catch(() => null);
    });
    // A probe timeout is a retry, not a verdict: clear the cached null so the
    // next caller re-attempts the handshake once the engine is reachable.
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
 * re-probes the engine (posting a fresh plugin-ready signal) before importing
 * the SDK — the import is only attempted once the engine is listening, so a
 * lost handshake never leaves the module stuck and is retryable. Returns null
 * only when no engine is reachable (browser preview, or the engine never
 * responded after all attempts).
 *
 * Concurrent callers SHARE one connect attempt: every call site (showUI in
 * `main.tsx`, the document loader, a manual rescan) posts the plugin-ready
 * signal, and the Framer host's PluginHealth machinery logs an assertion for
 * each redundant signal it receives while it considers the plugin in the
 * wrong lifecycle state — so duplicate connect loops are message noise, not
 * just wasted work.
 */
let connectPromise: Promise<FramerApi | null> | null = null;

export function connectToFramer(): Promise<FramerApi | null> {
    if (connectPromise) return connectPromise;
    connectPromise = connectToFramerOnce().finally(() => {
        connectPromise = null;
    });
    return connectPromise;
}

async function connectToFramerOnce(): Promise<FramerApi | null> {
    if (isStandaloneForced()) return null;
    if (!isInFramerIframe()) return null;

    engineRespondedThisConnect = false;
    const startedAt = Date.now();
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const api = await getFramerApi();
        if (api) return api;
        // The first attempt already waited the full SDK timeout; later
        // attempts check in faster in case the handshake landed meanwhile.
        if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 750));
        }
    }
    lastConnectDiagnostics = {
        attempts: 3,
        elapsedMs: Date.now() - startedAt,
        receivedAnyResponse: engineRespondedThisConnect,
    };
    console.warn(
        '[framerx] Could not connect to the Framer engine after 3 attempts.',
        lastConnectDiagnostics,
        'The plugin page loaded but the engine did not answer the plugin-ready handshake.',
    );
    return null;
}
