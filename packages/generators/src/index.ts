/**
 * @framer/compiler-generators — Design AST → generated project files.
 */

import type { DesignComponentNode, DesignDocument, DesignNode } from '@framer/compiler-ast';
import { DEFAULT_PROJECT_NAME, sanitizeComponentName } from '@framer/compiler-shared';

import { generateAssets } from './assets/assets';
import { generateApp, generateIndexCss, generateIndexHtml, generateMainEntry, generateViteEnv } from './react/app';
import { generateComponent } from './react/component';
import { generateSection } from './react/section';
import { generateTailwindConfig } from './tailwind/config';
import { extractTokens, generateTokensModule } from './tailwind/tokens';
import { generateEslintConfig, generateGitignore, generatePostcssConfig, generatePrettierConfig, generateReadme, generateTsConfig, generateViteConfig } from './package/config';
import { generatePackageJson } from './package/package-json';
import type { GeneratedProject, GeneratorOptions, VirtualFile } from './types';

export * from './types';
export * from './tailwind';
export * from './motion';
export * from './react';
export * from './package';
export * from './assets';

/** Generate a complete project from a DesignDocument. */
export function generateProject(document: DesignDocument, options: GeneratorOptions = { projectName: DEFAULT_PROJECT_NAME }): GeneratedProject {
    const projectName = sanitizeComponentName(options.projectName || document.name || DEFAULT_PROJECT_NAME);
    const files: VirtualFile[] = [];
    const componentNames = new Set<string>();
    const generatedNodes: DesignNode[] = [];

    // Configuration files
    files.push(generatePackageJson(projectName));
    files.push(generateTsConfig());
    files.push(generateViteConfig());
    files.push(generatePostcssConfig());
    files.push(generateEslintConfig());
    files.push(generatePrettierConfig());
    files.push(generateReadme(projectName));
    files.push(generateGitignore());
    files.push(generateIndexHtml(projectName));
    files.push(generateViteEnv());

    // App entry files
    files.push(generateApp(document));
    files.push(generateMainEntry());
    files.push(generateIndexCss());

    // Design tokens (colors/radii/spacing) — shared by the theme config and
    // the class generator so emitted classes always resolve.
    const tokens = options.tokens ?? extractTokens(document);

    // Tailwind config
    files.push(generateTailwindConfig(document, tokens));

    // Design tokens module (referenced by instance color props)
    files.push(generateTokensModule(tokens));

    // Sections from root nodes
    for (const node of document.nodes) {
        const section = generateSection(node, { animations: options.animations, tokens });
        files.push(section);

        // Also generate components for nested component nodes
        collectComponentNodes(node).forEach((componentNode) => {
            const name = sanitizeComponentName(componentNode.componentName);
            if (componentNames.has(name)) return;
            componentNames.add(name);
            files.push(generateComponent(componentNode, { animations: options.animations, tokens }));
            generatedNodes.push(componentNode);
        });
    }

    // Assets
    const assetFiles = generateAssets(document);
    files.push(...assetFiles);

    return {
        name: projectName,
        files,
        nodes: [...document.nodes, ...generatedNodes],
    };
}

/** Collect all component nodes from a node tree (including inside templates). */
function collectComponentNodes(node: DesignNode): DesignComponentNode[] {
    const results: DesignComponentNode[] = [];
    const visit = (n: DesignNode): void => {
        if (n.type === 'component') results.push(n);
        // Instances nested inside a template render within the parent
        // component file — they need their own component file too.
        if (n.type === 'component' && n.template) visit(n.template);
        for (const child of n.children) {
            visit(child);
        }
    };
    visit(node);
    return results;
}

/** Find a file in a generated project by path. */
export function findFile(project: GeneratedProject, path: string): VirtualFile | undefined {
    return project.files.find((file) => file.path === path);
}