/**
 * Framer interactions → Design AST animation conversion.
 */

import type { Animation, AnimationConfig, AnimationState, AnimatedProperties, AnimationTrigger, Easing, TweenConfig, ViewportConfig } from '@framer/compiler-ast';
import { generateId } from '@framer/compiler-shared';

import type { FramerAnimation, FramerInteraction } from './types';

/** Convert Framer interactions to a Design AST AnimationState. */
export function parseAnimations(interactions?: FramerInteraction[]): AnimationState | undefined {
    if (!interactions || interactions.length === 0) return undefined;

    const animations: Animation[] = [];
    let initial: AnimatedProperties | undefined;
    let animate: AnimatedProperties | undefined;
    let exit: AnimatedProperties | undefined;
    let viewport: ViewportConfig | undefined;

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
            id: generateId('anim'),
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

    for (const [key, value] of Object.entries(properties)) {
        switch (key) {
            case 'opacity':
                result.opacity = value as number;
                break;
            case 'x':
                result.x = value as number | string;
                break;
            case 'y':
                result.y = value as number | string;
                break;
            case 'scale':
                result.scale = value as number;
                break;
            case 'scaleX':
                result.scaleX = value as number;
                break;
            case 'scaleY':
                result.scaleY = value as number;
                break;
            case 'rotate':
                result.rotate = value as number;
                break;
            case 'rotateX':
                result.rotateX = value as number;
                break;
            case 'rotateY':
                result.rotateY = value as number;
                break;
            case 'skewX':
                result.skewX = value as number;
                break;
            case 'skewY':
                result.skewY = value as number;
                break;
            case 'width':
                result.width = value as number | string;
                break;
            case 'height':
                result.height = value as number | string;
                break;
            case 'backgroundColor':
                result.backgroundColor = value as string;
                break;
            case 'color':
                result.color = value as string;
                break;
            case 'borderRadius':
                result.borderRadius = value as number | string;
                break;
            case 'boxShadow':
                result.boxShadow = value as string;
                break;
            case 'filter':
                result.filter = value as string;
                break;
            case 'clipPath':
                result.clipPath = value as string;
                break;
            default:
                break;
        }
    }

    return result;
}