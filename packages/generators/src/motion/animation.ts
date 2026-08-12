/**
 * Design AST animations → Motion component props.
 */

import type { AnimatedProperties, AnimationConfig, DesignNode, ViewportConfig } from '@framer/compiler-ast';

/** Generate Motion props for a node's animation state. */
export function generateMotionProps(node: DesignNode): MotionProps {
    const result: MotionProps = {};
    const animations = node.animations;

    if (!animations) return result;

    // Initial state
    if (animations.initial) {
        result.initial = formatAnimatedProperties(animations.initial);
    }

    // Animate state
    if (animations.animate) {
        result.animate = formatAnimatedProperties(animations.animate);
    }

    // Exit state
    if (animations.exit) {
        result.exit = formatAnimatedProperties(animations.exit);
    }

    // Viewport config
    if (animations.viewport) {
        result.viewport = formatViewport(animations.viewport);
    }

    // Trigger-specific animations
    for (const animation of animations.animations) {
        switch (animation.trigger) {
            case 'hover':
                result.whileHover = formatAnimatedProperties(animation.properties);
                break;
            case 'tap':
                result.whileTap = formatAnimatedProperties(animation.properties);
                break;
            case 'focus':
                result.whileFocus = formatAnimatedProperties(animation.properties);
                break;
            case 'viewport':
                result.whileInView = formatAnimatedProperties(animation.properties);
                if (animation.initial && Object.keys(animation.initial).length > 0) {
                    result.initial = formatAnimatedProperties(animation.initial);
                }
                break;
            case 'initial':
                result.initial = formatAnimatedProperties(animation.initial ?? animation.properties);
                break;
            case 'mount':
                result.animate = formatAnimatedProperties(animation.properties);
                break;
            default:
                break;
        }

        // Transition config
        if (animation.config) {
            result.transition = formatTransition(animation.config);
        }
    }

    return result;
}

/** The Motion component props. */
export interface MotionProps {
    initial?: Record<string, unknown>;
    animate?: Record<string, unknown>;
    exit?: Record<string, unknown>;
    whileHover?: Record<string, unknown>;
    whileTap?: Record<string, unknown>;
    whileFocus?: Record<string, unknown>;
    whileInView?: Record<string, unknown>;
    transition?: Record<string, unknown>;
    viewport?: Record<string, unknown>;
}

/** Format animated properties as a plain object. */
export function formatAnimatedProperties(properties: AnimatedProperties): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(properties)) {
        if (value === undefined) continue;
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && 'value' in value[0]) {
            // Keyframe values
            result[key] = value.map((kf) => kf.value);
        } else {
            result[key] = value;
        }
    }

    return result;
}

/** Map a design easing name to a Motion easing name. */
const EASING_MAP: Record<string, string> = {
    linear: 'linear',
    ease: 'ease',
    'ease-in': 'easeIn',
    'ease-out': 'easeOut',
    'ease-in-out': 'easeInOut',
    'circ-in': 'circIn',
    'circ-out': 'circOut',
    'circ-in-out': 'circInOut',
    'back-in': 'backIn',
    'back-out': 'backOut',
    'back-in-out': 'backInOut',
    anticipate: 'anticipate',
};

/** Convert a design easing to a Motion-compatible easing. */
function formatEasing(ease: unknown): unknown {
    if (typeof ease === 'string' && EASING_MAP[ease] !== undefined) return EASING_MAP[ease];
    return ease;
}

/** Format a transition config as a Motion transition object. */
export function formatTransition(config: AnimationConfig): Record<string, unknown> {
    if (config.type === 'spring') {
        return {
            type: 'spring',
            stiffness: config.stiffness,
            damping: config.damping,
            mass: config.mass,
            bounce: config.bounce,
            delay: config.delay,
        };
    }

    return {
        type: 'tween',
        duration: config.duration,
        delay: config.delay,
        ease: formatEasing(config.ease),
        repeat: config.repeat,
        repeatType: config.repeatType,
        repeatDelay: config.repeatDelay,
    };
}

/** Format a viewport config as a Motion viewport object. */
export function formatViewport(viewport?: ViewportConfig): Record<string, unknown> {
    return {
        amount: viewport?.amount,
        once: viewport?.once,
        margin: viewport?.margin,
    };
}
