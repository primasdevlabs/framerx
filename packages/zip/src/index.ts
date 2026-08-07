/**
 * @framer/compiler-zip — Create ZIP archives of generated projects.
 *
 * Stage 6 of the compiler pipeline: bundle the generated project into a single
 * downloadable ZIP. Uses JSZip, which runs in both Node and the browser
 * (the Framer plugin), so the same code serves both environments.
 */

import JSZip from 'jszip';

/** A file that can be zipped. Structurally compatible with VirtualFile. */
export interface ZipFile {
    /** The relative path of the file within the archive. */
    path: string;
    /** The text content of the file. */
    content: string;
    /** Whether the file is binary (for assets). */
    binary?: boolean;
    /** The binary data (for assets). */
    data?: Uint8Array;
}

/** The ZIP creation options. */
export interface ZipOptions {
    /** The compression level (1-9). Defaults to 9. */
    compressionLevel?: number;
    /** Whether to store metadata (modification time) in the archive. */
    date?: Date;
}

/** Create a ZIP archive from a list of project files. */
export async function createZip(files: ZipFile[], options: ZipOptions = {}): Promise<Uint8Array> {
    const zip = new JSZip();

    for (const file of files) {
        if (file.binary && file.data) {
            zip.file(file.path, file.data);
        } else {
            zip.file(file.path, file.content);
        }
    }

    return zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: options.compressionLevel ?? 9 },
        ...(options.date ? { date: options.date } : {}),
    });
}

/** Create a ZIP archive from a record of path → content. */
export async function createZipFromRecord(files: Record<string, string>): Promise<Uint8Array> {
    return createZip(
        Object.entries(files).map(([path, content]) => ({ path, content })),
    );
}
