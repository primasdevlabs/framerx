/**
 * Shared-module bundle resolution.
 *
 * Published code components (shared Framer modules) ship as ES-module bundles
 * on Framer's CDN; the instance's insertURL IS the bundle. These tests pin the
 * resolver: export-name parsing, bundle fetching, recursive remote-import
 * rewriting, dedup, cycle safety, and the failure/cap paths.
 */

import { describe, expect, it } from 'vitest';

import { isModuleBacked, moduleExportName, resolveModuleClosure, type ModuleTextFetcher } from '../src/parser/modules';

/** A fetcher backed by an in-memory URL → source map. */
function memoryFetcher(sources: Record<string, string>): ModuleTextFetcher {
    return async (url) => sources[url] ?? null;
}

describe('moduleExportName', () => {
    it('parses the :default suffix as the default export', () => {
        expect(moduleExportName('module:abc/Ticker.js:default')).toEqual({ exportName: 'default', isDefaultExport: true });
    });

    it('parses a named export suffix', () => {
        expect(moduleExportName('module:abc/Icon.js:Icon')).toEqual({ exportName: 'Icon', isDefaultExport: false });
    });

    it('defaults when there is no suffix', () => {
        expect(moduleExportName('module:abc/Ticker.js')).toEqual({ exportName: 'default', isDefaultExport: true });
        expect(moduleExportName(undefined)).toEqual({ exportName: 'default', isDefaultExport: true });
        expect(moduleExportName(null)).toEqual({ exportName: 'default', isDefaultExport: true });
    });
});

describe('isModuleBacked', () => {
    it('recognizes module: identifiers and framerusercontent module URLs', () => {
        expect(isModuleBacked({ componentIdentifier: 'module:abc/Ticker.js:default' })).toBe(true);
        expect(isModuleBacked({ insertURL: 'https://framerusercontent.com/modules/abc/Ticker.js' })).toBe(true);
    });

    it('rejects local components', () => {
        expect(isModuleBacked({ componentIdentifier: 'local-module:canvasComponent/abc:default' })).toBe(false);
        expect(isModuleBacked({ insertURL: 'https://framer.com/m/Ticker-OTgoD.js@xyz' })).toBe(false);
        expect(isModuleBacked({})).toBe(false);
    });
});

