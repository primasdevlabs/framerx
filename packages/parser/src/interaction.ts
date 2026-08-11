/** Framer interaction → Design AST interaction normalization. */

import type { Interaction, InteractionState } from '@framer/compiler-ast';

import type { FramerInteraction } from './types';

/** Normalize source interactions into trigger-specific AST buckets. */
export function parseInteractionState(interactions?: FramerInteraction[]): InteractionState | undefined {
    if (!interactions || interactions.length === 0) return undefined;

    const state: InteractionState = {};
    for (const source of interactions) {
        const interaction = parseInteraction(source);
        const bucket = triggerBucket(source.trigger);
        const values = state[bucket] ?? [];
        values.push(interaction);
        state[bucket] = values;
    }

    return Object.keys(state).length > 0 ? state : undefined;
}

/** Convert one source interaction while retaining source-specific values. */
export function parseInteraction(source: FramerInteraction): Interaction {
    if (source.type === 'link' && source.url) {
        return { type: 'link', url: source.url, newTab: source.newTab ?? false };
    }
    if (source.type === 'scroll-to' || source.type === 'scroll') {
        return {
            type: 'scroll-to',
            targetId: source.target ?? '',
            offset: source.offset,
            smooth: source.smooth,
        };
    }
    if (source.type === 'state-change') {
        return {
            type: 'state-change',
            targetId: source.target ?? '',
            state: source.state ?? '',
        };
    }

    // Unknown interaction kinds remain observable as custom interactions. The
    // original fields are kept in payload so a later compiler can support them
    // without another source extraction pass.
    return {
        type: 'custom',
        name: source.name ?? source.type,
        payload: { ...source },
    };
}

function triggerBucket(trigger: string): keyof InteractionState {
    switch (trigger) {
        case 'hover':
        case 'whileHover':
            return 'onHover';
        case 'focus':
        case 'whileFocus':
            return 'onFocus';
        case 'mount':
        case 'animate':
        case 'initial':
            return 'onMount';
        default:
            return 'onClick';
    }
}
