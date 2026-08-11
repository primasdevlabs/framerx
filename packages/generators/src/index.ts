/**
 * @framer/compiler-generators — Design AST → generated project files.
 */

import type { DesignDocument, DesignNode } from '@framer/compiler-ast';
import { DEFAULT_PROJECT_NAME, sanitizeComponentName } from '@framer/compiler-shared';

import { buildAssetRegistry, registryToVirtualFiles } from './assets/registry';
import { buildFontRegistry, fontRegistryToVirtualFiles } from './fonts/registry';
import { buildComponentDefinitions, definitionById } from './components/model';
import { generateResponsiveCss } from './responsive/css';
import { generateApp, generateIndexCss, generateIndexHtml, generateMainEntry, generateViteEnv } from './react/app';
import { adaptModuleSource, codeFilePath, collectCodeBareImports, generateCodeFile, generateFramerShim, generateModuleDeclaration, isBuiltinImport, resolveBareImportVersion } from './react/code';
import { generateComponent } from './react/component';
import { generateSection } from './react/section';
import { generateTailwindConfig } from './tailwind/config';
import { extractTokens, generateTokensModule } from './tailwind/tokens';
import { generateEslintConfig, generateGitignore, generatePostcssConfig, generatePrettierConfig, generateReadme, generateTsConfig, generateViteConfig } from './package/config';
import { generatePackageJson } from './package/package-json';
import type { ComponentDefinition } from '@framer/compiler-ast';
import type { GeneratedProject, GeneratorOptions, VirtualFile } from './types';

export * from './types';
export * from './components';
export * from './tailwind';
export * from './motion';
export * from './react';
export * from './package';
export * from './assets';
export * from './fonts';
export * from './responsive';
export * from './manifest';

/**
 * Assign unique names to a list of base names (first occurrence keeps the
 * base; collisions get deterministic `-2`, `-3` suffixes). Used for section
 * and component file names so the project never contains duplicate output
 * paths or duplicate imports.
 */
export function assignUniqueNames(bases: string[]): string[] {
    const used = new Map<string, number>();
    return bases.map((base) => {
        const count = used.get(base) ?? 0;
        used.set(base, count + 1);
        return count === 0 ? base : `${base}${count + 1}`;
    });
}

/**
 * Assign a unique output name to every component in the document
 * (original component name → deduplicated name), in deterministic
 * first-seen order.
 */
export function assignComponentNames(nodes: DesignNode[]): Map<string, string> {
    const assignments = new Map<string, string>();
    const used = new Map<string, number>();
    const visit = (node: DesignNode): void => {
        if (node.type === 'component') {
            const original = node.componentName;
            if (!assignments.has(original)) {
                const base = sanitizeComponentName(original);
                const count = used.get(base) ?? 0;
                used.set(base, count + 1);
                assignments.set(original, count === 0 ? base : `${base}${count + 1}`);
            }
            if (node.template) visit(node.template);
        }
        for (const child of node.children) {
            visit(child);
        }
        if (node.type === 'component' && node.slots) {
            for (const slotNodes of Object.values(node.slots)) {
                for (const slotNode of slotNodes) visit(slotNode);
            }
        }
    };
    for (const root of nodes) {
        visit(root);
    }
    return assignments;
}

