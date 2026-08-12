/**
 * Deterministic ID generation utilities.
 */

let counter = 0;

/** Generate a unique ID with an optional prefix. */
export function generateId(prefix = 'node'): string {
    counter += 1;
    return `${prefix}_${counter.toString(36)}_${Date.now().toString(36)}`;
}

/** Generate a deterministic ID from a string (stable hash). */
export function hashId(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
        const char = input.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

/** Generate a deterministic ID with a prefix from a string. */
export function stableId(prefix: string, input: string): string {
    return `${prefix}_${hashId(input)}`;
}

/** Reset the internal counter (useful for tests). */
export function resetIdCounter(): void {
    counter = 0;
}
