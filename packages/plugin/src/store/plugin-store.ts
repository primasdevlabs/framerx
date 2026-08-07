/**
 * Zustand store for the plugin UI.
 */

import type { FramerDocument } from '@framer/compiler-parser';
import { create } from 'zustand';

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
export type ExportStatus = 'idle' | 'compiling' | 'ready' | 'error';

/** A summary of a completed export. */
export interface ExportSummary {
    name: string;
    fileCount: number;
    sectionCount: number;
    componentCount: number;
    zipBytes: number;
    files: GeneratedFile[];
}

interface PluginState {
    /** How the plugin is running. */
    mode: PluginMode;
    /** The Framer document being exported (real or mock). */
    document: FramerDocument | null;
    /** The export lifecycle state. */
    status: ExportStatus;
    /** The last export error message. */
    error: string | null;
    /** The last successful export summary. */
    summary: ExportSummary | null;
    /** The export options. */
    options: ExportOptions;

    setMode(mode: PluginMode): void;
    setDocument(document: FramerDocument | null): void;
    setStatus(status: ExportStatus): void;
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
    document: null,
    status: 'idle',
    error: null,
    summary: null,
    options: { ...DEFAULT_OPTIONS },

    setMode: (mode) => set({ mode }),
    setDocument: (document) => set({ document }),
    setStatus: (status) => set({ status }),
    setError: (error) => set({ error }),
    setSummary: (summary) => set({ summary }),
    setOptions: (options) => set((state) => ({ options: { ...state.options, ...options } })),
    resetExport: () => set({ status: 'idle', error: null, summary: null }),
}));
