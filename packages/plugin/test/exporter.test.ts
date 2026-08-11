/**
 * Tests for the exporter pipeline (compile → ZIP).
 */

import { mockFramerDocument, type FramerDocument, type FramerNode } from '@framer/compiler-parser';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { compileProject } from '../src/exporter/exporter';
import { validateDocument } from '../src/exporter/schemas';

describe('compileProject', () => {
    it('compiles the mock document into a valid ZIP', async () => {
        const result = await compileProject(mockFramerDocument, { projectName: 'demo', format: true, animations: true });

        expect(result.name).toBe('Demo');
        expect(result.files.length).toBeGreaterThan(10);
        expect(result.zip).toBeDefined();

        const zip = await JSZip.loadAsync(result.zip!);
        const names = Object.keys(zip.files);
        expect(names).toContain('src/App.tsx');
        expect(names).toContain('src/sections/HeroSection.tsx');
        expect(names).toContain('src/components/FeatureCard.tsx');
    });

    it('never overwrites ImageAsset.getData() bytes with a URL fetch', async () => {
        const originalFetch = globalThis.fetch;
        const fetchedUrls: string[] = [];
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            fetchedUrls.push(String(input));
            return new Response(new Uint8Array([9, 9, 9]), { status: 200 });
        }) as typeof fetch;
        try {
            const node: FramerNode = {
                id: 'img',
                type: 'Image',
                name: 'Hero',
                frame: { x: 0, y: 0, width: 100, height: 100 },
                layout: { strategy: 'auto' },
                style: {},
                // Original bytes attached by ImageAsset.getData() — the
                // exporter must keep them, not replace them with a fetch.
                image: { src: 'https://cdn.test/hero.png', data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
            };
            const document: FramerDocument = {
                id: 'doc_img',
                name: 'Img Doc',
                version: '1.0.0',
                nodes: [node],
                metadata: { platform: 'framer' },
            };

            const result = await compileProject(document, { projectName: 'img-original' });
            expect(result.zip).toBeDefined();
            // The original bytes survived; the URL was never fetched.
            expect(node.image?.data).toEqual(new Uint8Array([1, 2, 3]));
            expect(fetchedUrls.some((u) => u.includes('cdn.test/hero.png'))).toBe(false);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('fetches remote assets when no bytes are attached (URL fallback)', async () => {
        const originalFetch = globalThis.fetch;
        const fetchedUrls: string[] = [];
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            fetchedUrls.push(String(input));
            return new Response(new Uint8Array([4, 5, 6]), { status: 200 });
        }) as typeof fetch;
        try {
            const node: FramerNode = {
                id: 'img',
                type: 'Image',
                name: 'Hero',
                frame: { x: 0, y: 0, width: 100, height: 100 },
                layout: { strategy: 'auto' },
                style: {},
                // No getData bytes — the URL fetch fallback must kick in.
                image: { src: 'https://cdn.test/hero.png' },
            };
            const document: FramerDocument = {
                id: 'doc_img2',
                name: 'Img Doc 2',
                version: '1.0.0',
                nodes: [node],
                metadata: { platform: 'framer' },
            };

            const result = await compileProject(document, { projectName: 'img-fetch' });
            expect(result.zip).toBeDefined();
            expect(fetchedUrls.some((u) => u.includes('cdn.test/hero.png'))).toBe(true);
            expect(node.image?.data).toEqual(new Uint8Array([4, 5, 6]));
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('honors the format option', async () => {
        const formatted = await compileProject(mockFramerDocument, { format: true });
        const raw = await compileProject(mockFramerDocument, { format: false });

        // App.tsx is emitted from a hand-clean template; sections contain nested
        // JSX that requires re-indentation, so they genuinely differ.
        const heroFormatted = formatted.files.find((f) => f.path === 'src/sections/HeroSection.tsx');
        const heroRaw = raw.files.find((f) => f.path === 'src/sections/HeroSection.tsx');

        expect(heroFormatted!.content).not.toBe(heroRaw!.content);
        // The formatted section is prettier-clean: the animated buttons are
        // extracted, so motion lives in the button component, not the section.
        expect(heroFormatted!.content).toContain("import { PrimaryButton } from '../components/PrimaryButton';");
        expect(heroFormatted!.content).not.toContain("import { motion } from 'motion/react';");
        const button = formatted.files.find((f) => f.path === 'src/components/PrimaryButton.tsx');
        expect(button!.content).toContain("import { motion } from 'motion/react';");
    });
});

describe('extraction gate (never fully synthesized)', () => {
    /** A section root holding one component instance. */
    function instanceDocument(extraction: unknown, nodeType: 'Component' | 'Frame' = 'Component'): FramerDocument {
        const node: FramerNode =
            nodeType === 'Component'
                ? {
                      id: 'inst',
                      type: 'Component',
                      name: 'Tab',
                      frame: { x: 0, y: 0, width: 320, height: 200 },
                      layout: { strategy: 'auto' },
                      style: {},
                      component: { id: 'comp_tab', name: 'Tab', props: { label: 'Tab' } },
                      children: [],
                  }
                : {
                      id: 'plain',
                      type: 'Frame',
                      name: 'Section',
                      frame: { x: 0, y: 0, width: 1440, height: 900 },
                      layout: { strategy: 'flex' },
                      style: {},
                      children: [],
                  };
        return {
            id: 'doc_gate',
            name: 'Gate Doc',
            version: '1.0.0',
            nodes: [node],
            metadata: { platform: 'framer', extraction },
        };
    }

    const bothDown = {
        masters: { status: 'unavailable', reason: 'The SDK does not expose getNodesWithType.' },
        codeFiles: { status: 'denied', reason: 'getCodeFiles threw a permission error.' },
    };

    it('blocks the export when every component definition would be synthesized', async () => {
        await expect(compileProject(instanceDocument(bothDown))).rejects.toThrow(/Export blocked/);
        await expect(compileProject(instanceDocument(bothDown))).rejects.toThrow(/synthesized from instance props/);
        await expect(compileProject(instanceDocument(bothDown))).rejects.toThrow(/component masters: unavailable/);
        await expect(compileProject(instanceDocument(bothDown))).rejects.toThrow(/code files: denied/);
        // The error tells the user how to recover.
        await expect(compileProject(instanceDocument(bothDown))).rejects.toThrow(/reopen the plugin/);
    });

    it('allows the export when both enrichments were healthy', async () => {
        const result = await compileProject(
            instanceDocument({ masters: { status: 'ok', count: 2 }, codeFiles: { status: 'ok', count: 1 } }),
            { projectName: 'gate-healthy' },
        );
        expect(result.zip).toBeDefined();
    });

    it('allows the export when only one enrichment degraded (warning, not a block)', async () => {
        const result = await compileProject(
            instanceDocument({ masters: { status: 'ok', count: 2 }, codeFiles: { status: 'error', reason: 'engine exploded' } }),
            { projectName: 'gate-partial' },
        );
        expect(result.zip).toBeDefined();
        // The compiler surfaces the single-side degradation as a warning.
        expect(result.diagnostics.validation.warnings.some((w) => w.stage === 'extraction')).toBe(true);
    });

    it('does not block a document with no component instances', async () => {
        const result = await compileProject(instanceDocument(bothDown, 'Frame'), { projectName: 'gate-plain' });
        expect(result.zip).toBeDefined();
    });

    it('does not block documents without an extraction record (mock / standalone)', async () => {
        const result = await compileProject(mockFramerDocument, { projectName: 'gate-mock' });
        expect(result.zip).toBeDefined();
    });

    it('does not block when shared-module bundles recovered the components', async () => {
        // A document whose code components are ALL published modules has no
        // local code files by design — the bundles ARE the implementations,
        // so an empty getCodeFiles + degraded masters must not block it.
        const result = await compileProject(
            instanceDocument({
                masters: { status: 'empty', reason: 'getNodesWithType resolved but returned no ComponentNode masters.' },
                codeFiles: { status: 'empty', reason: 'getCodeFiles resolved but returned no component code files.' },
                modules: { status: 'ok', count: 4 },
            }),
            { projectName: 'gate-modules' },
        );
        expect(result.zip).toBeDefined();
    });
});

describe('validateDocument', () => {
    it('accepts a well-formed document', () => {
        expect(() => validateDocument(mockFramerDocument)).not.toThrow();
    });

    it('rejects malformed documents', () => {
        expect(() => validateDocument({ id: 123 })).toThrow(/Invalid Framer document/);
        expect(() => validateDocument(null)).toThrow(/Invalid Framer document/);
    });
});
