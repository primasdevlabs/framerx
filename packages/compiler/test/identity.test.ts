/**
 * Deterministic source identity.
 *
 * The same Framer source node must always become the same Design AST node:
 * node ids ARE the Framer source ids, so identity survives any number of
 * parses, traversals, and exports.
 */

import { describe, expect, it } from 'vitest';

import type { DesignNode } from '@framer/compiler-ast';
import { mockFramerDocument, parseFramerDocument } from '@framer/compiler-parser';
import { compileFramerDocument } from '../src/index';

/** Flatten a node tree into a list of { id, sourceId } pairs. */
function collectIds(
    node: DesignNode,
    out: Array<{ id: string; sourceId: string | undefined }> = [],
): Array<{ id: string; sourceId: string | undefined }> {
    out.push({ id: node.id, sourceId: node.metadata?.sourceId });
    for (const child of node.children) collectIds(child, out);
    return out;
}

describe('source identity', () => {
    it('uses the Framer source id as the AST node id', () => {
        const doc = parseFramerDocument(mockFramerDocument);
        const ids = doc.nodes.flatMap((node) => collectIds(node));

        expect(ids.length).toBeGreaterThan(10);
        for (const { id, sourceId } of ids) {
            expect(id).toBe(sourceId);
            // The mock ids look like frame_hero / text_heading — never _1_2 timestamps.
            expect(id).not.toMatch(/^node_/);
        }
        expect(ids.some(({ id }) => id === 'frame_hero')).toBe(true);
        expect(ids.some(({ id }) => id === 'button_primary')).toBe(true);
    });

    it('produces identical node ids across repeated parses', () => {
        const a = parseFramerDocument(mockFramerDocument);
        const b = parseFramerDocument(mockFramerDocument);

        expect(a.nodes.map((node) => node.id)).toEqual(b.nodes.map((node) => node.id));
        const idsOf = (doc: ReturnType<typeof parseFramerDocument>) =>
            doc.nodes.flatMap((node) => collectIds(node)).map(({ id }) => id);
        expect(idsOf(a)).toEqual(idsOf(b));
    });

    it('produces identical asset and animation ids across repeated parses', () => {
        const a = parseFramerDocument(mockFramerDocument);
        const b = parseFramerDocument(mockFramerDocument);

        expect(a.assets.map((asset) => asset.id)).toEqual(b.assets.map((asset) => asset.id));
        expect(a.nodes.map((n) => n.animations?.animations.map((anim) => anim.id) ?? []).flat()).toEqual(
            b.nodes.map((n) => n.animations?.animations.map((anim) => anim.id) ?? []).flat(),
        );
    });

    it('generates the same output across exports (files and ZIP bytes)', async () => {
        const a = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });
        const b = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });

        expect(a.files.map((f) => f.content)).toEqual(b.files.map((f) => f.content));
        // The ZIP is byte-identical too (deterministic metadata + content).
        expect(a.zip).toEqual(b.zip);
    });

    it('never emits generated timestamp ids into the output', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });
        for (const file of result.files) {
            expect(file.content).not.toMatch(/node_[a-z0-9]+_[a-z0-9]+/);
        }
    });
});