/** Generate a complete project from a DesignDocument. */
export function generateProject(document: DesignDocument, options: GeneratorOptions = { projectName: DEFAULT_PROJECT_NAME }): GeneratedProject {
    const projectName = sanitizeComponentName(options.projectName || document.name || DEFAULT_PROJECT_NAME);
    const files: VirtualFile[] = [];
    const componentNames = new Set<string>();
    const generatedNodes: DesignNode[] = [];

    // ── Asset registry FIRST ───────────────────────────────────────────────
    // Asset paths are a single source of truth: code generation resolves every
    // image reference through the registry, so a generated import can never
    // point at a file the project does not contain.
    const assetRegistry = buildAssetRegistry(document);
    const assetPaths = assetRegistry.pathBySrc;

    const fontRegistry = buildFontRegistry(document);

    // ── Definition/instance separation FIRST ──────────────────────────────
    // One implementation file per component definition; instances render as
    // `<Name {...props}>{slotContent}</Name>` references. The model is a
    // single source of truth: `document.components` when the separation pass
    // populated it, otherwise derived deterministically from the instances.
    // Built before the config files so code-component dependencies can feed
    // the generated package.json.
    const definitions = buildComponentDefinitions(document);
    const componentById = definitionById(definitions);
    // Legacy fallback map (original name → unique output name) for documents
    // that predate the definition model.
    const componentNameMap = assignComponentNames(document.nodes);
    // Semantic warnings raised during generation (slot placements etc.),
    // merged into the validation report by the compiler.
    const warnings: import('./types').GenerationWarning[] = [];
    warnings.push(...fontRegistry.warnings);
    const codeDefinitions = definitions.filter((definition) => definition.code);
    // Definition name → code import info: code components live in their own
    // files (not src/components) and may be default exports.
    const codeImports = new Map(
        codeDefinitions.map((definition) => [
            definition.name,
            {
                spec: importSpecFor(definition),
                isDefault: definition.code!.isDefaultExport,
            },
        ]),
    );
    // Every code file to emit: each component's own file + the transitive
    // relative-import closure (deduplicated by path, deterministic order).
    const codeFiles = new Map<string, VirtualFile>();
    for (const definition of codeDefinitions) {
        codeFiles.set(codeFilePath(definition.code!), generateCodeFile(definition));
        const isModule = definition.code!.isModule ?? false;
        for (const dependency of definition.code!.dependencies ?? []) {
            const path = `src/${dependency.path}`;
            if (!codeFiles.has(path)) {
                // Module dependencies need the same `framer` → `./framer`
                // adaptation as their entry (they live flat in src/code/).
                const content = isModule ? adaptModuleSource(dependency.source) : `${dependency.source.trim()}\n`;
                codeFiles.set(path, { path, content });
            }
        }
    }
    // The bare imports across every emitted code file become package deps.
    const codeSources = [...codeFiles.values()].map((file) => ({ source: file.content }));
    const extraDependencies: Record<string, string> = {};
    const unknownDeps = new Set<string>();
    for (const spec of collectCodeBareImports(codeSources)) {
        if (isBuiltinImport(spec)) continue;
        const version = resolveBareImportVersion(spec);
        if (version) {
            extraDependencies[spec] = version;
        } else {
            // Unknown bare import: declared as '*' (latest) and reported so
            // the user can pin it — never a silently unresolvable module.
            extraDependencies[spec] = '*';
            unknownDeps.add(spec);
        }
    }
    if (unknownDeps.size > 0) {
        warnings.push({
            stage: 'components',
            message: `Code components import unknown dependencies (${[...unknownDeps].join(', ')}) — added to package.json with '*' version ranges; pin them to the versions your Framer project uses.`,
        });
    }
    for (const definition of codeDefinitions) {
        // Module bundles import the 'framer' runtime by design — the generator
        // rewrites those imports to the emitted shim, so no warning.
        if (definition.code!.isModule) continue;
        const source = definition.code!.source;
        if (/from\s*['"]framer['"]/.test(source)) {
            warnings.push({
                stage: 'components',
                message: `Component ${definition.name}: the source imports the 'framer' runtime (beyond addPropertyControls, which is stripped) — that module does not exist outside Framer; the generated file may not compile until the import is replaced.`,
            });
        }
    }

    // Configuration files
    files.push(generatePackageJson(projectName, extraDependencies));
    files.push(generateTsConfig());
    files.push(generateViteConfig());
    files.push(generatePostcssConfig());
    files.push(generateEslintConfig());
    files.push(generatePrettierConfig());
    files.push(generateReadme(projectName));
    files.push(generateGitignore());
    files.push(generateIndexHtml(projectName));
    files.push(generateViteEnv());
    if (fontRegistry.css) {
        files.push({ path: 'src/styles/fonts.css', content: fontRegistry.css });
    }

    // Sections from root nodes, with unique output names so two roots that
    // sanitize to the same name never collide in the ZIP or in App.tsx.
    const sectionNames = assignUniqueNames(document.nodes.map((node) => sanitizeComponentName(node.name)));

    // Responsive styles: emitted only when the document actually defines
    // responsive behavior (media queries at the document's own breakpoints).
    const responsiveCss = generateResponsiveCss(document, assetPaths);

    // The document's breakpoint thresholds (name → min-width), threaded into
    // the section/component generators so responsive image swaps emit
    // `<source media>` per tier at the document's own widths.
    const breakpoints = new Map(document.breakpoints.map((bp) => [bp.name, bp.minWidth]));
    const hasResponsive = responsiveCss.content.includes('@media');
    if (hasResponsive) files.push(responsiveCss);

    // App entry files
    files.push(generateApp(document, sectionNames));
    files.push(generateMainEntry(hasResponsive, fontRegistry.css.length > 0));
    files.push(generateIndexCss());

    // Design tokens (colors/radii/spacing) — shared by the theme config and
    // the class generator so emitted classes always resolve.
    const tokens = options.tokens ?? extractTokens(document);

    // Tailwind config
    files.push(generateTailwindConfig(document, tokens));

    // Design tokens module (referenced by instance color props)
    files.push(generateTokensModule(tokens));

    document.nodes.forEach((node, index) => {
        const section = generateSection(node, {
            animations: options.animations,
            tokens,
            assetPaths,
            breakpoints,
            componentNameMap,
            componentById,
            codeImports,
            warnings,
            sectionName: sectionNames[index],
        });
        files.push(section);
    });

    for (const definition of definitions) {
        // A synthesized body is the honest-limit fallback: the source exposed
        // no master and no extraction template, so slot positions/content were
        // derived from instance data. Reported as a warning — never silently
        // approximated.
        if (definition.bodySource === 'synthesized') {
            warnings.push({
                stage: 'components',
                message: `Component ${definition.name}: the source exposed no master body — the implementation was synthesized from instance props, so slot positions and content are approximate.`,
            });
        }
        if (componentNames.has(definition.name)) continue;
        componentNames.add(definition.name);

        // Code components emit their REAL source verbatim — the true
        // implementation, never a synthesized approximation. The file (and
        // its relative-import closure) is emitted together at the end.
        if (definition.code) {
            generatedNodes.push(definition.body);
            continue;
        }

        files.push(generateComponent(definition.body, {
            animations: options.animations,
            tokens,
            assetPaths,
            breakpoints,
            componentNameMap,
            componentById,
            codeImports,
            warnings,
            componentName: definition.name,
            definition,
        }));
        generatedNodes.push(definition.body);
    }

    // Code-file dependencies (the relative-import closure) — emitted so every
    // module the code imports resolves inside the project. Module bundles also
    // get the Framer runtime shim (once) and a type declaration per entry
    // (tsconfig compiles only TS/TSX, so the .js bundle needs a .d.ts for the
    // import to type-check while Vite bundles the real implementation).
    if (codeDefinitions.some((definition) => definition.code!.isModule)) {
        files.push(generateFramerShim());
    }
    for (const definition of codeDefinitions) {
        const declaration = generateModuleDeclaration(definition);
        if (declaration) files.push(declaration);
    }
    files.push(...codeFiles.values());

    // Assets — written from the registries so every reference resolves.
    files.push(...registryToVirtualFiles(assetRegistry.files));
    files.push(...fontRegistryToVirtualFiles(fontRegistry));

    return {
        name: projectName,
        files,
        nodes: [...document.nodes, ...generatedNodes],
        warnings,
    };
}

/** The import specifier generated files use to reference a code component. */
function importSpecFor(definition: ComponentDefinition): string {
    const path = definition.code!.path.replace(/^\/+/, '').replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
    // Generated files live one level under src/ (src/components, src/sections);
    // code files preserve their project path under src/.
    return `../${path}`;
}

/** Find a file in a generated project by path. */
export function findFile(project: GeneratedProject, path: string): VirtualFile | undefined {
    return project.files.find((file) => file.path === path);
}