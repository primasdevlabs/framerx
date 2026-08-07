/**
 * Color parsing and conversion utilities.
 */

import type { ColorValue } from './types';

/** A parsed RGBA color. */
export interface RGBA {
    r: number;
    g: number;
    b: number;
    a: number;
}

const HEX_SHORT = /^#([0-9a-f]{3})$/i;
const HEX_SHORT_ALPHA = /^#([0-9a-f]{4})$/i;
const HEX_LONG = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX_LONG_ALPHA = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;
const HSL = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/** Parse a hex pair into a number. */
function hexPair(value: string): number {
    return parseInt(value, 16);
}

/** Parse a color string into RGBA components. Returns null if unparseable. */
export function parseColor(value: ColorValue): RGBA | null {
    if (value.startsWith('#')) {
        const short = HEX_SHORT.exec(value);
        if (short) {
            const [r, g, b] = short[1].split('').map((c) => hexPair(c + c));
            return { r, g, b, a: 1 };
        }

        const shortAlpha = HEX_SHORT_ALPHA.exec(value);
        if (shortAlpha) {
            const [r, g, b, a] = shortAlpha[1].split('').map((c) => hexPair(c + c));
            return { r, g, b, a: a / 255 };
        }

        const long = HEX_LONG.exec(value);
        if (long) {
            const [, r, g, b] = long;
            return { r: hexPair(r), g: hexPair(g), b: hexPair(b), a: 1 };
        }

        const longAlpha = HEX_LONG_ALPHA.exec(value);
        if (longAlpha) {
            const [, r, g, b, a] = longAlpha;
            return { r: hexPair(r), g: hexPair(g), b: hexPair(b), a: hexPair(a) / 255 };
        }

        return null;
    }

    const rgb = RGB.exec(value);
    if (rgb) {
        const [, r, g, b, a] = rgb;
        return {
            r: Number(r),
            g: Number(g),
            b: Number(b),
            a: a === undefined ? 1 : Number(a),
        };
    }

    const hsl = HSL.exec(value);
    if (hsl) {
        const [, h, s, l, a] = hsl;
        const { r, g, b } = hslToRgb(Number(h), Number(s), Number(l));
        return { r, g, b, a: a === undefined ? 1 : Number(a) };
    }

    return null;
}

/** Convert HSL to RGB. */
export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
    const sNorm = s / 100;
    const lNorm = l / 100;

    if (sNorm === 0) {
        const v = Math.round(lNorm * 255);
        return { r: v, g: v, b: v };
    }

    const hue2rgb = (p: number, q: number, t: number): number => {
        let tt = t;
        if (tt < 0) tt += 1;
        if (tt > 1) tt -= 1;
        if (tt < 1 / 6) return p + (q - p) * 6 * tt;
        if (tt < 1 / 2) return q;
        if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
        return p;
    };

    const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
    const p = 2 * lNorm - q;
    const hNorm = h / 360;

    return {
        r: Math.round(hue2rgb(p, q, hNorm + 1 / 3) * 255),
        g: Math.round(hue2rgb(p, q, hNorm) * 255),
        b: Math.round(hue2rgb(p, q, hNorm - 1 / 3) * 255),
    };
}

/** Convert RGB to HSL. */
export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;

    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    const delta = max - min;

    let h = 0;
    if (delta !== 0) {
        if (max === rNorm) {
            h = ((gNorm - bNorm) / delta) % 6;
        } else if (max === gNorm) {
            h = (bNorm - rNorm) / delta + 2;
        } else {
            h = (rNorm - gNorm) / delta + 4;
        }
        h *= 60;
        if (h < 0) h += 360;
    }

    const l = (max + min) / 2;
    const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** Format RGBA as a hex string. */
export function toHex(color: RGBA): string {
    const toHexPair = (v: number): string => {
        const clamped = Math.round(Math.min(Math.max(v, 0), 255));
        return clamped.toString(16).padStart(2, '0');
    };

    if (color.a >= 1) {
        return `#${toHexPair(color.r)}${toHexPair(color.g)}${toHexPair(color.b)}`;
    }

    return `#${toHexPair(color.r)}${toHexPair(color.g)}${toHexPair(color.b)}${toHexPair(color.a * 255)}`;
}

/** Format RGBA as a CSS rgba() string. */
export function toRgba(color: RGBA): string {
    return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${color.a})`;
}

/** Format RGBA as a CSS color string, preferring hex when opaque. */
export function toCssColor(color: RGBA): string {
    if (color.a >= 1) return toHex(color);
    return toRgba(color);
}

/** Normalize any supported color string to a canonical CSS color string. */
export function normalizeColor(value: ColorValue): string {
    const parsed = parseColor(value);
    if (!parsed) return value;
    return toCssColor(parsed);
}

/** Extract the alpha channel from a color string. Returns 1 if unparseable. */
export function getAlpha(value: ColorValue): number {
    const parsed = parseColor(value);
    return parsed?.a ?? 1;
}

/** Set the alpha channel of a color string. */
export function withAlpha(value: ColorValue, alpha: number): string {
    const parsed = parseColor(value);
    if (!parsed) return value;
    return toRgba({ ...parsed, a: alpha });
}

/** Check if a color is fully transparent. */
export function isTransparent(value: ColorValue): boolean {
    return getAlpha(value) <= 0;
}

/** Check if a color is fully opaque. */
export function isOpaque(value: ColorValue): boolean {
    return getAlpha(value) >= 1;
}