/**
 * Framer interactions → Design AST animation conversion.
 */

import type { Animation, AnimationConfig, AnimationState, AnimatedProperties, AnimationTrigger, Easing, TweenConfig, ViewportConfig } from '@framer/compiler-ast';
import { stableId } from '@framer/compiler-shared';

import type { FramerAnimation, FramerInteraction } from './types';

/** Convert Framer interactions to a Design AST AnimationState. */
export function parseAnimations(interactions?: FramerInteraction[]): AnimationState | undefined {
    if (!interactions || interactions.length === 0) return undefined;

    const animations: Animation[] = [];
    let initial: AnimatedProperties | undefined;
    let animate: AnimatedProperties | undefined;
    let exit: AnimatedProperties | undefined;
    let viewport: ViewportConfig | undefined;
    const seenAnimationIds = new Set<string>();

    for (const interaction of interactions) {
        if (!interaction.animation) continue;

        const trigger = mapTrigger(interaction.trigger);
        const config = parseAnimationConfig(interaction.animation);
        const properties = parseAnimatedProperties(interaction.animation.properties);

        if (trigger === 'initial' && interaction.animation.initial) {
            initial = parseAnimatedProperties(interaction.animation.initial);
        }
        if (trigger === 'mount' && interaction.animation.properties) {
            animate = properties;
        }
        if (interaction.animation.exit) {
            exit = parseAnimatedProperties(interaction.animation.exit);
        }
        if (interaction.animation.viewport) {
            viewport = {
                amount: interaction.animation.viewport.amount as ViewportConfig['amount'],
                once: interaction.animation.viewport.once,
                margin: interaction.animation.viewport.margin,
            };
        }

        animations.push({
            id: uniqueAnimationId(trigger, config, properties, seenAnimationIds),
            trigger,
            config,
            properties,
            initial: interaction.animation.initial ? parseAnimatedProperties(interaction.animation.initial) : undefined,
            exit: interaction.animation.exit ? parseAnimatedProperties(interaction.animation.exit) : undefined,
            viewport,
        });
    }

    if (animations.length === 0) return undefined;

    return {
        animations,
        initial,
        animate,
        exit,
        viewport,
    };
}

/**
 * A deterministic animation id derived from the animation's own content.
 * Two identical interactions on the same node produce distinct ids via an
 * index suffix, so ids never depend on traversal order or wall-clock time.
 */
function uniqueAnimationId(
    trigger: AnimationTrigger,
    config: AnimationConfig,
    properties: AnimatedProperties,
    used: Set<string>,
): string {
    const base = stableId('anim', JSON.stringify({ trigger, config, properties }));
    if (!used.has(base)) {
        used.add(base);
        return base;
    }
    let index = 2;
    while (used.has(`${base}_${index}`)) index += 1;
    used.add(`${base}_${index}`);
    return `${base}_${index}`;
}

/** Map a Framer interaction trigger to a Design AST AnimationTrigger. */
export function mapTrigger(trigger: string): AnimationTrigger {
    switch (trigger) {
        case 'hover':
        case 'whileHover':
            return 'hover';
        case 'tap':
        case 'whileTap':
            return 'tap';
        case 'focus':
        case 'whileFocus':
            return 'focus';
        case 'viewport':
        case 'whileInView':
            return 'viewport';
        case 'initial':
            return 'initial';
        case 'mount':
        case 'animate':
            return 'mount';
        case 'scroll':
            return 'scroll';
        default:
            return 'mount';
    }
}

/** Convert a Framer animation to a Design AST AnimationConfig. */
export function parseAnimationConfig(animation: FramerAnimation): AnimationConfig {
    if (animation.type === 'spring') {
        return {
            type: 'spring',
            stiffness: animation.stiffness,
            damping: animation.damping,
            mass: animation.mass,
            bounce: animation.bounce,
            duration: animation.duration,
            delay: animation.delay,
        };
    }

    return {
        type: 'tween',
        duration: animation.duration,
        delay: animation.delay,
        ease: parseEasing(animation.ease),
        repeat: animation.repeat,
        repeatType: animation.repeatType as TweenConfig['repeatType'] | undefined,
        repeatDelay: animation.repeatDelay,
    };
}

/** Convert a Framer easing to a Design AST Easing. */
export function parseEasing(ease?: string | number[]): Easing | undefined {
    if (!ease) return undefined;
    if (typeof ease === 'string') {
        return ease as Easing;
    }
    if (Array.isArray(ease) && ease.length === 4) {
        return ease as [number, number, number, number];
    }
    return undefined;
}

/** Convert a Framer animation properties object to a Design AST AnimatedProperties. */
export function parseAnimatedProperties(properties?: Record<string, unknown>): AnimatedProperties {
    if (!properties) return {};

    const result: AnimatedProperties = {};

    const parseVal = (val: unknown) => {
        if (Array.isArray(val)) {
            return val.map((item) => (typeof item === 'object' && item !== null && 'value' in item ? item : { value: item }));
        }
        return val;
    };

    for (const [key, value] of Object.entries(properties)) {
        switch (key) {
            case 'opacity':
                result.opacity = parseVal(value) as AnimatedProperties['opacity'];
                break;
            case 'x':
                result.x = parseVal(value) as AnimatedProperties['x'];
                break;
            case 'y':
                result.y = parseVal(value) as AnimatedProperties['y'];
                break;
            case 'scale':
                result.scale = parseVal(value) as AnimatedProperties['scale'];
                break;
            case 'scaleX':
                result.scaleX = parseVal(value) as AnimatedProperties['scaleX'];
                break;
            case 'scaleY':
                result.scaleY = parseVal(value) as AnimatedProperties['scaleY'];
                break;
            case 'rotate':
                result.rotate = parseVal(value) as AnimatedProperties['rotate'];
                break;
            case 'rotateX':
                result.rotateX = parseVal(value) as AnimatedProperties['rotateX'];
                break;
            case 'rotateY':
                result.rotateY = parseVal(value) as AnimatedProperties['rotateY'];
                break;
            case 'rotateZ':
                result.rotateZ = parseVal(value) as AnimatedProperties['rotateZ'];
                break;
            case 'skewX':
                result.skewX = parseVal(value) as AnimatedProperties['skewX'];
                break;
            case 'skewY':
                result.skewY = parseVal(value) as AnimatedProperties['skewY'];
                break;
            case 'transformOrigin':
            case 'originX':
            case 'originY':
                if (key === 'transformOrigin') {
                    result.transformOrigin = value as string;
                } else if (typeof value === 'number') {
                    result.transformOrigin = key === 'originX' ? `${value * 100}% 50%` : `50% ${value * 100}%`;
                }
                break;
            case 'perspective':
                result.perspective = value as number | string;
                break;
            case 'width':
                result.width = parseVal(value) as AnimatedProperties['width'];
                break;
            case 'height':
                result.height = parseVal(value) as AnimatedProperties['height'];
                break;
            case 'backgroundColor':
                result.backgroundColor = parseVal(value) as AnimatedProperties['backgroundColor'];
                break;
            case 'color':
                result.color = parseVal(value) as AnimatedProperties['color'];
                break;
            case 'borderRadius':
                result.borderRadius = parseVal(value) as AnimatedProperties['borderRadius'];
                break;
            case 'boxShadow':
                result.boxShadow = parseVal(value) as AnimatedProperties['boxShadow'];
                break;
            case 'filter':
                result.filter = parseVal(value) as AnimatedProperties['filter'];
                break;
            case 'clipPath':
                result.clipPath = parseVal(value) as AnimatedProperties['clipPath'];
                break;
            default:
                break;
        }
    }

    return result;
}