/**
 * Formatting utilities for the plugin UI.
 */

/** Format a byte count as a human-readable string. */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 'B';
    for (const next of units) {
        if (value < 1024) break;
        value /= 1024;
        unit = next;
    }
    return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

/** Count the nodes of a document tree. */
export function countNodes(nodes: Array<{ children?: unknown[] }>): number {
    let count = 0;
    const visit = (nodeList: Array<{ children?: unknown[] }>): void => {
        for (const node of nodeList) {
            count += 1;
            if (node.children && node.children.length > 0) {
                visit(node.children as Array<{ children?: unknown[] }>);
            }
        }
    };
    visit(nodes);
    return count;
}

/** Count image-bearing nodes in a document tree. */
export function countImages(nodes: Array<{ type?: string; image?: { src?: string } | null; children?: unknown[] }>): number {
    let count = 0;
    const visit = (nodeList: typeof nodes): void => {
        for (const node of nodeList) {
            if (node.type === 'Image' && node.image?.src) count += 1;
            if (node.children && node.children.length > 0) {
                visit(node.children as typeof nodes);
            }
        }
    };
    visit(nodes);
    return count;
}

/** Collect the unique font families used in a document tree. */
export function uniqueFontFamilies(nodes: Array<{ type?: string; text?: { style?: { fontFamily?: string } } | null; children?: unknown[] }>): string[] {
    const families = new Set<string>();
    const visit = (nodeList: typeof nodes): void => {
        for (const node of nodeList) {
            if (node.type === 'Text' && node.text?.style?.fontFamily) {
                families.add(node.text.style.fontFamily);
            }
            if (node.children && node.children.length > 0) {
                visit(node.children as typeof nodes);
            }
        }
    };
    visit(nodes);
    return Array.from(families);
}

/** Group file paths by their top-level directory for the file tree. */
export function groupByDirectory(files: Array<{ path: string }>): Array<{ directory: string; files: string[] }> {
    const groups = new Map<string, string[]>();
    for (const file of files) {
        const parts = file.path.split('/');
        const directory = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
        const existing = groups.get(directory);
        if (existing) existing.push(parts[parts.length - 1]);
        else groups.set(directory, [parts[parts.length - 1]]);
    }
    return Array.from(groups.entries()).map(([directory, names]) => ({
        directory,
        files: names.sort(),
    }));
}
