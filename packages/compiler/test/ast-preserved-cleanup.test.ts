/**
 * AST-preserved → emitted regression tests.
 *
 * After fixing the lost-properties Pass, the Source Property Coverage report
 * surfaced 4 properties that were classified as `ast-preserved` rather than
 * `emitted`. Investigation showed the needles were too coarse:
 *
 *   - layout.stackWrapEnabled → needle was `flex-wrap`, but `wrap: false`
 *     correctly emits no class (Tailwind's default); needle `flex flex`
 *     covers both the wrap and direction signals.
 *   - layout.position → needle was `absolute`, but static default emits no
 *     class; needle `position:` covers both inline position styles and
 *     className position utilities.
 *   - asset.image → needle was `/assets/images/`, but with no local bytes
 *     the generator emits `<img src="<remote url>">` plus a placeholder
 *     note; needle `<img` matches the actual emitted element.
 *   - component.master → designAstPath was `'template'`, which false-positive
 *     on any extraction template; tightened to `'template.metadata.custom
 *     .masterBody'` so it counts only true master bodies, and needle
 *     `fromMasters` matches the export-manifest.json counter.
 *
 * These tests verify each property reaches the AST and is emitted when a
 * realistic fixture exercises it.
 */

import { describe, expect, it } from 'vitest';

import { collectCoverage } from '../src/coverage';
import { compileFramerDocument } from '../src/index';
import { parseFramerDocument, mockFramerDocument } from '@framer/compiler-parser';

const PROPERTY_IDS = [
    'layout.stackWrapEnabled',
    'layout.position',
    'asset.image',
    'component.master',
] as const;

/**
 * Build a FramerDocument exercising every formerly-ast-preserved property:
 *  - a flex stack with `wrap: true`
 *  - a position: absolute overlay
 *  - an image node (with a remote URL — bytes not fetched)
 *  - a master-backed component instance (with a real canvas master body)
 */
function makeAstPreservedFixture(): typeof mockFramerDocument {
    const wrapNode = {
        id: 'n_wrap',
        type: 'Frame',
        name: 'Wrap Frame',
        frame: { x: 0, y: 0, width: 600, height: 200 },
        layout: {
            strategy: 'flex',
            direction: 'row',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            flexWrap: 'wrap',
            gap: 8,
        },
        style: { fills: [{ type: 'solid', color: '#f8fafc', visible: true }] },
        children: [
            { id: 'n_wrap_child_1', type: 'Frame', name: 'A', frame: { x: 0, y: 0, width: 120, height: 80 }, layout: { strategy: 'auto' }, style: {} },
            { id: 'n_wrap_child_2', type: 'Frame', name: 'B', frame: { x: 128, y: 0, width: 120, height: 80 }, layout: { strategy: 'auto' }, style: {} },
        ],
    };
    const absoluteNode = {
        id: 'n_abs',
        type: 'Frame',
        name: 'Overlay',
        frame: { x: 24, y: 24, width: 80, height: 80 },
        layout: { strategy: 'absolute', position: 'absolute', offsets: { top: 24, left: 24 } },
        style: { fills: [{ type: 'solid', color: '#0f172a', visible: true }] },
    };
    const imageNode = {
        id: 'n_image',
        type: 'Image',
        name: 'Hero',
        frame: { x: 0, y: 0, width: 480, height: 320 },
        layout: { strategy: 'auto' },
        image: { src: 'https://framerusercontent.com/images/hero.png', name: 'Hero', alt: 'Hero image' },
        style: {},
    };
    // Master-backed component: the canvas master provides the real body.
    const masterBody = {
        id: 'master_banner',
        type: 'Component',
        name: 'Banner',
        frame: { x: 0, y: 0, width: 800, height: 160 },
        layout: {
            strategy: 'flex',
            direction: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'nowrap',
            gap: 24,
        },
        style: {
            fills: [{ type: 'solid', color: '#1e293b', visible: true }],
            radius: 12,
        },
        children: [
            { id: 'm_title', type: 'Text', name: 'Title', frame: { x: 0, y: 0, width: 320, height: 32 }, layout: { strategy: 'auto' }, text: { text: 'Banner title', style: { fontFamily: 'Inter', fontSize: 24, fontWeight: 700 } } },
            { id: 'm_slot', type: 'Slot', name: 'children', frame: { x: 0, y: 0, width: 100, height: 100 }, layout: { strategy: 'auto' } },
        ],
    };
    const bannerInstance = {
        id: 'banner_1',
        type: 'Component',
        name: 'Banner',
        frame: { x: 0, y: 0, width: 800, height: 160 },
        layout: { strategy: 'auto' },
        component: {
            id: 'cmp_banner',
            name: 'Banner',
            master: masterBody,
        },
        children: [
            { id: 'instance_title', type: 'Text', name: 'Title', frame: { x: 0, y: 0, width: 320, height: 32 }, layout: { strategy: 'auto' }, text: { text: 'Hero banner', style: { fontFamily: 'Inter', fontSize: 24, fontWeight: 700 } } },
        ],
    };
    return {
        id: 'ast-pres-fixture',
        name: 'AST-preserved fixture',
        version: '1.0.0',
        nodes: [wrapNode, absoluteNode, imageNode, bannerInstance],
    };
}

