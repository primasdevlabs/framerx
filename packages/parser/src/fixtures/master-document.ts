/**
 * A master-backed mock document — the golden fixture for definition/instance
 * separation.
 *
 * Exercises the full master pipeline:
 *   - component masters (real definition bodies) attached to instances
 *   - named slot placeholders at their TRUE positions inside the master
 *   - slot placeholders with DEFAULT content (shown when no content is passed)
 *   - per-slot props (the placeholder's controls) surviving into the model
 *   - a nested master (a Button inside the Card master's slot default content)
 *   - multiple instances of one component sharing the same master body
 */

import type { FramerDocument, FramerNode } from '../types';

/** A shared Button master — the definition body for every Button instance. */
const buttonMaster: FramerNode = {
    id: 'master_button',
    type: 'Frame',
    name: 'Button Master',
    frame: { x: 0, y: 0, width: 120, height: 40 },
    layout: {
        strategy: 'flex',
        direction: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: { top: 10, right: 20, bottom: 10, left: 20 },
        sizing: { widthMode: 'hug', heightMode: 'fixed' },
    },
    style: {
        fills: [{ type: 'solid', color: '#6366f1', visible: true }],
        radius: 8,
    },
    children: [
        {
            id: 'master_button_text',
            type: 'Text',
            name: 'Button Label',
            frame: { x: 20, y: 10, width: 80, height: 20 },
            layout: { strategy: 'auto' },
            style: {},
            text: {
                text: 'Action',
                style: { fontFamily: 'Inter', fontSize: 14, fontWeight: 600, color: '#ffffff' },
            },
            children: [],
        },
    ],
};

/**
 * A Card master: title → Icon slot (default content = a Button instance,
 * per-slot props) → Content slot (default text) → footer. The slot
 * placeholders sit BETWEEN real nodes so the generated body proves their
 * positions came from the master, never an appended end.
 */
const cardMaster: FramerNode = {
    id: 'master_card',
    type: 'Frame',
    name: 'Card Master',
    frame: { x: 0, y: 0, width: 320, height: 260 },
    layout: {
        strategy: 'flex',
        direction: 'column',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        gap: 12,
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
        sizing: { widthMode: 'fixed', heightMode: 'fixed' },
    },
    style: {
        fills: [{ type: 'solid', color: '#ffffff', visible: true }],
        radius: 16,
    },
    children: [
        {
            id: 'master_card_title',
            type: 'Text',
            name: 'Card Title',
            frame: { x: 24, y: 24, width: 200, height: 24 },
            layout: { strategy: 'auto' },
            style: {},
            text: {
                text: 'Card Title',
                style: { fontFamily: 'Inter', fontSize: 18, fontWeight: 700, color: '#0f172a' },
            },
            children: [],
        },
        {
            id: 'master_icon_slot',
            type: 'Slot',
            name: 'Icon',
            frame: { x: 24, y: 56, width: 120, height: 40 },
            layout: { strategy: 'auto' },
            style: {},
            // Per-slot props: the placeholder's controls describe its default
            // content — preserved so nothing the SDK exposes is dropped.
            props: { size: 'md' },
            // Default content: a Button instance (nested master resolution).
            children: [
                {
                    id: 'master_icon_default',
                    type: 'Component',
                    name: 'Button',
                    frame: { x: 24, y: 56, width: 120, height: 40 },
                    layout: { strategy: 'auto' },
                    style: {},
                    component: {
                        id: 'component_button',
                        name: 'Button',
                        props: { size: 'md' },
                    },
                    children: [],
                },
            ],
        },
        {
            id: 'master_content_slot',
            type: 'Slot',
            name: 'Content',
            frame: { x: 24, y: 108, width: 272, height: 48 },
            layout: { strategy: 'auto' },
            style: {},
            // Default content: a plain text placeholder.
            children: [
                {
                    id: 'master_content_default',
                    type: 'Text',
                    name: 'Body',
                    frame: { x: 24, y: 108, width: 272, height: 48 },
                    layout: { strategy: 'auto' },
                    style: {},
                    text: {
                        text: 'Default card body',
                        style: { fontFamily: 'Inter', fontSize: 16, lineHeight: 1.5, color: '#334155' },
                    },
                    children: [],
                },
            ],
        },
        {
            id: 'master_card_footer',
            type: 'Text',
            name: 'Card Footer',
            frame: { x: 24, y: 180, width: 200, height: 20 },
            layout: { strategy: 'auto' },
            style: {},
            text: {
                text: 'Card Footer',
                style: { fontFamily: 'Inter', fontSize: 14, fontWeight: 600, color: '#64748b' },
            },
            children: [],
        },
    ],
};

