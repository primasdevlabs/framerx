/**
 * Unit conversion and number formatting utilities.
 */

import { DEFAULT_SPACING_SCALE } from './constants';

/** Round a number to a given precision. */
export function round(value: number, precision = 2): number {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
}

/** Format a number as a CSS length (px by default). */
export function toPx(value: number): string {
    return `${round(value)}px`;
}

/** Format a number as a percentage. */
export function toPercent(value: number): string {
    return `${round(value)}%`;
}

/** Convert a pixel value to rem (assuming 16px root). */
export function pxToRem(value: number, rootSize = 16): number {
    return value / rootSize;
}

/** Format a number as rem. */
export function toRem(value: number, rootSize = 16): string {
    return `${round(pxToRem(value, rootSize))}rem`;
}

/** Convert a pixel value to a Tailwind-compatible spacing value (0.25rem = 1 unit). */
export function pxToTailwindSpacing(value: number): number {
    return round(value / 4);
}

/**
 * Format a pixel value as a Tailwind spacing class suffix.
 *
 * Values that exist in the default Tailwind spacing scale produce the bare
 * scale key (e.g. 16px → '4'), anything else produces an arbitrary value
 * (e.g. 60px → '[60px]') so the emitted class is always valid.
 */
export function toTailwindSpacing(value: number): string {
    const spacing = pxToTailwindSpacing(value);
    if (spacing === 0) return '0';
    if (Number.isInteger(spacing) && DEFAULT_SPACING_SCALE[spacing] !== undefined) {
        return String(spacing);
    }
    return `[${Math.round(value * 100) / 100}px]`;
}

/** Clamp a value between min and max. */
export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/** Check if a value is approximately zero. */
export function isZero(value: number, epsilon = 0.001): boolean {
    return Math.abs(value) < epsilon;
}

/** Check if two numbers are approximately equal. */
export function approxEqual(a: number, b: number, epsilon = 0.001): boolean {
    return Math.abs(a - b) < epsilon;
}

/** Normalize a number to a finite value, falling back to a default. */
export function finite(value: number, fallback = 0): number {
    return Number.isFinite(value) ? value : fallback;
}