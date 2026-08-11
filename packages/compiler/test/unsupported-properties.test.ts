/**
 * Closing the last unsupported properties.
 *
 * Phase 1's Source Property Coverage diagnostic flagged these two as
 * `unsupported` because the Design AST was missing fields, the SDK adapter
 * was not forwarding them, and the generator did not emit them:
 *
 *   - layout.gridColumnWidth — per-column fixed width in a CSS grid
 *   - style.cursor          — arbitrary CSS cursor string
 *
 * These tests assert each property reaches the AST and is emitted into the
 * generated code on a fixture that exercises them.
 */

import { describe, expect, it } from 'vitest';

import { SOURCE_PROPERTIES, collectCoverage } from '../src/coverage';
import { compileFramerDocument } from '../src/index';
import { mockFramerDocument, parseFramerDocument } from '@framer/compiler-parser';

const PROPERTY_IDS = ['layout.gridColumnWidth', 'style.cursor', 'layout.gridRowHeight', 'style.imageRendering'] as const;

/** Build a fixture exercising both previously-unsupported properties. */
function makeUnsupportedFixture(): typeof mockFramerDocument {
    const gridNode = {
        id: 'n_grid',
        type: 'Frame',
        name: 'Card Grid',
        frame: { x: 0, y: 0, width: 1200, height: 320 },
        layout: {
            strategy: 'grid',
            columns: 3,
            rows: 2,
            columnWidth: 280,
            rowHeight: 240,
            columnGap: 24,
            rowGap: 24,
        },
        style: {},
        children: [
            { id: 'n_grid_a', type: 'Frame', name: 'A', frame: { x: 0, y: 0, width: 280, height: 240 }, layout: { strategy: 'auto' }, style: {} },
            { id: 'n_grid_b', type: 'Frame', name: 'B', frame: { x: 304, y: 0, width: 280, height: 240 }, layout: { strategy: 'auto' }, style: {} },
            { id: 'n_grid_c', type: 'Frame', name: 'C', frame: { x: 608, y: 0, width: 280, height: 240 }, layout: { strategy: 'auto' }, style: {} },
        ],
    };
    const grabbable = {
        id: 'n_grab',
        type: 'Frame',
        name: 'Draggable',
        frame: { x: 0, y: 0, width: 240, height: 80 },
        layout: { strategy: 'auto' },
        style: { cursor: 'grab' },
        children: [
            { id: 'n_grab_label', type: 'Text', name: 'Label', frame: { x: 0, y: 0, width: 200, height: 40 }, layout: { strategy: 'auto' }, text: { text: 'Drag me', style: { fontFamily: 'Inter', fontSize: 16 } } },
        ],
    };
    const pixelatedImage = {
        id: 'n_pixel',
        type: 'Frame',
        name: 'Pixel-art container',
        frame: { x: 0, y: 0, width: 320, height: 320 },
        layout: { strategy: 'auto' },
        style: { imageRendering: 'pixelated' },
        children: [
            { id: 'n_pixel_inner', type: 'Frame', name: 'Inner', frame: { x: 0, y: 0, width: 320, height: 320 }, layout: { strategy: 'auto' }, style: {} },
        ],
    };
    return {
        id: 'unsupported-fixture',
        name: 'Unsupported Properties Fixture',
        version: '1.0.0',
        nodes: [gridNode, grabbable, pixelatedImage],
    };
}

describe('layout.gridColumnWidth reaches the AST and emits', () => {
    it('preserves columnWidth in layout.style.columnWidth', () => {
        const ast = parseFramerDocument(makeUnsupportedFixture());
        const grid = ast.nodes.find((n) => n.id === 'n_grid');
        expect(grid?.layout?.style?.strategy).toBe('grid');
        if (grid?.layout?.style?.strategy !== 'grid') return;
        expect(grid.layout.style.columnWidth).toBe(280);
    });

    it('emits `gridTemplateColumns: repeat(N, Xpx)` inline style in the generated code', async () => {
        const result = await compileFramerDocument(makeUnsupportedFixture(), { projectName: 'grid' });
        const content = result.files
            .filter((f) => f.path.startsWith('src/sections/') && f.path.endsWith('.tsx'))
            .map((f) => f.content)
            .join('\n');
        expect(content).toMatch(/gridTemplateColumns:\s*'repeat\(3,\s*280px\)'/);
    });
});

