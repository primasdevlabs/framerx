/**
 * The exporter.
 *
 * Runs the compiler pipeline on a Framer document and delivers the resulting
 * project ZIP to the user. Everything runs locally inside the plugin — no
 * backend, no uploads.
 */

import { compileFramerDocument, type CompileResult } from '@framer/compiler';
import type { FramerDocument } from '@framer/compiler-parser';

import { type ExportOptions, validateDocument } from './schemas';

/** Compile a Framer document into a project + ZIP (no download). */
export async function compileProject(document: FramerDocument, options: ExportOptions = {}): Promise<CompileResult> {
    validateDocument(document);
    return compileFramerDocument(document, {
        projectName: options.projectName,
        animations: options.animations ?? true,
        format: options.format ?? true,
        zip: true,
    });
}

/** Trigger a browser download of the given bytes. */
export function triggerDownload(bytes: Uint8Array, fileName: string, mimeType = 'application/zip'): void {
    const blob = new Blob([bytes as BlobPart], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Allow the download to start before revoking the URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Compile a document and download the resulting ZIP. */
export async function exportProject(document: FramerDocument, options: ExportOptions = {}): Promise<CompileResult> {
    const result = await compileProject(document, options);
    if (result.zip) {
        triggerDownload(result.zip, `${result.name}.zip`);
    }
    return result;
}
