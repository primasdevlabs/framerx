/**
 * Extraction root-cause warnings + orphaned-asset triage.
 *
 * When the plugin's source-model enrichment degrades (component masters /
 * code files unavailable), the compiler must explain WHY — a wall of
 * identical "synthesized" component warnings is useless without the cause.
 * The extraction statuses recorded on `FramerDocument.metadata.extraction`
 * become `extraction`-stage warnings in the export diagnostics.
 *
 * Orphaned assets get triaged: an asset referenced only by a CODE component
 * prop is expected (the arbitrary source cannot be rewritten to import the
 * file, but the file is preserved in the ZIP) and the warning explains that;
 * a genuinely unreferenced canvas asset keeps the plain warning.
 */

import { describe, expect, it } from 'vitest';

import type { FramerDocument, FramerNode } from '@framer/compiler-parser';
import { mockFramerDocument } from '@framer/compiler-parser';

import { compileFramerDocument } from '../src/index';

/** A frame node (the section root). */
function sectionRoot(id: string, name: string, children: FramerNode[]): FramerNode {
    return {
        id,
        type: 'Frame',
        name,
        frame: { x: 0, y: 0, width: 1440, height: 900 },
        layout: { strategy: 'flex', direction: 'column', alignItems: 'flex-start' },
        style: {},
        children,
    };
}

/** A code-component instance (real source fetched through the SDK). */
function codeInstance(
    id: string,
    name: string,
    props: Record<string, unknown>,
    source: string,
): FramerNode {
    return {
        id,
        type: 'Component',
        name,
        frame: { x: 0, y: 0, width: 320, height: 200 },
        layout: { strategy: 'auto' },
        style: {},
        component: {
            id: `comp_${id}`,
            name,
            props,
            code: {
                source,
                fileName: `${name}.tsx`,
                path: `code/${name}.tsx`,
                exportName: name,
                isDefaultExport: false,
            },
        },
        children: [],
    };
}

/** An inline-SVG vector node — its asset file is written to src/assets/images. */
function vectorNode(id: string, name: string, svg: string): FramerNode {
    return {
        id,
        type: 'Vector',
        name,
        frame: { x: 0, y: 0, width: 24, height: 24 },
        layout: { strategy: 'auto' },
        style: {},
        vector: { svg, name },
        children: [],
    };
}

const slideshowSource = `export function Slideshow({ images }: { images: string }) {\n    return <img src={images} alt="slide" />\n}\n`;

