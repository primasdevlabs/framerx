/**
 * String manipulation utilities for code generation.
 */

/** Convert a string to camelCase. */
export function toCamelCase(input: string): string {
    const cleaned = input.replace(/[^a-zA-Z0-9]+(.)/g, (_, char: string) => char.toUpperCase());
    return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}

/** Convert a string to PascalCase. */
export function toPascalCase(input: string): string {
    const cleaned = input.replace(/[^a-zA-Z0-9]+(.)/g, (_, char: string) => char.toUpperCase());
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Convert a string to kebab-case. */
export function toKebabCase(input: string): string {
    return input
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

/** Convert a string to snake_case. */
export function toSnakeCase(input: string): string {
    return toKebabCase(input).replace(/-/g, '_');
}

/** Sanitize a string for use as a file name (no path separators or invalid chars). */
export function sanitizeFileName(input: string): string {
    return input
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** Sanitize a string for use as a React component name. */
export function sanitizeComponentName(input: string): string {
    const pascal = toPascalCase(input);
    if (!pascal) return 'Component';
    if (/^[0-9]/.test(pascal)) return `Component${pascal}`;
    return pascal;
}

/** Sanitize a string for use as a CSS class name. */
export function sanitizeClassName(input: string): string {
    const kebab = toKebabCase(input);
    if (!kebab) return 'class';
    if (/^[0-9]/.test(kebab)) return `c-${kebab}`;
    return kebab;
}

/** Truncate a string to a maximum length, preserving whole words. */
export function truncate(input: string, maxLength: number): string {
    if (input.length <= maxLength) return input;
    const truncated = input.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    return `${truncated.slice(0, lastSpace > 0 ? lastSpace : maxLength)}...`;
}

/** Check if a string is empty or whitespace-only. */
export function isBlank(input: string): boolean {
    return input.trim().length === 0;
}

/** Escape a string for safe inclusion in a single-quoted JS string literal. */
export function escapeSingleQuotes(input: string): string {
    return input.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

/** Escape a string for safe inclusion in a double-quoted JS string literal. */
export function escapeDoubleQuotes(input: string): string {
    return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** Escape a string for safe inclusion in a JSX text node. */
export function escapeJsxText(input: string): string {
    const amp = '\u0026';
    return input
        .replace(/&/g, `${amp}amp;`)
        .replace(/</g, `${amp}lt;`)
        .replace(/>/g, `${amp}gt;`)
        .replace(/\{/g, `${amp}#123;`)
        .replace(/\}/g, `${amp}#125;`);
}

/** Convert a string to a valid TypeScript identifier. */
export function toIdentifier(input: string): string {
    const camel = toCamelCase(input);
    if (!camel) return 'value';
    if (/^[0-9]/.test(camel)) return `_${camel}`;
    return camel;
}

/** Convert a string to a valid variable name, ensuring it's not a reserved word. */
export function toVariableName(input: string): string {
    const identifier = toIdentifier(input);
    const reserved = new Set([
        'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
        'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
        'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
        'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
        'as', 'implements', 'interface', 'let', 'package', 'private', 'protected', 'public',
        'static', 'yield', 'any', 'boolean', 'constructor', 'declare', 'get', 'module',
        'require', 'number', 'set', 'string', 'symbol', 'type', 'from', 'of',
    ]);
    if (reserved.has(identifier)) return `${identifier}Value`;
    return identifier;
}