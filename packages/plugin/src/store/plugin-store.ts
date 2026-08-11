/**
 * Zustand store for the plugin UI.
 */

import type { FramerDocument } from '@framer/compiler-parser';
import { create } from 'zustand';

import type { FramerApi } from '../parser/sdk';
import type { SdkKeyDump } from '../parser/probe';
import type { ExportOptions } from '../exporter/schemas';

/** A generated project file (structurally compatible with the generator's VirtualFile). */
export interface GeneratedFile {
    path: string;
    content: string;
    binary?: boolean;
    data?: Uint8Array;
}

/** How the plugin is running. */
export type PluginMode = 'loading' | 'standalone' | 'framer';

/** The export lifecycle state. */
export type ExportStatus = 'idle' | 'compiling' | 'ready' | 'error';    /** A summary of a completed export. */
    export interface ExportSummary {
        name: string;
        fileCount: number;
        sectionCount: number;
        componentCount: number;
        zipBytes: number;
        files: GeneratedFile[];
        /** The compiler diagnostics (counts + validation warnings/errors). */
        diagnostics?: {
            nodes: number;
            components: number;
            componentsFromMasters: number;
            componentsFromCode: number;
            componentsSynthesized: number;
            instances: number;
            assetsDiscovered: number;
            uniqueAssets: number;
            warnings: Array<{ stage: string; path?: string; message: string }>;
            errors: Array<{ stage: string; path?: string; message: string }>;
        };
        /**
         * The live SDK key dump captured during this export run (framer mode
         * only). Diagnostic — never shipped inside the project.
         */
        sdkProbe?: SdkKeyDump;
    }

interface PluginState {
    /** How the plugin is running. */
    mode: PluginMode;
    /** The live Framer engine connection (framer mode only). */
    api: FramerApi | null;
    /** The Framer document being exported (real or mock). */
    document: FramerDocument | null;
    /** The export lifecycle state. */
    status: ExportStatus;
    /** Whether a manual refresh (rescan the Framer project) is in progress. */
    isRefreshing: boolean;
    /** The last export error message. */
    error: string | null;
    /** The last successful export summary. */
    summary: ExportSummary | null;
    /** The export options. */
    options: ExportOptions;

    setMode(mode: PluginMode): void;
    setApi(api: FramerApi | null): void;
    setDocument(document: FramerDocument | null): void;
    setStatus(status: ExportStatus): void;
    setRefreshing(isRefreshing: boolean): void;
    setError(error: string | null): void;
    setSummary(summary: ExportSummary | null): void;
    setOptions(options: Partial<ExportOptions>): void;
    resetExport(): void;
}

/** The default export options. */
export const DEFAULT_OPTIONS: ExportOptions = {
    projectName: '',
    animations: true,
    format: true,
};

export const usePluginStore = create<PluginState>((set) => ({
    mode: 'loading',
    api: null,
    document: null,
    status: 'idle',
    isRefreshing: false,
    error: null,
    summary: null,
    options: { ...DEFAULT_OPTIONS },

    setMode: (mode) => set({ mode }),
    setApi: (api) => set({ api }),
    setDocument: (document) => set({ document }),
    setStatus: (status) => set({ status }),
    setRefreshing: (isRefreshing) => set({ isRefreshing }),
    setError: (error) => set({ error }),
    setSummary: (summary) => set({ summary }),
    setOptions: (options) => set((state) => ({ options: { ...state.options, ...options } })),
    resetExport: () => set({ status: 'idle', error: null, summary: null }),
}));
