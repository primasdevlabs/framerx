/**
 * SDK key probe — a one-shot diagnostic that dumps the EXACT identifying keys
 * the live engine exposes.
 *
 * When an export synthesizes components, the question is never "is the API
 * down" (that is already diagnosed by the extraction statuses) but "which
 * keys did the instances carry, and which did the masters/code files expose,
 * so nothing matched?". This probe answers that question for one export run:
 *
 *   masters   → getNodesWithType('ComponentNode')           id/name/componentIdentifier/insertURL/componentName
 *   instances → getNodesWithType('ComponentInstanceNode')   id/name/componentIdentifier/insertURL/componentName
 *   codeFiles → getCodeFiles()                              id/name/path + export keys (componentId/insertURL/name)
 *
 * plus a matching analysis: every instance is classified as master-matched,
 * code-matched, or unmatched (with the exact keys it carried and therefore
 * looked up). Every source is read independently — one failing API never
 * throws the probe, it records `ok: false` with the error.
 *
 * The probe is diagnostic only: never shipped inside the exported project.
 */

import type { FramerApi } from './sdk';
import type { SdkNode } from './sdk-types';

/** The identifying keys of one master or instance node. */
export interface SdkKeyRecord {
    id: string;
    name: string | null;
    componentIdentifier?: string | null;
    insertURL?: string | null;
    componentName?: string | null;
}

/** The identifying keys of one code file export. */
export interface CodeFileExportRecord {
    name: string;
    componentId?: string;
    insertURL?: string;
    isDefaultExport: boolean;
    type?: string;
}

/** One code file, with its export keys. */
export interface CodeFileRecord {
    id: string;
    name: string;
    path: string;
    exports: CodeFileExportRecord[];
}

/** How one probe source resolved. */
export interface SdkSourceStatus {
    /** Whether the API surface exposed the method at all. */
    available: boolean;
    /** Whether the call resolved without throwing. */
    ok: boolean;
    /** The failure message when `ok` is false. */
    error?: string;
}

/** The looked-up keys for an unmatched instance. */
export interface UnmatchedLookup {
    instance: SdkKeyRecord;
    lookedUp: {
        componentIdentifier?: string;
        insertURL?: string;
        componentName?: string;
    };
}

/** The full probe report. */
export interface SdkKeyDump {
    sources: {
        masters: SdkSourceStatus;
        instances: SdkSourceStatus;
        codeFiles: SdkSourceStatus;
    };
    masters: SdkKeyRecord[];
    instances: SdkKeyRecord[];
    codeFiles: CodeFileRecord[];
    matching: {
        /** Instances that resolved to a canvas master via any key. */
        masterMatched: number;
        /** Instances that resolved to a code file via any key. */
        codeMatched: number;
        /** Instances that matched neither — with the exact keys looked up. */
        masterUnmatched: UnmatchedLookup[];
        /** Instances that matched a master but no code file (fine when the component is canvas-backed). */
        codeUnmatched: UnmatchedLookup[];
    };
}

/** Read an SdkNode's identifying keys into a plain record. */
function nodeKeys(node: SdkNode): SdkKeyRecord {
    return {
        id: node.id,
        name: node.name ?? null,
        componentIdentifier: node.componentIdentifier ?? null,
        insertURL: node.insertURL ?? null,
        componentName: node.componentName ?? null,
    };
}

/** Run a probe read, converting a failure into a status record instead of a throw. */
async function readSource<T>(
    fn: (() => Promise<T>) | undefined,
): Promise<{ value: T | undefined; status: SdkSourceStatus }> {
    if (typeof fn !== 'function') {
        return { value: undefined, status: { available: false, ok: false } };
    }
    try {
        return { value: await fn(), status: { available: true, ok: true } };
    } catch (error) {
        return {
            value: undefined,
            status: {
                available: true,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            },
        };
    }
}

/**
 * Capture the identifying keys the live engine exposes on masters, instances,
 * and code files, and analyze which instances match. Never throws — every
 * failure is recorded on the corresponding source status.
 */