describe('extraction root-cause warnings', () => {
    /** The mock document with a degraded extraction record. */
    function docWithExtraction(extraction: unknown): FramerDocument {
        return {
            ...mockFramerDocument,
            metadata: { platform: 'framer', extraction },
        };
    }

    it('surfaces a warning explaining why component bodies were synthesized', async () => {
        const result = await compileFramerDocument(
            docWithExtraction({
                masters: { status: 'unavailable', reason: 'The SDK does not expose getNodesWithType; component masters cannot be read.' },
                codeFiles: { status: 'ok', count: 3 },
            }),
            { projectName: 'extraction-warnings' },
        );

        const extractionWarnings = result.diagnostics.validation.warnings.filter((w) => w.stage === 'extraction');
        expect(extractionWarnings).toHaveLength(1);
        expect(extractionWarnings[0].message).toContain('Component masters could not be fetched');
        expect(extractionWarnings[0].message).toContain('unavailable');
        expect(extractionWarnings[0].message).toContain('synthesized');
        // The wall of per-component "synthesized" warnings is still there —
        // the root cause now explains them.
        expect(result.diagnostics.validation.warnings.some((w) => w.message.includes('synthesized from instance props'))).toBe(true);
    });

    it('surfaces a warning when code files were denied by permissions', async () => {
        const result = await compileFramerDocument(
            docWithExtraction({
                masters: { status: 'ok', count: 5 },
                codeFiles: { status: 'denied', reason: 'getCodeFiles threw a permission error: Permission denied' },
            }),
            { projectName: 'extraction-warnings' },
        );

        const extractionWarnings = result.diagnostics.validation.warnings.filter((w) => w.stage === 'extraction');
        expect(extractionWarnings).toHaveLength(1);
        expect(extractionWarnings[0].message).toContain('Code files could not be fetched');
        expect(extractionWarnings[0].message).toContain('denied');
    });

    it('warns when project fonts could not be collected from the SDK', async () => {
        const result = await compileFramerDocument(
            docWithExtraction({
                masters: { status: 'ok', count: 0 },
                codeFiles: { status: 'ok', count: 0 },
                fonts: { status: 'unavailable', reason: 'The SDK does not expose getFonts; fonts are exported as metadata only.' },
            }),
            { projectName: 'extraction-warnings' },
        );

        const extractionWarnings = result.diagnostics.validation.warnings.filter((w) => w.stage === 'extraction');
        expect(extractionWarnings).toHaveLength(1);
        expect(extractionWarnings[0].message).toContain('Project fonts could not be collected');
        expect(extractionWarnings[0].message).toContain('no @font-face files');
    });

    it('does not duplicate the per-font no-source warnings the registry emits', async () => {
        // A partial status means some fonts bundled fine and the rest were
        // recorded with empty sources — the FontRegistry warns for each of
        // those individually. No extra extraction-level summary.
        const result = await compileFramerDocument(
            docWithExtraction({
                masters: { status: 'ok', count: 0 },
                codeFiles: { status: 'ok', count: 0 },
                fonts: { status: 'partial', failed: 2, reason: '2 font(s) have no downloadable source file (Custom Display, X) — custom fonts are not available to the plugin API; the rest are bundled.' },
            }),
            { projectName: 'extraction-warnings' },
        );

        expect(result.diagnostics.validation.warnings.filter((w) => w.stage === 'extraction')).toHaveLength(0);
    });

    it('surfaces both warnings when both enrichments degraded', async () => {
        const result = await compileFramerDocument(
            docWithExtraction({
                masters: { status: 'empty', reason: 'getNodesWithType resolved but returned no ComponentNode masters.' },
                codeFiles: { status: 'error', reason: 'getCodeFiles threw: engine exploded' },
            }),
            { projectName: 'extraction-warnings' },
        );

        const extractionWarnings = result.diagnostics.validation.warnings.filter((w) => w.stage === 'extraction');
        expect(extractionWarnings).toHaveLength(2);
        expect(extractionWarnings.map((w) => w.message).join('\n')).toContain('empty');
        expect(extractionWarnings.map((w) => w.message).join('\n')).toContain('engine exploded');
    });

    it('emits no extraction warnings when enrichment was healthy', async () => {
        const result = await compileFramerDocument(
            docWithExtraction({
                masters: { status: 'ok', count: 2 },
                codeFiles: { status: 'ok', count: 1 },
            }),
            { projectName: 'extraction-warnings' },
        );

        expect(result.diagnostics.validation.warnings.filter((w) => w.stage === 'extraction')).toHaveLength(0);
    });

    it('emits no extraction warnings when the source carries no extraction record', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'extraction-warnings' });
        expect(result.diagnostics.validation.warnings.filter((w) => w.stage === 'extraction')).toHaveLength(0);
    });

    it('names the exact keys of instances that matched neither a master nor a code file', async () => {
        const result = await compileFramerDocument(
            docWithExtraction({
                masters: { status: 'ok', count: 3 },
                codeFiles: { status: 'ok', count: 2 },
                unmatchedInstances: [
                    {
                        id: 'inst_a',
                        name: 'Slideshow',
                        componentIdentifier: 'comp_a',
                        insertURL: 'framer.com/m/proj@Slideshow.tsx@Slideshow',
                        componentName: 'Slideshow',
                    },
                    {
                        id: 'inst_b',
                        name: 'Ticker',
                        componentIdentifier: null,
                        insertURL: null,
                        componentName: null,
                    },
                ],
            }),
            { projectName: 'extraction-warnings' },
        );

        const warning = result.diagnostics.validation.warnings.find((w) => w.message.includes('matched neither a component master nor a code file'));
        expect(warning).toBeDefined();
        expect(warning!.message).toContain('2 component instance(s)');
        expect(warning!.message).toContain('Slideshow [componentIdentifier: comp_a, insertURL: framer.com/m/proj@Slideshow.tsx@Slideshow, componentName: Slideshow]');
        expect(warning!.message).toContain('Ticker [no identifying keys]');
    });

    it('warns when shared-module bundles could not be fetched (partial)', async () => {
        const result = await compileFramerDocument(
            docWithExtraction({
                masters: { status: 'ok', count: 0 },
                codeFiles: { status: 'empty', reason: 'getCodeFiles resolved but returned no component code files.' },
                modules: {
                    status: 'partial',
                    count: 3,
                    failed: 2,
                    reason: '2 module bundle(s) could not be fetched (Ticker [https://framerusercontent.com/modules/x/Ticker.js]; Slideshow [https://framerusercontent.com/modules/y/Slideshow.js]).',
                },
            }),
            { projectName: 'extraction-warnings' },
        );

        const warning = result.diagnostics.validation.warnings.find((w) => w.message.includes('Shared module components could not be fully fetched'));
        expect(warning).toBeDefined();
        expect(warning!.message).toContain('partial');
        expect(warning!.message).toContain('2 component bundle(s)');
        // The reason names the exact bundles that failed.
        expect(warning!.message).toContain('Ticker [https://framerusercontent.com/modules/x/Ticker.js]');
        expect(warning!.message).toContain('synthesized');
    });

    it('suppresses the stale empty-codeFiles warning when module bundles recovered the components', async () => {
        // A document whose code components are ALL shared modules legitimately
        // has zero local code files; the module fetcher recovered them, so
        // "code files could not be fetched (empty)" would be a false alarm.
        const result = await compileFramerDocument(
            docWithExtraction({
                masters: { status: 'ok', count: 0 },
                codeFiles: { status: 'empty', reason: 'getCodeFiles resolved but returned no component code files.' },
                modules: { status: 'ok', count: 5 },
            }),
            { projectName: 'extraction-warnings' },
        );

        const extractionWarnings = result.diagnostics.validation.warnings.filter((w) => w.stage === 'extraction');
        expect(extractionWarnings).toHaveLength(0);
    });

    it('keeps the empty-codeFiles warning when modules did NOT recover them', async () => {
        // No module resolution at all (or partial): the empty codeFiles status
        // stays meaningful — those code components WILL be synthesized.
        const result = await compileFramerDocument(
            docWithExtraction({
                masters: { status: 'ok', count: 0 },
                codeFiles: { status: 'empty', reason: 'getCodeFiles resolved but returned no component code files.' },
            }),
            { projectName: 'extraction-warnings' },
        );

        const extractionWarnings = result.diagnostics.validation.warnings.filter((w) => w.stage === 'extraction');
        expect(extractionWarnings).toHaveLength(1);
        expect(extractionWarnings[0].message).toContain('Code files could not be fetched');
    });

    it('deduplicates repeated unmatched instances of the same node', async () => {
        const result = await compileFramerDocument(
            docWithExtraction({
                masters: { status: 'ok', count: 1 },
                codeFiles: { status: 'empty', reason: 'no files' },
                unmatchedInstances: [
                    { id: 'inst_a', name: 'Phosphor', componentIdentifier: 'comp_p', insertURL: null, componentName: 'Phosphor' },
                    { id: 'inst_a', name: 'Phosphor', componentIdentifier: 'comp_p', insertURL: null, componentName: 'Phosphor' },
                ],
            }),
            { projectName: 'extraction-warnings' },
        );

        const warning = result.diagnostics.validation.warnings.find((w) => w.message.includes('matched neither a component master nor a code file'));
        expect(warning).toBeDefined();
        expect(warning!.message).toContain('1 component instance(s)');
        expect(warning!.message).not.toContain('more');
    });
});