describe('layout.gridRowHeight reaches the AST and emits', () => {
    it('preserves rowHeight in layout.style.rowHeight', () => {
        const ast = parseFramerDocument(makeUnsupportedFixture());
        const grid = ast.nodes.find((n) => n.id === 'n_grid');
        expect(grid?.layout?.style?.strategy).toBe('grid');
        if (grid?.layout?.style?.strategy !== 'grid') return;
        expect(grid.layout.style.rowHeight).toBe(240);
    });

    it('emits `gridTemplateRows: repeat(N, Xpx)` inline style in the generated code', async () => {
        const result = await compileFramerDocument(makeUnsupportedFixture(), { projectName: 'gridrows' });
        const content = result.files
            .filter((f) => f.path.startsWith('src/sections/') && f.path.endsWith('.tsx'))
            .map((f) => f.content)
            .join('\n');
        expect(content).toMatch(/gridTemplateRows:\s*'repeat\(2,\s*240px\)'/);
    });
});

describe('style.cursor reaches the AST and emits', () => {
    it('preserves the cursor string into style.cursor', () => {
        const ast = parseFramerDocument(makeUnsupportedFixture());
        const grab = ast.nodes.find((n) => n.id === 'n_grab');
        expect(grab?.style?.cursor).toBe('grab');
    });

    it('emits inline `cursor: <value>` in the generated code', async () => {
        const result = await compileFramerDocument(makeUnsupportedFixture(), { projectName: 'cursor' });
        const content = result.files
            .filter((f) => f.path.startsWith('src/sections/') && f.path.endsWith('.tsx'))
            .map((f) => f.content)
            .join('\n');
        expect(content).toMatch(/cursor:\s*'grab'/);
    });
});

describe('style.imageRendering reaches the AST and emits', () => {
    it('preserves the imageRendering string into style.imageRendering', () => {
        const ast = parseFramerDocument(makeUnsupportedFixture());
        const pixel = ast.nodes.find((n) => n.id === 'n_pixel');
        expect(pixel?.style?.imageRendering).toBe('pixelated');
    });

    it('emits inline `imageRendering: <value>` in the generated code', async () => {
        const result = await compileFramerDocument(makeUnsupportedFixture(), { projectName: 'renderer' });
        const content = result.files
            .filter((f) => f.path.startsWith('src/sections/') && f.path.endsWith('.tsx'))
            .map((f) => f.content)
            .join('\n');
        expect(content).toMatch(/imageRendering:\s*'pixelated'/);
    });
});

describe('coverage classification on the unsupported-properties fixture', () => {
    it('classifies both formerly-unsupported properties as `emitted`', async () => {
        const result = await compileFramerDocument(makeUnsupportedFixture(), { projectName: 'cov-unsup' });
        const byId = new Map(result.diagnostics.coverage!.properties.map((e) => [e.id, e] as const));

        for (const id of PROPERTY_IDS) {
            const entry = byId.get(id);
            expect(entry, `coverage missing ${id}`).toBeDefined();
            expect(entry?.discovered, `${id} should be discovered`).toBe(true);
            expect(entry?.preserved, `${id} should be preserved`).toBe(true);
            expect(entry?.emitted, `${id} should be emitted`).toBe(true);
            expect(entry?.stage).toBe('emitted');
            expect(entry?.unsupported, `${id} should NOT be unsupported`).toBe(false);
        }
    });

    it('the unsupported bucket count is now zero on the unsupported-properties fixture', async () => {
        const result = await compileFramerDocument(makeUnsupportedFixture(), { projectName: 'cov-no-unsup' });
        const unsupported = result.diagnostics.coverage!.properties.filter((p) => p.unsupported);
        expect(unsupported).toEqual([]);
    });
});