export async function captureSdkKeys(api: FramerApi): Promise<SdkKeyDump> {
    // `readSource` needs a real undefined when the method is missing — a
    // fallback arrow (`() => Promise.resolve([])`) would look like a present
    // method and mask the availability status.
    const mastersRead = await readSource(
        typeof api.getNodesWithType === 'function' ? () => api.getNodesWithType!('ComponentNode') : undefined,
    );
    const instancesRead = await readSource(
        typeof api.getNodesWithType === 'function' ? () => api.getNodesWithType!('ComponentInstanceNode') : undefined,
    );
    const codeRead = await readSource(typeof api.getCodeFiles === 'function' ? () => api.getCodeFiles!() : undefined);

    const masters = (mastersRead.value ?? []).map(nodeKeys);
    const instances = (instancesRead.value ?? []).map(nodeKeys);
    const codeFiles = (
        (codeRead.value ?? []) as Array<{
            id: string;
            name: string;
            path: string;
            exports?: Array<{
                name?: string;
                componentId?: string;
                insertURL?: string;
                isDefaultExport?: boolean;
                type?: string;
            }>;
        }>
    ).map((file) => ({
        id: file.id,
        name: file.name,
        path: file.path,
        exports: (file.exports ?? []).map((entry) => ({
            name: entry.name ?? '',
            componentId: entry.componentId ?? undefined,
            insertURL: entry.insertURL ?? undefined,
            isDefaultExport: entry.isDefaultExport ?? false,
            type: entry.type ?? undefined,
        })),
    }));

    // ── Master index: identifier + insertURL + componentName (mirrors the
    //    adapter's fetchComponentMasters keys — keep in sync). ─────────────
    const masterByIdentifier = new Map<string, SdkKeyRecord>();
    const masterByName = new Map<string, SdkKeyRecord>();
    for (const master of masters) {
        if (master.componentIdentifier && !masterByIdentifier.has(master.componentIdentifier)) {
            masterByIdentifier.set(master.componentIdentifier, master);
        }
        if (master.insertURL && !masterByIdentifier.has(master.insertURL)) {
            masterByIdentifier.set(master.insertURL, master);
        }
        if (master.componentName && !masterByName.has(master.componentName)) {
            masterByName.set(master.componentName, master);
        }
    }

    // ── Code index: componentId + insertURL + export name (mirrors the
    //    adapter's CodeFileIndex keys — keep in sync). ─────────────────────
    const codeByComponentId = new Map<string, true>();
    const codeByInsertURL = new Map<string, true>();
    const codeByExportName = new Map<string, true>();
    for (const file of codeFiles) {
        for (const entry of file.exports) {
            if (entry.type && entry.type !== 'component') continue;
            if (entry.componentId) codeByComponentId.set(entry.componentId, true);
            if (entry.insertURL) codeByInsertURL.set(entry.insertURL, true);
            if (entry.name) codeByExportName.set(entry.name, true);
        }
    }

    const matching: SdkKeyDump['matching'] = {
        masterMatched: 0,
        codeMatched: 0,
        masterUnmatched: [],
        codeUnmatched: [],
    };
    const recordLookup = (instance: SdkKeyRecord): UnmatchedLookup => ({
        instance,
        lookedUp: {
            componentIdentifier: instance.componentIdentifier ?? undefined,
            insertURL: instance.insertURL ?? undefined,
            componentName: instance.componentName ?? undefined,
        },
    });
    for (const instance of instances) {
        const masterHit =
            (instance.componentIdentifier ? masterByIdentifier.has(instance.componentIdentifier) : false) ||
            (instance.insertURL ? masterByIdentifier.has(instance.insertURL) : false) ||
            (instance.componentName ? masterByName.has(instance.componentName) : false);
        if (masterHit) {
            matching.masterMatched += 1;
        } else {
            matching.masterUnmatched.push(recordLookup(instance));
        }

        const codeHit =
            (instance.componentIdentifier ? codeByComponentId.has(instance.componentIdentifier) : false) ||
            (instance.insertURL ? codeByInsertURL.has(instance.insertURL) : false) ||
            (instance.componentName ? codeByExportName.has(instance.componentName) : false);
        if (codeHit) {
            matching.codeMatched += 1;
        } else {
            matching.codeUnmatched.push(recordLookup(instance));
        }
    }

    return {
        sources: {
            masters: mastersRead.status,
            instances: instancesRead.status,
            codeFiles: codeRead.status,
        },
        masters,
        instances,
        codeFiles,
        matching,
    };
}