describe('orphaned-asset triage', () => {
    it('explains an orphan referenced only by a code-component prop', async () => {
        const doc: FramerDocument = {
            id: 'doc_orphan_explained',
            name: 'Orphan Explained',
            version: '1.0.0',
            nodes: [
                sectionRoot('root', 'Gallery Section', [
                    // The code component consumes the asset by prop value only —
                    // its arbitrary source cannot be rewritten to import the file.
                    codeInstance('c1', 'Slideshow', { images: 'Icon.svg' }, slideshowSource),
                    // The asset's inline SVG is written to disk by the registry,
                    // but generated code inlines the SVG directly — the file
                    // itself is unreferenced by code.
                    vectorNode('v1', 'Icon', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z" fill="#000"/></svg>'),
                ]),
            ],
        };

        const result = await compileFramerDocument(doc, { projectName: 'orphan-triage' });

        const orphan = result.diagnostics.validation.warnings.find((w) => w.message.includes('src/assets/images/Icon.svg'));
        expect(orphan).toBeDefined();
        expect(orphan!.message).toContain('referenced only by a code component');
        expect(orphan!.message).toContain('Slideshow');
        expect(orphan!.message).toContain('preserved in the ZIP');
        expect(result.diagnostics.validation.valid).toBe(true);
    });

    it('keeps the plain warning for a genuinely unreferenced canvas asset', async () => {
        const doc: FramerDocument = {
            id: 'doc_orphan_plain',
            name: 'Orphan Plain',
            version: '1.0.0',
            nodes: [
                sectionRoot('root', 'Gallery Section', [
                    vectorNode('v1', 'Icon', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z" fill="#000"/></svg>'),
                ]),
            ],
        };

        const result = await compileFramerDocument(doc, { projectName: 'orphan-triage' });

        const orphan = result.diagnostics.validation.warnings.find((w) => w.message.includes('src/assets/images/Icon.svg'));
        expect(orphan).toBeDefined();
        expect(orphan!.message).toContain('written but never referenced');
        // No triage explanation — nothing references it, it is a real gap.
        expect(orphan!.message).not.toContain('referenced only by a code component');
        expect(result.diagnostics.validation.valid).toBe(true);
    });
});