describe('registry: 66 registered properties, all marked active', () => {
    it('contains the four formerly-unsupported properties as active (not `unsupported`)', () => {
        const gridColumnWidth = SOURCE_PROPERTIES.find((p) => p.id === 'layout.gridColumnWidth');
        const cursor = SOURCE_PROPERTIES.find((p) => p.id === 'style.cursor');
        const gridRowHeight = SOURCE_PROPERTIES.find((p) => p.id === 'layout.gridRowHeight');
        const imageRendering = SOURCE_PROPERTIES.find((p) => p.id === 'style.imageRendering');
        expect(gridColumnWidth).toBeDefined();
        expect(cursor).toBeDefined();
        expect(gridRowHeight).toBeDefined();
        expect(imageRendering).toBeDefined();
        for (const property of [gridColumnWidth, cursor, gridRowHeight, imageRendering]) {
            expect(property?.unsupported).not.toBe(true);
        }
        expect(gridColumnWidth?.framerNodePath).toBe('layout.columnWidth');
        expect(gridColumnWidth?.designAstPath).toBe('layout.style.columnWidth');
        expect(cursor?.framerNodePath).toBe('style.cursor');
        expect(cursor?.designAstPath).toBe('style.cursor');
        expect(gridRowHeight?.framerNodePath).toBe('layout.rowHeight');
        expect(gridRowHeight?.designAstPath).toBe('layout.style.rowHeight');
        expect(imageRendering?.framerNodePath).toBe('style.imageRendering');
        expect(imageRendering?.designAstPath).toBe('style.imageRendering');
    });

    it('contains exactly 66 registered properties', () => {
        expect(SOURCE_PROPERTIES.length).toBe(66);
    });

    it('no property in the registry carries `unsupported: true`', () => {
        const remainingUnsupported = SOURCE_PROPERTIES.filter((p) => p.unsupported === true);
        expect(remainingUnsupported).toEqual([]);
    });
});

describe('no regression on the mock document', () => {
    it('still produces zero `unsupported`, zero `lost`, zero `ast-preserved` properties', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'mock-no-regress' });

        const coverage = result.diagnostics.coverage!;
        const unsupported = coverage.properties.filter((p) => p.unsupported);
        const lost = coverage.properties.filter((p) => p.stage === 'lost');
        const astPreserved = coverage.properties.filter((p) => p.stage === 'ast-preserved');

        expect(unsupported, `unexpected unsupported: ${unsupported.map((p) => p.id).join(', ')}`).toEqual([]);
        expect(lost, `unexpected lost: ${lost.map((p) => p.id).join(', ')}`).toEqual([]);
        expect(astPreserved, `unexpected ast-preserved: ${astPreserved.map((p) => p.id).join(', ')}`).toEqual([]);
    });

    it('still emits a valid export manifest with fromMasters + fromCode + synthesized counts', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'mock-manifest' });
        const manifest = result.files.find((f) => f.path === '.export-manifest.json');
        expect(manifest).toBeDefined();
        const parsed = JSON.parse(manifest?.content ?? '{}') as { components: { definitions: number; instances: number } };
        expect(parsed.components.definitions).toBeGreaterThan(0);
        expect(parsed.components.instances).toBeGreaterThan(0);
    });
});

describe('empty-source smoke', () => {
    it('returns all-zero stages when no properties are exercised', () => {
        const empty = { id: 'e', name: 'empty', version: '0.0.0', nodes: [] as never[] };
        const ast = parseFramerDocument(empty);
        const report = collectCoverage({ source: empty, ast, files: [] });
        for (const id of PROPERTY_IDS) {
            expect(report.properties.find((p) => p.id === id)?.emitted, `${id} should not be emitted on empty source`).toBe(false);
        }
    });
});
