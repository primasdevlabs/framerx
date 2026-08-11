/**
 * Shared-module code components.
 *
 * Framer sites can use code components that were NOT authored in the current
 * project: they ship as published ES-module bundles on Framer's CDN
 * (`https://framerusercontent.com/modules/...`). The project's own
 * `getCodeFiles()` legitimately returns zero files for them — the source is
 * the published bundle, and the instance's `insertURL` IS that bundle.
 *
 * This module resolves those bundles at export time:
 *   1. Fetch the bundle (CORS-open CDN, same bytes the published site runs).
 *   2. Rewrite its static remote imports (other module URLs) recursively into
 *      local relative paths, fetching each dependency once (dedup, cycle-safe,
 *      depth/total capped) so the generated project is self-contained.
 *   3. Parse the export the instance references (`:default` → default export,
 *      `:Icon` → named export) from the `componentIdentifier`.
 *
 * The resulting source is attached as a code component's real definition —
 * the true implementation, never a synthesized approximation.
 */

/** How a module bundle is fetched (injectable for tests). */
export type ModuleTextFetcher = (url: string) => Promise<string | null>;

/** Static (non-dynamic) remote module import specifiers in a source. */
const REMOTE_IMPORT_RE = /(from|import)\s*["'](https:\/\/[^"']+)["']\s*;?/g;

/** A module URL's local file name (the last URL path segment). */
function urlFileName(url: string): string {
    const withoutHash = url.split('#')[0] ?? '';
    return withoutHash.split('/').pop() ?? 'module.js';
}

/** The export name a component identifier references (`module:.../File.js:Icon`). */
export function moduleExportName(componentIdentifier: string | undefined | null): { exportName: string; isDefaultExport: boolean } {
    const id = componentIdentifier ?? '';
    // The identifier is `module:<url>[:<export>]` — the URL itself may contain
    // colons, so only look past the `module:` prefix.
    if (!id.startsWith('module:')) return { exportName: 'default', isDefaultExport: true };
    const rest = id.slice('module:'.length);
    const colon = rest.lastIndexOf(':');
    if (colon < 0) return { exportName: 'default', isDefaultExport: true };
    const suffix = rest.slice(colon + 1);
    if (!suffix || suffix === 'default') {
        return { exportName: 'default', isDefaultExport: true };
    }
    return { exportName: suffix, isDefaultExport: false };
}

/** Whether an instance is a shared module-backed code component. */
export function isModuleBacked(opts: { componentIdentifier?: string | null; insertURL?: string | null }): boolean {
    return (
        (opts.componentIdentifier ?? '').startsWith('module:') ||
        (opts.insertURL ?? '').startsWith('https://framerusercontent.com/modules/')
    );
}

/** The module bundle URL for an instance (the insertURL is canonical). */
export function moduleUrlOf(opts: { componentIdentifier?: string | null; insertURL?: string | null }): string | undefined {
    if (opts.insertURL) return opts.insertURL;
    return undefined;
}

/** The resolved module closure for one component instance. */
export interface ModuleClosure {
    /** The local project path of the entry module (e.g. `code/Ticker.js`). */
    entryPath: string;
    /** The entry module source, remote imports rewritten to local paths. */
    entrySource: string;
    /** The transitive dependency modules (local path → source). */
    dependencies: Array<{ path: string; source: string }>;
}

/** Options controlling the closure walk. */
export interface ModuleClosureOptions {
    /** How deep nested remote imports may go. */
    maxDepth?: number;
    /** How many modules may be fetched in total. */
    maxModules?: number;
    /**
     * Local paths already assigned by OTHER closures in the same extraction
     * (two bundles with the same file name must not collide in the emitted
     * project). The document extraction shares one set across every closure.
     */
    usedPaths?: Set<string>;
}

/**
 * Resolve a module bundle and its static remote-import closure.
 *
 * The entry and every dependency are fetched (deduplicated by URL, cycle-safe)
 * and emitted as `code/<file>.js` files; the entry's remote import specifiers
 * are rewritten to `./<file>` so the generated project is fully local. Failures
 * (fetch error, cap exceeded) return null — the caller falls back to the
 * synthesized body and records the failure.
 */
export async function resolveModuleClosure(
    url: string,
    fetcher: ModuleTextFetcher,
    options: ModuleClosureOptions = {},
): Promise<ModuleClosure | null> {
    const maxDepth = options.maxDepth ?? 8;
    const maxModules = options.maxModules ?? 200;

    const sources = new Map<string, string>(); // local path → source
    const pathByUrl = new Map<string, string>(); // module URL → local path
    // Local paths already assigned — shared across closures of one extraction
    // so two bundles with the same file name never collide.
    const usedPaths = options.usedPaths ?? new Set<string>();
    const seen = new Set<string>(); // URLs already visited (cycle safety)
    const fetchCache = new Map<string, Promise<string | null>>();

    const localPathFor = (moduleUrl: string): string => {
        const base = urlFileName(moduleUrl);
        let candidate = `code/${base}`;
        let index = 2;
        while (usedPaths.has(candidate)) {
            candidate = `code/${base.replace(/\.([a-z0-9]+)$/i, `-${index}.$1`)}`;
            index += 1;
        }
        usedPaths.add(candidate);
        return candidate;
    };

    const fetchOnce = (moduleUrl: string): Promise<string | null> => {
        const cached = fetchCache.get(moduleUrl);
        if (cached) return cached;
        const promise = fetcher(moduleUrl).catch(() => null);
        fetchCache.set(moduleUrl, promise);
        return promise;
    };

    const rewriteRemoteImports = (source: string, ownPath: string): string => {
        const dir = ownPath.slice(0, ownPath.lastIndexOf('/') + 1);
        return source.replace(REMOTE_IMPORT_RE, (match, verb: string, spec: string) => {
            const targetPath = pathByUrl.get(spec);
            // Unresolved (fetch failed / cap exceeded) → keep the original
            // remote import; the generated project reports it as a remote
            // reference rather than silently breaking the module.
            if (!targetPath) return match;
            const rel = targetPath.slice(dir.length).replace(/\.js$/, '');
            return `${verb} "./${rel}"`;
        });
    };

    // Depth-first walk, visiting each URL once.
    let fetched = 0;
    const visit = async (moduleUrl: string, depth: number): Promise<boolean> => {
        if (depth > maxDepth || fetched >= maxModules) return false;
        if (seen.has(moduleUrl)) return true; // already resolved (or in progress)
        seen.add(moduleUrl);

        const source = await fetchOnce(moduleUrl);
        if (source === null) return false;

        const localPath = localPathFor(moduleUrl);
        pathByUrl.set(moduleUrl, localPath);
        sources.set(localPath, source);
        fetched += 1;

        for (const match of source.matchAll(REMOTE_IMPORT_RE)) {
            const depUrl = match[2];
            const ok = await visit(depUrl, depth + 1);
            if (!ok) continue;
        }
        return true;
    };

    const ok = await visit(url, 0);
    if (!ok || !pathByUrl.has(url)) return null;

    // Rewrite imports once every dependency has a path assigned.
    const rewritten = new Map<string, string>();
    for (const [localPath, source] of sources) {
        rewritten.set(localPath, rewriteRemoteImports(source, localPath));
    }

    const entryPath = pathByUrl.get(url)!;
    return {
        entryPath,
        entrySource: rewritten.get(entryPath) ?? '',
        dependencies: [...rewritten.entries()]
            .filter(([path]) => path !== entryPath)
            .map(([path, source]) => ({ path, source })),
    };
}
