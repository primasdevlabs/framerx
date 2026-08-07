/**
 * Design AST section → React section component generation.
 */

import type { DesignNode } from '@framer/compiler-ast';
import { sanitizeComponentName } from '@framer/compiler-shared';

import type { DesignTokens } from '../tailwind/tokens';

import { generateComponent } from './component';

/** Generate a React section component for a node. */
export function generateSection(node: DesignNode, options: { animations?: boolean; tokens?: DesignTokens } = {}): ReturnType<typeof generateComponent> {
    const sectionName = sanitizeComponentName(node.name);
    const component = generateComponent(node, { ...options, importPrefix: '../components/' });

    return {
        ...component,
        path: `src/sections/${sectionName}.tsx`,
    };
}