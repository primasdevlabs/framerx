/**
 * Design AST section → React section component generation.
 */

import type { DesignNode } from '@framer/compiler-ast';
import { sanitizeComponentName } from '@framer/compiler-shared';

import { generateComponent, type ComponentOptions } from './component';

/** The options for generating a section component. */
export interface SectionOptions extends ComponentOptions {
    /** The deduplicated output name (defaults to the sanitized node name). */
    sectionName?: string;
}

/** Generate a React section component for a node. */
export function generateSection(node: DesignNode, options: SectionOptions = {}): ReturnType<typeof generateComponent> {
    const sectionName = options.sectionName ?? sanitizeComponentName(node.name);
    const component = generateComponent(node, {
        ...options,
        componentName: sectionName,
        importPrefix: '../components/',
    });

    return {
        ...component,
        path: `src/sections/${sectionName}.tsx`,
    };
}
