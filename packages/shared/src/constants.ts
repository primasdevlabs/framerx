/**
 * Shared constants for the compiler.
 */

import type { Breakpoint } from './types';

/** Default responsive breakpoints (Tailwind-compatible). */
export const DEFAULT_BREAKPOINTS: Breakpoint[] = [
    { name: 'sm', minWidth: 640 },
    { name: 'md', minWidth: 768 },
    { name: 'lg', minWidth: 1024 },
    { name: 'xl', minWidth: 1280 },
    { name: '2xl', minWidth: 1536 },
];

/** Default root font size in px. */
export const DEFAULT_ROOT_FONT_SIZE = 16;

/** Default spacing scale in px (Tailwind-compatible). */
export const DEFAULT_SPACING_SCALE: Record<number, number> = {
    0: 0,
    0.5: 2,
    1: 4,
    1.5: 6,
    2: 8,
    2.5: 10,
    3: 12,
    3.5: 14,
    4: 16,
    5: 20,
    6: 24,
    7: 28,
    8: 32,
    9: 36,
    10: 40,
    11: 44,
    12: 48,
    14: 56,
    16: 64,
    20: 80,
    24: 96,
    28: 112,
    32: 128,
    36: 144,
    40: 160,
    44: 176,
    48: 192,
    52: 208,
    56: 224,
    60: 240,
    64: 256,
    72: 288,
    80: 320,
    96: 384,
};

/** Default font sizes in px (Tailwind-compatible). */
export const DEFAULT_FONT_SIZES: Record<string, number> = {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 36,
    '5xl': 48,
    '6xl': 60,
    '7xl': 72,
    '8xl': 96,
    '9xl': 128,
};

/** Default border radius values in px (Tailwind-compatible). */
export const DEFAULT_RADIUS: Record<string, number> = {
    none: 0,
    sm: 2,
    DEFAULT: 4,
    md: 6,
    lg: 8,
    xl: 12,
    '2xl': 16,
    '3xl': 24,
    full: 9999,
};

/** Default font families. */
export const DEFAULT_FONT_FAMILIES: Record<string, string> = {
    sans: 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
    serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
};

/** Supported image asset extensions. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'] as const;

/** Supported font asset extensions. */
export const FONT_EXTENSIONS = ['woff', 'woff2', 'ttf', 'otf'] as const;

/** Supported video asset extensions. */
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg'] as const;

/** Default project name. */
export const DEFAULT_PROJECT_NAME = 'framer-export';

/** Default output directory name. */
export const DEFAULT_OUTPUT_DIR = 'project';
