/**
 * Animation and interaction definitions for the Design AST.
 */

/** The trigger for an animation. */
export type AnimationTrigger = 'hover' | 'tap' | 'focus' | 'viewport' | 'initial' | 'mount' | 'scroll';

/** The easing function for an animation. */
export type Easing =
    | 'linear'
    | 'ease'
    | 'ease-in'
    | 'ease-out'
    | 'ease-in-out'
    | 'circ-in'
    | 'circ-out'
    | 'circ-in-out'
    | 'back-in'
    | 'back-out'
    | 'back-in-out'
    | 'anticipate'
    | [number, number, number, number];

/** A spring physics configuration. */
export interface SpringConfig {
    type: 'spring';
    stiffness?: number;
    damping?: number;
    mass?: number;
    bounce?: number;
    duration?: number;
    delay?: number;
}

/** A tween animation configuration. */
export interface TweenConfig {
    type: 'tween';
    duration?: number;
    delay?: number;
    ease?: Easing;
    repeat?: number;
    repeatType?: 'loop' | 'reverse' | 'mirror';
    repeatDelay?: number;
}

/** An animation configuration. */
export type AnimationConfig = SpringConfig | TweenConfig;

/** A keyframe value for an animation. */
export interface KeyframeValue {
    /** The value at this keyframe. */
    value: unknown;
    /** The time offset (0-1) for this keyframe. */
    offset?: number;
}

/** The animated properties for a node. */
export interface AnimatedProperties {
    opacity?: number | KeyframeValue[];
    x?: number | string | KeyframeValue[];
    y?: number | string | KeyframeValue[];
    scale?: number | KeyframeValue[];
    scaleX?: number | KeyframeValue[];
    scaleY?: number | KeyframeValue[];
    rotate?: number | KeyframeValue[];
    rotateX?: number | KeyframeValue[];
    rotateY?: number | KeyframeValue[];
    rotateZ?: number | KeyframeValue[];
    skewX?: number | KeyframeValue[];
    skewY?: number | KeyframeValue[];
    transformOrigin?: string;
    perspective?: number | string;
    width?: number | string | KeyframeValue[];
    height?: number | string | KeyframeValue[];
    backgroundColor?: string | KeyframeValue[];
    color?: string | KeyframeValue[];
    borderRadius?: number | string | KeyframeValue[];
    boxShadow?: string | KeyframeValue[];
    filter?: string | KeyframeValue[];
    clipPath?: string | KeyframeValue[];
}

/** A single animation definition. */
export interface Animation {
    /** The unique ID of the animation. */
    id: string;
    /** The trigger for the animation. */
    trigger: AnimationTrigger;
    /** The animation configuration. */
    config: AnimationConfig;
    /** The target properties to animate. */
    properties: AnimatedProperties;
    /** The initial state (for mount/initial animations). */
    initial?: AnimatedProperties;
    /** The exit state (for exit animations). */
    exit?: AnimatedProperties;
    /** The viewport configuration (for viewport-triggered animations). */
    viewport?: ViewportConfig;
    /** Whether the animation is disabled. */
    disabled?: boolean;
}

/** The viewport configuration for scroll-triggered animations. */
export interface ViewportConfig {
    /** The amount of the element that must be visible to trigger (0-1). */
    amount?: number | 'some' | 'all';
    /** Whether to trigger once or every time. */
    once?: boolean;
    /** The margin around the viewport. */
    margin?: string;
}

/** The animation state for a node. */
export interface AnimationState {
    /** All animations for the node. */
    animations: Animation[];
    /** The default initial state. */
    initial?: AnimatedProperties;
    /** The default animate state. */
    animate?: AnimatedProperties;
    /** The default exit state. */
    exit?: AnimatedProperties;
    /** The default viewport configuration. */
    viewport?: ViewportConfig;
}
