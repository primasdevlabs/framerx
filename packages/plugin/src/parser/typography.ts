/**
 * Framer SDK text node → FramerText mapping.
 */

import type { FramerText, FramerTypography } from '@framer/compiler-parser';

import type { SdkNode } from './sdk-types';
import { resolveColor } from './style';

/** Convert an SDK node's font/text-style attributes to FramerTypography. */
export function parseTypography(node: SdkNode): FramerTypography {
    const font = node.font;
    const inline = node.inlineTextStyle;
    const style: FramerTypography = {};

    if (font?.family) style.fontFamily = font.family;
    if (font?.weight) style.fontWeight = font.weight;
    if (inline?.fontSize != null) style.fontSize = inline.fontSize;
    if (inline?.letterSpacing != null) style.letterSpacing = inline.letterSpacing;
    if (inline?.lineHeight != null) style.lineHeight = inline.lineHeight;

    const color = resolveColor(inline?.color);
    if (color) style.color = color;

    if (inline?.alignment) style.textAlign = inline.alignment as FramerTypography['textAlign'];
    if (inline?.transform) style.textTransform = inline.transform as FramerTypography['textTransform'];
    if (inline?.decoration) style.textDecoration = inline.decoration as FramerTypography['textDecoration'];

    return style;
}

/** Build a FramerText from an SDK text node. */
export function parseText(node: SdkNode): FramerText {
    return {
        text: '',
        style: parseTypography(node),
    };
}