describe('resolveModuleClosure', () => {
    const ENTRY = 'https://framerusercontent.com/modules/abc/Ticker.js';

    it('fetches the entry and rewrites remote imports to local relative paths', async () => {
        const fetcher = memoryFetcher({
            [ENTRY]: `import { Helper } from "https://framerusercontent.com/modules/abc/Helper.js";\nexport default function Ticker() { return Helper(); }\n`,
            'https://framerusercontent.com/modules/abc/Helper.js': `export function Helper() { return 1; }\n`,
        });

        const closure = await resolveModuleClosure(ENTRY, fetcher);
        expect(closure).not.toBeNull();
        expect(closure!.entryPath).toBe('code/Ticker.js');
        expect(closure!.entrySource).toContain('from "./Helper"');
        expect(closure!.entrySource).not.toContain('https://framerusercontent.com');
        expect(closure!.dependencies).toHaveLength(1);
        expect(closure!.dependencies[0]).toMatchObject({ path: 'code/Helper.js' });
        expect(closure!.dependencies[0].source).toContain('export function Helper');
    });

    it('preserves the import verb for side-effect remote imports', async () => {
        const fetcher = memoryFetcher({
            [ENTRY]: `import "https://framerusercontent.com/modules/abc/polyfill.js";\nexport default function Ticker() { return null; }\n`,
            'https://framerusercontent.com/modules/abc/polyfill.js': `window.__polyfilled = true;\n`,
        });

        const closure = await resolveModuleClosure(ENTRY, fetcher);
        expect(closure!.entrySource).toContain('import "./polyfill"');
        expect(closure!.entrySource).not.toContain('from "./polyfill"');
    });

    it('fetches each dependency once (dedup across shared imports)', async () => {
        let calls = 0;
        const fetcher: ModuleTextFetcher = async (url) => {
            calls += 1;
            const helper = `export function Helper() { return 1; }\n`;
            const shared = `export function Shared() { return 2; }\n`;
            const entry = `import { Helper } from "https://framerusercontent.com/modules/a/Helper.js";\nimport { Shared } from "https://framerusercontent.com/modules/a/Shared.js";\nexport default function T() { return [Helper(), Shared()]; }\n`;
            const via = `import { Shared } from "https://framerusercontent.com/modules/a/Shared.js";\nexport function Via() { return Shared(); }\n`;
            if (url === ENTRY) return entry;
            if (url.endsWith('Helper.js')) return helper;
            if (url.endsWith('Shared.js')) return shared;
            if (url.endsWith('Via.js')) return via;
            return null;
        };

        const closure = await resolveModuleClosure(ENTRY, fetcher);
        // Entry + Helper + Shared (+ Via visited via the entry's second import
        // path in a follow-up test) — here exactly three unique URLs.
        expect(calls).toBe(3);
        expect(closure!.dependencies.map((dep) => dep.path)).toEqual(['code/Helper.js', 'code/Shared.js']);
    });

    it('is cycle-safe (a module importing back to the entry resolves once)', async () => {
        const fetcher = memoryFetcher({
            [ENTRY]: `import { Helper } from "https://framerusercontent.com/modules/abc/Helper.js";\nexport default function Ticker() { return Helper(); }\n`,
            'https://framerusercontent.com/modules/abc/Helper.js': `import { Ticker } from "${ENTRY}";\nexport function Helper() { return Ticker; }\n`,
        });

        const closure = await resolveModuleClosure(ENTRY, fetcher);
        expect(closure).not.toBeNull();
        expect(closure!.dependencies).toHaveLength(1);
        // The cycle does not loop forever and the entry is not duplicated.
        expect(closure!.entrySource).toContain('from "./Helper"');
    });

    it('collides duplicate file names deterministically across closures (Ticker.js, Ticker-2.js)', async () => {
        const a = 'https://framerusercontent.com/modules/aaa/Ticker.js';
        const b = 'https://framerusercontent.com/modules/bbb/Ticker.js';
        const fetcher = memoryFetcher({
            [a]: `export default function A() { return 1; }\n`,
            [b]: `export default function B() { return 2; }\n`,
        });

        // One extraction shares a path registry: two bundles with the same
        // file name must not collide in the emitted project.
        const usedPaths = new Set<string>();
        const first = await resolveModuleClosure(a, fetcher, { usedPaths });
        const second = await resolveModuleClosure(b, fetcher, { usedPaths });
        expect(first!.entryPath).toBe('code/Ticker.js');
        expect(second!.entryPath).toBe('code/Ticker-2.js');
    });

    it('returns null when the entry fetch fails — the caller falls back and records the failure', async () => {
        const closure = await resolveModuleClosure(ENTRY, memoryFetcher({}));
        expect(closure).toBeNull();
    });

    it('bounds the total modules fetched by the cap (deeper deps stay remote)', async () => {
        let calls = 0;
        const fetcher: ModuleTextFetcher = async () => {
            calls += 1;
            return `import { D } from "https://framerusercontent.com/modules/dep/dep${calls + 1}.js";\nexport default function M() { return null; }\n`;
        };
        const closure = await resolveModuleClosure(ENTRY, fetcher, { maxModules: 3 });
        expect(closure).not.toBeNull();
        // Entry + 2 deps fetched; the 4th URL is never visited.
        expect(calls).toBe(3);
        expect(closure!.dependencies).toHaveLength(2);
    });

    it('keeps an unresolved remote import as-is instead of silently breaking it', async () => {
        const fetcher = memoryFetcher({
            [ENTRY]: `import { Missing } from "https://framerusercontent.com/modules/abc/Missing.js";\nexport default function Ticker() { return Missing; }\n`,
            // Missing.js is not in the map — its fetch fails.
        });

        const closure = await resolveModuleClosure(ENTRY, fetcher);
        expect(closure).not.toBeNull();
        // The entry still resolves; the broken import stays remote (reported by
        // the validator as a remote reference, never silently mangled).
        expect(closure!.entrySource).toContain('https://framerusercontent.com/modules/abc/Missing.js');
    });
});