/** A Card instance passing named slot content (Icon + Content). */
const cardOne: FramerNode = {
    id: 'card_1',
    type: 'Component',
    name: 'Card',
    frame: { x: 80, y: 80, width: 320, height: 260 },
    layout: { strategy: 'auto' },
    style: {},
    component: {
        id: 'component_card',
        name: 'Card',
        master: cardMaster,
        slots: {
            Icon: [
                {
                    id: 'card_1_icon',
                    type: 'Vector',
                    name: 'Star Icon',
                    frame: { x: 0, y: 0, width: 24, height: 24 },
                    layout: { strategy: 'auto' },
                    style: {},
                    vector: { svg: '<svg viewBox="0 0 24 24"><path d="M12 2l3 7 7 .9-5 4.9 1.5 7L12 18l-6.5 3.8L7 14.8 2 9.9 9 9z" fill="#f59e0b"/></svg>' },
                    children: [],
                },
            ],
            Content: [
                {
                    id: 'card_1_body',
                    type: 'Text',
                    name: 'Body',
                    frame: { x: 0, y: 0, width: 272, height: 48 },
                    layout: { strategy: 'auto' },
                    style: {},
                    text: {
                        text: 'Custom body one',
                        style: { fontFamily: 'Inter', fontSize: 16, color: '#334155' },
                    },
                    children: [],
                },
            ],
        },
    },
    children: [],
};

/** A Card instance passing only the Content slot (Icon falls back to default). */
const cardTwo: FramerNode = {
    id: 'card_2',
    type: 'Component',
    name: 'Card',
    frame: { x: 424, y: 80, width: 320, height: 260 },
    layout: { strategy: 'auto' },
    style: {},
    component: {
        id: 'component_card',
        name: 'Card',
        master: cardMaster,
        slots: {
            Content: [
                {
                    id: 'card_2_body',
                    type: 'Text',
                    name: 'Body',
                    frame: { x: 0, y: 0, width: 272, height: 48 },
                    layout: { strategy: 'auto' },
                    style: {},
                    text: {
                        text: 'Custom body two',
                        style: { fontFamily: 'Inter', fontSize: 16, color: '#334155' },
                    },
                    children: [],
                },
            ],
        },
    },
    children: [],
};

/** A standalone Button instance (nested master resolution at section level). */
const buttonInstance: FramerNode = {
    id: 'button_1',
    type: 'Component',
    name: 'Button',
    frame: { x: 768, y: 80, width: 120, height: 40 },
    layout: { strategy: 'auto' },
    style: {},
    component: {
        id: 'component_button',
        name: 'Button',
        master: buttonMaster,
    },
    children: [],
};

/** The golden master-backed document. */
export const masterBackedDocument: FramerDocument = {
    id: 'doc_master_golden',
    name: 'Master Golden',
    version: '1.0.0',
    nodes: [
        {
            id: 'frame_cards_golden',
            type: 'Frame',
            name: 'Card Grid Section',
            frame: { x: 0, y: 0, width: 1440, height: 400 },
            layout: {
                strategy: 'flex',
                direction: 'row',
                alignItems: 'stretch',
                justifyContent: 'space-between',
                gap: 24,
                padding: { top: 80, right: 80, bottom: 80, left: 80 },
                sizing: { widthMode: 'fill', heightMode: 'fixed' },
            },
            style: {
                fills: [{ type: 'solid', color: '#f8fafc', visible: true }],
            },
            children: [cardOne, cardTwo, buttonInstance],
        },
    ],
    metadata: {
        platform: 'framer',
    },
};
