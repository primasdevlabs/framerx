/**
 * Tests for the SDK key probe (`captureSdkKeys`).
 *
 * The probe is the diagnostic counterpart to extraction: when components get
 * synthesized, it dumps the EXACT componentIdentifier/insertURL/componentName
 * keys the live engine exposed on masters, instances, and code files, plus
 * which instances matched nothing (and with which keys they looked up).
 */

import { describe, expect, it } from 'vitest';

import { captureSdkKeys } from '../src/parser/probe';
import type { FramerApi } from '../src/parser/sdk';

/** A fake api with configurable nodes/files. */
function fakeApi(overrides: Partial<FramerApi> = {}): FramerApi {
    return {
        getNodesWithType: async () => [],
        getCodeFiles: async () => [],
        ...overrides,
    } as FramerApi;
}

describe('captureSdkKeys', () => {
    it('captures the identifying keys of masters, instances, and code files', async () => {
        const api = fakeApi({
            getNodesWithType: async (type) =>
                type === 'ComponentNode'
                    ? [
                          { id: 'master_btn', name: 'Button Master', componentIdentifier: 'comp_btn', insertURL: 'framer.com/m/proj@Button@Button', componentName: 'Button' },
                      ]
                    : [
                          { id: 'inst_1', name: 'Button', componentIdentifier: 'comp_btn', insertURL: null, componentName: 'Button' },
                          { id: 'inst_2', name: 'Shared Thing', componentIdentifier: null, insertURL: null, componentName: 'SharedThing' },
                      ],
            getCodeFiles: async () => [
                {
                    id: 'file_ph',
                    name: 'Phosphor.tsx',
                    path: 'code/Phosphor.tsx',
                    content: 'export function Phosphor() { return null }',
                    exports: [
                        { name: 'Phosphor', componentId: 'comp_ph', insertURL: 'framer.com/m/proj@Phosphor.tsx@Phosphor', isDefaultExport: false, type: 'component' },
                        { name: 'withAnalytics', type: 'override' },
                    ],
                },
            ],
        });

        const dump = await captureSdkKeys(api);

        // Raw key records.
        expect(dump.masters).toHaveLength(1);
        expect(dump.masters[0]).toMatchObject({ id: 'master_btn', componentIdentifier: 'comp_btn', insertURL: 'framer.com/m/proj@Button@Button', componentName: 'Button' });
        expect(dump.instances).toHaveLength(2);
        expect(dump.instances[1]).toMatchObject({ id: 'inst_2', componentIdentifier: null, componentName: 'SharedThing' });
        expect(dump.codeFiles).toHaveLength(1);
        expect(dump.codeFiles[0].exports).toHaveLength(2);
        // Override exports are kept in the raw dump (they are part of the file).
        expect(dump.codeFiles[0].exports[1]).toMatchObject({ name: 'withAnalytics', type: 'override' });

        // Matching: instance 1 hits the master by componentIdentifier; instance
        // 2 (no keys the master exposes) is unmatched with its looked-up keys.
        expect(dump.matching.masterMatched).toBe(1);
        expect(dump.matching.masterUnmatched).toHaveLength(1);
        expect(dump.matching.masterUnmatched[0].instance.id).toBe('inst_2');
        expect(dump.matching.masterUnmatched[0].lookedUp).toEqual({ componentName: 'SharedThing' });
    });

    it('classifies code-component matches by componentId and export name', async () => {
        const api = fakeApi({
            getNodesWithType: async (type) =>
                type === 'ComponentNode'
                    ? []
                    : [
                          { id: 'inst_ph', name: 'Phosphor', componentIdentifier: 'comp_ph', insertURL: 'framer.com/m/proj@Phosphor.tsx@Phosphor', componentName: 'Phosphor' },
                          { id: 'inst_named', name: 'Ticker', componentIdentifier: 'engine_other', insertURL: null, componentName: 'Ticker' },
                          { id: 'inst_orphan', name: 'Slideshow', componentIdentifier: null, insertURL: null, componentName: null },
                      ],
            getCodeFiles: async () => [
                {
                    id: 'file_phosphor',
                    name: 'Phosphor.tsx',
                    path: 'code/Phosphor.tsx',
                    content: 'export function Phosphor() { return null }',
                    exports: [{ name: 'Phosphor', componentId: 'comp_ph', insertURL: 'framer.com/m/proj@Phosphor.tsx@Phosphor', isDefaultExport: false, type: 'component' }],
                },
                {
                    id: 'file_ticker',
                    name: 'Ticker.tsx',
                    path: 'code/Ticker.tsx',
                    content: 'export default function Ticker() { return null }',
                    exports: [{ name: 'Ticker', componentId: 'comp_ticker_engine', insertURL: 'framer.com/m/proj@Ticker.tsx@Ticker', isDefaultExport: true, type: 'component' }],
                },
            ],
        });

        const dump = await captureSdkKeys(api);

        // Phosphor matches by componentId; Ticker matches by export name
        // (its componentIdentifier differs from the file's componentId).
        expect(dump.matching.codeMatched).toBe(2);
        expect(dump.matching.codeUnmatched).toHaveLength(1);
        expect(dump.matching.codeUnmatched[0].instance.id).toBe('inst_orphan');
        // The orphan carried NO identifying keys at all — the actionable datum.
        expect(dump.matching.codeUnmatched[0].lookedUp).toEqual({});
    });

    it('records per-source statuses and never throws when APIs fail', async () => {
        const api = fakeApi({
            getNodesWithType: async () => {
                throw new Error('engine exploded');
            },
            getCodeFiles: async () => {
                throw new Error('Permission denied');
            },
        } as FramerApi);

        const dump = await captureSdkKeys(api);

        expect(dump.sources.masters).toMatchObject({ available: true, ok: false });
        expect(dump.sources.masters.error).toContain('engine exploded');
        expect(dump.sources.codeFiles).toMatchObject({ available: true, ok: false });
        expect(dump.sources.codeFiles.error).toContain('Permission denied');
        // The dump stays complete and usable — empty lists, no throw.
        expect(dump.masters).toEqual([]);
        expect(dump.instances).toEqual([]);
        expect(dump.codeFiles).toEqual([]);
        expect(dump.matching.masterUnmatched).toEqual([]);
    });

    it('records unavailable when the SDK surface lacks a method', async () => {
        const api = {
            getCodeFiles: async () => [],
        } as unknown as FramerApi;

        const dump = await captureSdkKeys(api);

        expect(dump.sources.masters).toEqual({ available: false, ok: false });
        expect(dump.sources.instances).toEqual({ available: false, ok: false });
        expect(dump.sources.codeFiles).toMatchObject({ available: true, ok: true });
    });
});
