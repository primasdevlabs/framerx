/**
 * Tests for the refresh flow:
 *   - the store-driven export runner compiles the CURRENT document (a
 *     refresh-triggered export must never compile a stale closure document)
 *   - the runner updates status/summary and refuses to run twice concurrently
 *   - the store's refreshing flag drives the header icon
 */

import { mockFramerDocument } from '@framer/compiler-parser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runProjectExport } from '../src/exporter/run-export';
import { DEFAULT_OPTIONS, usePluginStore } from '../src/store/plugin-store';

const originalDocument = globalThis.document;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
    // `triggerDownload` needs a minimal DOM + blob URLs (node has neither).
    const anchor = { click: () => {}, remove: () => {} } as unknown as HTMLAnchorElement;
    globalThis.document = {
        createElement: () => anchor,
        body: { appendChild: () => {} },
    } as unknown as Document;
    URL.createObjectURL = () => 'blob:stub';
    URL.revokeObjectURL = () => {};

    usePluginStore.setState({
        document: null,
        status: 'idle',
        isRefreshing: false,
        error: null,
        summary: null,
        options: { ...DEFAULT_OPTIONS, projectName: '' },
    });
});

afterEach(() => {
    if (originalDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
    } else {
        globalThis.document = originalDocument;
    }
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;

    usePluginStore.setState({
        document: null,
        status: 'idle',
        isRefreshing: false,
        error: null,
        summary: null,
    });
});

describe('runProjectExport', () => {
    it('compiles the store document and updates status + summary', async () => {
        usePluginStore.setState({ document: mockFramerDocument, options: { ...DEFAULT_OPTIONS, projectName: '' } });

        const summary = await runProjectExport();

        expect(summary).not.toBeNull();
        // Empty project name falls back to the document name.
        expect(summary!.name).toBe('MarketingLandingPage');
        expect(summary!.fileCount).toBeGreaterThan(10);
        expect(summary!.diagnostics).toBeDefined();
        expect(summary!.diagnostics!.warnings).toBeInstanceOf(Array);

        const state = usePluginStore.getState();
        expect(state.status).toBe('ready');
        expect(state.summary?.name).toBe('MarketingLandingPage');
        expect(state.error).toBeNull();
    });

    it('always compiles the CURRENT document — a refresh-triggered export never uses a stale closure', async () => {
        // First export with document A.
        const docA = structuredClone(mockFramerDocument) as typeof mockFramerDocument & { name: string };
        docA.name = 'AlphaSite';
        usePluginStore.setState({ document: docA, status: 'idle', summary: null });
        expect((await runProjectExport())?.name).toBe('AlphaSite');

        // The document is replaced by a refresh; the NEXT export must compile
        // the fresh document, not the one captured by the previous call.
        const docB = structuredClone(mockFramerDocument) as typeof mockFramerDocument & { name: string };
        docB.name = 'BetaSite';
        usePluginStore.setState({ document: docB, status: 'idle', summary: null });

        const summary = await runProjectExport();
        expect(summary?.name).toBe('BetaSite');
        expect(usePluginStore.getState().summary?.name).toBe('BetaSite');
    });

    it('returns null (no-op) when no document is loaded', async () => {
        expect(await runProjectExport()).toBeNull();
        expect(usePluginStore.getState().status).toBe('idle');
    });

    it('returns null while an export is already compiling', async () => {
        usePluginStore.setState({ document: mockFramerDocument, status: 'compiling' });
        expect(await runProjectExport()).toBeNull();
        // The in-flight export's status is untouched.
        expect(usePluginStore.getState().status).toBe('compiling');
    });
});

describe('refresh state', () => {
    it('tracks the refreshing flag (drives the header icon)', () => {
        expect(usePluginStore.getState().isRefreshing).toBe(false);
        usePluginStore.getState().setRefreshing(true);
        expect(usePluginStore.getState().isRefreshing).toBe(true);
        usePluginStore.getState().setRefreshing(false);
        expect(usePluginStore.getState().isRefreshing).toBe(false);
    });
});
