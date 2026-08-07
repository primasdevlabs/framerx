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
    subscribeToCanvasRoot(callback: (root: FramerCanvasRoot) => void): () => void;
    closePlugin(): void;
}

/** The canvas root node (the document). */
export interface FramerCanvasRoot {
    id: string;
    name: string | null;
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

/** The number of ms to wait for the Framer engine handshake. */
const SDK_TIMEOUT_MS = 1200;

/** Force standalone mode (skips the SDK entirely) via VITE_FRAMER_STANDALONE=1. */
function isStandaloneForced(): boolean {
    return import.meta.env.VITE_FRAMER_STANDALONE === '1';
}

let sdkPromise: Promise<FramerSdkModule | null> | null = null;

/** Load the Framer SDK module, resolving to null when no engine is present. */
export function loadFramerSdk(): Promise<FramerSdkModule | null> {
    if (isStandaloneForced()) return Promise.resolve(null);

    if (!sdkPromise) {
        sdkPromise = Promise.race([
            import('@framer/plugin') as Promise<FramerSdkModule>,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), SDK_TIMEOUT_MS)),
        ]).catch(() => null);
    }
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
