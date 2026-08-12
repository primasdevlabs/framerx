/**
 * @framer/compiler-formatter — Format generated project files with Prettier.
 *
 * Stage 5 of the compiler pipeline: after generation, every text file is
 * formatted with Prettier so the output looks hand-written.
 *
 * Uses `prettier/standalone` with bundled plugins so the same code runs in
 * Node (CLI, tests) and in the browser (the Framer plugin), where the Node
 * entry would be unbundlable.
 *
 * The formatter is intentionally decoupled from the generators: it operates on
 * structural file objects ({ path, content, binary?, data? }) so it can be
 * reused by any generator or tool without importing generator types.
 */

import { format } from 'prettier/standalone';
import * as babelPlugin from 'prettier/plugins/babel';
import * as estreePlugin from 'prettier/plugins/estree';
import * as htmlPlugin from 'prettier/plugins/html';
import * as typescriptPlugin from 'prettier/plugins/typescript';
import * as markdownPlugin from 'prettier/plugins/markdown';
import * as postcssPlugin from 'prettier/plugins/postcss';
import * as yamlPlugin from 'prettier/plugins/yaml';
import type { Plugin } from 'prettier';

/** A file that can be formatted. Structurally compatible with VirtualFile. */
export interface FormattableFile {
    /** The relative path of the file within the project. */
    path: string;
    /** The text content of the file. */
    content: string;
    /** Whether the file is binary (for assets). */
    binary?: boolean;
    /** The binary data (for assets). */
    data?: Uint8Array;
}

/** The formatter options. */
export interface FormatterOptions {
    /** The Prettier parser to use. Defaults to one inferred from the file path. */
    parser?: string;
    /** The maximum line length. */
    printWidth?: number;
    /** The number of spaces per indentation level. */
    tabWidth?: number;
    /** Whether to print semicolons. */
    semi?: boolean;
    /** Whether to use single quotes. */
    singleQuote?: boolean;
    /** Whether to print trailing commas. */
    trailingComma?: 'all' | 'es5' | 'none';
}

/** A parser configuration: standalone parser name + required plugins. */
interface ParserEntry {
    parser: string;
    plugins: Plugin[];
}

/** The bundled Prettier plugins. */
const PLUGINS = {
    babel: babelPlugin as Plugin,
    estree: estreePlugin as Plugin,
    html: htmlPlugin as Plugin,
    markdown: markdownPlugin as Plugin,
    postcss: postcssPlugin as Plugin,
    typescript: typescriptPlugin as Plugin,
    yaml: yamlPlugin as Plugin,
};

/** Map a file extension to a Prettier parser configuration. */
const PARSERS_BY_EXTENSION: Record<string, ParserEntry> = {
    '.ts': { parser: 'typescript', plugins: [PLUGINS.typescript, PLUGINS.estree] },
    '.tsx': { parser: 'typescript', plugins: [PLUGINS.typescript, PLUGINS.estree] },
    '.mts': { parser: 'typescript', plugins: [PLUGINS.typescript, PLUGINS.estree] },
    '.cts': { parser: 'typescript', plugins: [PLUGINS.typescript, PLUGINS.estree] },
    '.js': { parser: 'babel', plugins: [PLUGINS.babel, PLUGINS.estree] },
    '.jsx': { parser: 'babel', plugins: [PLUGINS.babel, PLUGINS.estree] },
    '.mjs': { parser: 'babel', plugins: [PLUGINS.babel, PLUGINS.estree] },
    '.cjs': { parser: 'babel', plugins: [PLUGINS.babel, PLUGINS.estree] },
    '.json': { parser: 'json', plugins: [PLUGINS.babel, PLUGINS.estree] },
    '.jsonc': { parser: 'json', plugins: [PLUGINS.babel, PLUGINS.estree] },
    '.css': { parser: 'css', plugins: [PLUGINS.postcss] },
    '.html': { parser: 'html', plugins: [PLUGINS.html] },
    '.md': { parser: 'markdown', plugins: [PLUGINS.markdown] },
    '.yml': { parser: 'yaml', plugins: [PLUGINS.yaml] },
    '.yaml': { parser: 'yaml', plugins: [PLUGINS.yaml] },
};

/** Get the Prettier parser name for a file path, or undefined if unsupported. */
export function getParserForPath(path: string): string | undefined {
    const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
    return PARSERS_BY_EXTENSION[extension]?.parser;
}

/** The default Prettier options for generated code. */
const DEFAULT_OPTIONS: FormatterOptions = {
    printWidth: 120,
    tabWidth: 4,
    semi: true,
    singleQuote: true,
    trailingComma: 'all',
};

/** Get the parser config for a path, falling back to babel for custom parsers. */
function getParserEntry(path: string, parserOverride?: string): ParserEntry | undefined {
    const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
    const entry = PARSERS_BY_EXTENSION[extension];
    if (!parserOverride) return entry;
    return { parser: parserOverride, plugins: entry?.plugins ?? [PLUGINS.babel, PLUGINS.estree] };
}

/** Format a single file. Binary files and unsupported types pass through unchanged. */
export async function formatFile(file: FormattableFile, options: FormatterOptions = {}): Promise<FormattableFile> {
    if (file.binary || file.data) return file;

    const entry = getParserEntry(file.path, options.parser);
    if (!entry) return file;

    try {
        const formatted = await format(file.content, {
            parser: entry.parser,
            plugins: entry.plugins,
            ...DEFAULT_OPTIONS,
            ...options,
        });
        // Prettier always ends output with a newline.
        return { ...file, content: formatted.endsWith('\n') ? formatted : `${formatted}\n` };
    } catch {
        // Formatting must never fail the pipeline — fall back to the raw content.
        return file;
    }
}

/** Format a list of files in parallel. */
export async function formatFiles(
    files: FormattableFile[],
    options: FormatterOptions = {},
): Promise<FormattableFile[]> {
    return Promise.all(files.map((file) => formatFile(file, options)));
}

/** Format raw content for a given path, returning the formatted string. */
export async function formatContent(content: string, path: string, options: FormatterOptions = {}): Promise<string> {
    const entry = getParserEntry(path, options.parser);
    if (!entry) return content;
    try {
        return await format(content, { parser: entry.parser, plugins: entry.plugins, ...DEFAULT_OPTIONS, ...options });
    } catch {
        return content;
    }
}

/** A syntax validation issue found in a file. */
export interface SyntaxIssue {
    /** The parser that was attempted. */
    parser: string;
    /** The parser error message. */
    message: string;
}

/**
 * Validate that a file's content parses with its configured parser.
 *
 * The exporter must never ship broken code: every generated text file is
 * parsed with the same Prettier parsers used for formatting, and a parse
 * failure is reported as an export error. Binary files and unsupported
 * extensions pass (empty result).
 */
export async function validateFileSyntax(file: FormattableFile): Promise<SyntaxIssue[]> {
    if (file.binary || file.data) return [];

    const entry = getParserEntry(file.path);
    if (!entry) return [];

    try {
        await format(file.content, {
            parser: entry.parser,
            plugins: entry.plugins,
            ...DEFAULT_OPTIONS,
        });
        return [];
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [{ parser: entry.parser, message }];
    }
}

/** Validate a list of files in parallel. */
export async function validateFilesSyntax(files: FormattableFile[]): Promise<Map<string, SyntaxIssue[]>> {
    const results = await Promise.all(files.map(async (file) => [file.path, await validateFileSyntax(file)] as const));
    return new Map(results);
}
