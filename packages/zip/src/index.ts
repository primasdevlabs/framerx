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

/**
 * The archive date for every entry.
 *
 * Deterministic output requires deterministic metadata: a fixed epoch date
 * means the same document always produces byte-identical ZIPs.
 */
const DETERMINISTIC_ZIP_DATE = new Date(0);

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
    const date = options.date ?? DETERMINISTIC_ZIP_DATE;

    // JSZip creates parent directory entries implicitly with the CURRENT time
    // — that would make the archive non-deterministic. Create every directory
    // explicitly with the fixed date first, so no implicit entry is added.
    const directories = new Set<string>();
    for (const file of files) {
        const parts = file.path.split('/');
        for (let i = 1; i < parts.length; i += 1) {
            directories.add(parts.slice(0, i).join('/') + '/');
        }
    }
    for (const directory of [...directories].sort()) {
        zip.file(directory, null, { date, dir: true });
    }

    for (const file of files) {
        if (file.binary && file.data) {
            zip.file(file.path, file.data, { date });
        } else {
            zip.file(file.path, file.content, { date });
        }
    }

    return zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: options.compressionLevel ?? 9 },
    });
}

/** Create a ZIP archive from a record of path → content. */
export async function createZipFromRecord(files: Record<string, string>): Promise<Uint8Array> {
    return createZip(
        Object.entries(files).map(([path, content]) => ({ path, content })),
    );
}
