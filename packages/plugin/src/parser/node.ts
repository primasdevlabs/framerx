/**
 * Framer SDK node → FramerNode mapping.
 *
 * This is the Framer-specific half of the pipeline: it converts SDK design
 * objects into the platform-neutral FramerDocument shape consumed by the
 * @framer/compiler-parser package.
 */

import type { FramerInteraction, FramerNode } from '@framer/compiler-parser';

import { parseLayout } from './layout';
import type { SdkNode } from './sdk-types';
import { isSdkComponentNode, isSdkImageNode, isSdkTextNode, isSdkVectorNode } from './sdk-types';
import { parseStyle } from './style';
import { parseText } from './typography';

/** Map an SDK node to its Framer node type string. */
export function classifyNodeType(node: SdkNode): string {
    if (isSdkTextNode(node)) return 'Text';
    if (isSdkVectorNode(node)) return 'Vector';
    if (isSdkComponentNode(node)) return 'Component';
    if (isSdkImageNode(node)) return 'Image';
    return 'Frame';
}

/** Extract scalar props from a component's controls. */
export function extractProps(controls?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!controls) return undefined;
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(controls)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            props[key] = value;
        }
    }
    return Object.keys(props).length > 0 ? props : undefined;
}

/** Build interactions from a node's link attributes. */
function parseInteractions(node: SdkNode): FramerInteraction[] | undefined {
    if (!node.link) return undefined;
    return [
        {
            type: 'link',
            trigger: 'tap',
            url: node.link,
            newTab: node.linkOpenInNewTab ?? false,
        },
    ];
}

/** Get the frame rect of a node, falling back to width/height attributes. */
async function parseFrame(node: SdkNode): Promise<{ x: number; y: number; width: number; height: number }> {
    const rect = await node.getRect();
    if (rect) return rect;
    const toNumber = (value?: string | null): number => {
        const match = value ? /^([\d.]+)px$/.exec(value) : null;
        return match ? Number(match[1]) : 0;
    };
    return {
        x: 0,
        y: 0,
        width: toNumber(node.width),
        height: toNumber(node.height),
    };
}

/** Convert a single SDK node (and its subtree) to a FramerNode. */
export async function parseSdkNode(node: SdkNode): Promise<FramerNode> {
    const base: FramerNode = {
        id: node.id,
        type: classifyNodeType(node),
        name: node.name ?? 'Untitled',
        frame: await parseFrame(node),
        layout: parseLayout(node),
        style: parseStyle(node),
        source: {
            platform: 'framer',
            nodeId: node.id,
            nodeType: node.nodeType,
        },
    };

    const interactions = parseInteractions(node);
    if (interactions) base.interactions = interactions;

    if (isSdkTextNode(node)) {
        base.text = parseText(node);
        base.text.text = (await node.getText?.()) ?? '';
    } else if (isSdkVectorNode(node)) {
        base.vector = { svg: node.svg, name: node.name ?? undefined };
    } else if (isSdkComponentNode(node)) {
        base.component = {
            id: node.componentIdentifier ?? node.id,
            name: node.componentName ?? node.name ?? 'Component',
            props: extractProps(node.controls),
        };
    } else if (isSdkImageNode(node)) {
        base.image = {
            src: node.backgroundImage?.url ?? '',
            alt: node.backgroundImage?.altText,
            name: node.name ?? undefined,
        };
    }

    const children = await node.getChildren();
    if (children.length > 0) {
        base.children = await Promise.all(children.map(parseSdkNode));
    }

    return base;
}