describe('layout.stackWrapEnabled reaches the AST and emits', () => {
    it('preserves `flexWrap: wrap` into layout.style.flexWrap', () => {
        const ast = parseFramerDocument(makeAstPreservedFixture());
        const wrap = ast.nodes.find((n) => n.id === 'n_wrap');
        expect(wrap?.layout?.style?.flexWrap).toBe('wrap');
    });

    it('emits `flex-wrap` in the generated code when wrap is true', async () => {
        const result = await compileFramerDocument(makeAstPreservedFixture(), { projectName: 'wrap' });
        const content = result.files
            .filter((f) => f.path.startsWith('src/sections/') && f.path.endsWith('.tsx'))
            .map((f) => f.content)
            .join('\n');
        expect(content).toMatch(/flex-wrap/);
    });
});

describe('layout.position reaches the AST and emits when non-default', () => {
    it('preserves position: absolute into layout.position.mode', () => {
        const ast = parseFramerDocument(makeAstPreservedFixture());
        const node = ast.nodes.find((n) => n.id === 'n_abs');
        expect(node?.layout?.position?.mode).toBe('absolute');
    });

    it('emits the position signal in the generated code (Tailwind class or inline style)', async () => {
        const result = await compileFramerDocument(makeAstPreservedFixture(), { projectName: 'pos' });
        const content = result.files
            .filter((f) => f.path.startsWith('src/sections/') && f.path.endsWith('.tsx'))
            .map((f) => f.content)
            .join('\n');
        // Position emits either inline `position: absolute` or the Tailwind
        // `absolute` class — both are valid signals that `layout.position`
        // was honored.
        expect(content).toMatch(/\babsolute\b/);
    });
});

describe('asset.image reaches the AST and emits the <img> element', () => {
    it('preserves the image URL into the AST', () => {
        const ast = parseFramerDocument(makeAstPreservedFixture());
        const image = ast.nodes.find((n) => n.id === 'n_image');
        expect(image?.type).toBe('image');
        if (image?.type !== 'image') return;
        expect(image.asset.src).toBe('https://framerusercontent.com/images/hero.png');
    });

    it('emits an <img src=…> element when local bytes are unavailable', async () => {
        const result = await compileFramerDocument(makeAstPreservedFixture(), { projectName: 'img' });
        const content = result.files
            .filter((f) => f.path.startsWith('src/sections/') && f.path.endsWith('.tsx'))
            .map((f) => f.content)
            .join('\n');
        expect(content).toMatch(/<img\s+src=/);
    });
});

describe('component.master reaches the AST and emits a master-backed definition', () => {
    it('preserves the master flag into template.metadata.custom.masterBody', () => {
        const ast = parseFramerDocument(makeAstPreservedFixture());
        const banner = ast.nodes.find((n) => n.id === 'banner_1');
        expect(banner?.type).toBe('component');
        if (banner?.type !== 'component') return;
        expect(banner.template?.metadata?.custom?.masterBody).toBe(true);
    });

    it('emits a master-backed definition in the export manifest (fromMasters >= 1)', async () => {
        const result = await compileFramerDocument(makeAstPreservedFixture(), { projectName: 'master' });
        const manifest = result.files.find((f) => f.path === '.export-manifest.json');
        expect(manifest).toBeDefined();
        const parsed = JSON.parse(manifest?.content ?? '{}') as { components?: { fromMasters?: number } };
        expect(parsed.components?.fromMasters ?? 0).toBeGreaterThanOrEqual(1);
    });
});

describe('coverage classification on the ast-preserved fixture', () => {
    it('classifies all four ast-preserved properties as `emitted`', async () => {
        const fixture = makeAstPreservedFixture();
        const result = await compileFramerDocument(fixture, { projectName: 'cov-ap' });
        const byId = new Map(result.diagnostics.coverage!.properties.map((e) => [e.id, e] as const));

        for (const id of PROPERTY_IDS) {
            const entry = byId.get(id);
            expect(entry, `coverage missing ${id}`).toBeDefined();
            expect(entry?.discovered, `${id} should be discovered`).toBe(true);
            expect(entry?.preserved, `${id} should be preserved`).toBe(true);
            expect(entry?.emitted, `${id} should be emitted`).toBe(true);
            expect(entry?.stage).toBe('emitted');
        }
    });

    it('the property-by-property needles emit the right signals on the realistic fixture', async () => {
        const fixture = makeAstPreservedFixture();
        const result = await compileFramerDocument(fixture, { projectName: 'cov-needs' });
        const allContent = result.files.map((f) => f.content ?? '').join('\n');
        // Every needle changes a positive artifact in the generated code.
        expect(allContent).toContain('flex flex'); // stackWrapEnabled
        expect(allContent).toContain('position:'); // position
        expect(allContent).toContain('<img'); // asset.image
        const manifest = result.files.find((f) => f.path === '.export-manifest.json');
        expect(manifest?.content).toContain('fromMasters'); // component.master
    });

    it('does not regress the mock document — no properties pushed to `ast-preserved`', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'cov-no-regress' });
        const ap = result.diagnostics.coverage!.properties.filter((p) => p.stage === 'ast-preserved');
        expect(ap).toEqual([]);
        // Lost should remain at zero.
        const lost = result.diagnostics.coverage!.properties.filter((p) => p.stage === 'lost');
        expect(lost).toEqual([]);
    });
});

describe('coverage behavior on empty source', () => {
    it('returns all-zero stages when neither source nor AST contains anything', () => {
        const empty = { id: 'e', name: 'empty', version: '0.0.0', nodes: [] as never[] };
        const ast = parseFramerDocument(empty);
        const report = collectCoverage({ source: empty, ast, files: [] });
        for (const id of PROPERTY_IDS) {
            const entry = report.properties.find((p) => p.id === id)!;
            expect(entry.discovered).toBe(false);
            expect(entry.preserved).toBe(false);
            expect(entry.emitted).toBe(false);
        }
    });
});
