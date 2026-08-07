/**
 * Framer document extraction.
 *
 * Reads the current Framer document (canvas root → pages → nodes) and
 * converts it into the platform-neutral FramerDocument shape.
 */

import type { FramerDocument, FramerNode } from '@framer/compiler-parser';

import type { FramerApi } from './sdk';
import { parseSdkNode } from './node';
import type { SdkNode } from './sdk-types';

/** Extract the full Framer document from the SDK. */
export async function extractFramerDocument(api: FramerApi): Promise<FramerDocument> {
    const root = await api.getCanvasRoot();
    const pages = await root.getChildren();

    const nodes: FramerNode[] = [];
    for (const page of pages) {
        const children = await page.getChildren();
        for (const child of children) {
            nodes.push(await parseSdkNode(child as unknown as SdkNode));
        }
    }

    return {
        id: root.id,
        name: root.name ?? 'Framer Document',
        version: '1.0.0',
        nodes,
        metadata: {
            platform: 'framer',
            exportedAt: new Date().toISOString(),
        },
    };
}
