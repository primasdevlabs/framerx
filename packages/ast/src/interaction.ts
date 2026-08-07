/**
 * Interaction definitions for the Design AST.
 */

/** A link interaction. */
export interface LinkInteraction {
    type: 'link';
    /** The destination URL. */
    url: string;
    /** Whether to open in a new tab. */
    newTab?: boolean;
}

/** A scroll-to interaction. */
export interface ScrollToInteraction {
    type: 'scroll-to';
    /** The target node ID to scroll to. */
    targetId: string;
    /** The scroll offset. */
    offset?: number;
    /** Whether to scroll smoothly. */
    smooth?: boolean;
}

/** A state-change interaction. */
export interface StateChangeInteraction {
    type: 'state-change';
    /** The target component ID. */
    targetId: string;
    /** The state to switch to. */
    state: string;
}

/** A custom interaction. */
export interface CustomInteraction {
    type: 'custom';
    /** The interaction name. */
    name: string;
    /** The interaction payload. */
    payload?: Record<string, unknown>;
}

/** An interaction definition. */
export type Interaction = LinkInteraction | ScrollToInteraction | StateChangeInteraction | CustomInteraction;

/** The interaction state for a node. */
export interface InteractionState {
    /** Interactions triggered on click/tap. */
    onClick?: Interaction[];
    /** Interactions triggered on hover. */
    onHover?: Interaction[];
    /** Interactions triggered on focus. */
    onFocus?: Interaction[];
    /** Interactions triggered on mount. */
    onMount?: Interaction[];
}