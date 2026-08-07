/**
 * Framer node → Design AST node conversion.
 */

import type { DesignImageNode, DesignNode, DesignNodeType } from '@framer/compiler-ast';
import type { Rect } from '@framer/compiler-shared';
import { generateId } from '@framer/compiler-shared';

import { parseAnimations } from './animation';
import { parseLayout } from './layout';
import { parseStyle } from './style';
import { parseText } from './typography';
import type { FramerNode } from './types';

/** Convert a Framer node to a Design AST node. */
export function parseNode(node: FramerNode): DesignNode {
    const base = {
        id: generateId('node'),
        name: node.name || 'Untitled',
        frame: parseFrame(node.frame),
        layout: parseLayout(node.layout),
        style: parseStyle(node.style),
        constraints: {
            horizontal: 'left' as const,
            vertical: 'top' as const,
        },
        animations: parseAnimations(node.interactions),
        children: (node.children ?? []).map(parseNode),
        metadata: {
            sourceId: node.id,
            sourceType: node.type,
        },
    };

    switch (node.type) {
        case 'Text':
            return {
                ...base,
                type: 'text',
                text: parseText(node.text),
            };
        case 'Image':
            return {
                ...base,
                type: 'image',
                asset: {
                    id: generateId('asset'),
                    type: 'image',
                    src: node.image?.src ?? '',
                    name: node.image?.name,
                    width: node.image?.width,
                    height: node.image?.height,
                    mimeType: node.image?.mimeType,
                    size: node.image?.size,
                    alt: node.image?.alt,
                },
                objectFit: (node.image?.objectFit as DesignImageNode['objectFit']) ?? 'cover',
                objectPosition: node.image?.objectPosition,
            };
        case 'Vector':
        case 'Shape':
            return {
                ...base,
                type: 'vector',
                svg: node.vector?.svg,
                pathData: node.vector?.pathData,
                asset: node.vector?.src
                    ? {
                        id: generateId('asset'),
                        type: 'svg',
                        src: node.vector.src,
                        name: node.vector.name,
                    }
                    : undefined,
            };
        case 'Component':
            return {
                ...base,
                type: 'component',
                componentId: node.component?.id ?? node.id,
                componentName: node.component?.name ?? node.name,
                props: node.component?.props ?? node.props,
                slots: node.component?.slots
                    ? Object.fromEntries(
                        Object.entries(node.component.slots).map(([name, nodes]) => [
                            name,
                            nodes.map(parseNode),
                        ]),
                    )
                    : undefined,
            };
        case 'Slot':
            return {
                ...base,
                type: 'slot',
                slotName: node.name,
            };
        case 'Group':
            return {
                ...base,
                type: 'group',
            };
        case 'Frame':
        default:
            return {
                ...base,
                type: 'frame',
                isSection: node.name.toLowerCase().includes('section'),
                isScrollContainer: node.name.toLowerCase().includes('scroll'),
            };
    }
}

/** Convert a Framer frame to a shared Rect. */
export function parseFrame(frame: FramerNode['frame']): Rect {
    return {
        x: frame.x ?? 0,
        y: frame.y ?? 0,
        width: frame.width ?? 0,
        height: frame.height ?? 0,
    };
}

/** Map a Framer node type to a Design AST node type. */
export function mapNodeType(type: string): DesignNodeType {
    switch (type) {
        case 'Text':
            return 'text';
        case 'Image':
            return 'image';
        case 'Vector':
        case 'Shape':
            return 'vector';
        case 'Component':
            return 'component';
        case 'Slot':
            return 'slot';
        case 'Group':
            return 'group';
        case 'Frame':
        default:
            return 'frame';
    }
}