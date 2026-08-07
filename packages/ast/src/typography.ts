/**
 * Typography style definitions for the Design AST.
 */

import type { ColorValue } from '@framer/compiler-shared';

/** The font weight. */
export type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 'normal' | 'bold' | 'lighter' | 'bolder';

/** The text alignment. */
export type TextAlign = 'left' | 'center' | 'right' | 'justify';

/** The text decoration. */
export type TextDecoration = 'none' | 'underline' | 'overline' | 'line-through';

/** The text transform. */
export type TextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize';

/** The vertical alignment of text within its line box. */
export type VerticalAlign = 'baseline' | 'top' | 'middle' | 'bottom' | 'text-top' | 'text-bottom';

/** The white-space behavior. */
export type WhiteSpace = 'normal' | 'nowrap' | 'pre' | 'pre-wrap' | 'pre-line';

/** The overflow behavior for text. */
export type TextOverflow = 'clip' | 'ellipsis';

/** A text style definition. */
export interface TypographyStyle {
    /** The font family. */
    fontFamily?: string;
    /** The font size in px. */
    fontSize?: number;
    /** The font weight. */
    fontWeight?: FontWeight;
    /** The line height (unitless multiplier or px). */
    lineHeight?: number;
    /** The letter spacing in px. */
    letterSpacing?: number;
    /** The text color. */
    color?: ColorValue;
    /** The text alignment. */
    textAlign?: TextAlign;
    /** The text decoration. */
    textDecoration?: TextDecoration;
    /** The text transform. */
    textTransform?: TextTransform;
    /** The vertical alignment. */
    verticalAlign?: VerticalAlign;
    /** The white-space behavior. */
    whiteSpace?: WhiteSpace;
    /** The text overflow behavior. */
    textOverflow?: TextOverflow;
    /** The number of lines to clamp to (for truncation). */
    lineClamp?: number;
    /** Whether the text is italic. */
    italic?: boolean;
    /** Whether the text is underlined. */
    underline?: boolean;
    /** Whether the text is strikethrough. */
    strikethrough?: boolean;
    /** The text indent in px. */
    textIndent?: number;
    /** The text shadow. */
    textShadow?: string;
}

/** A text run (a segment of styled text). */
export interface TextRun {
    text: string;
    style?: TypographyStyle;
}

/** A paragraph of text. */
export interface TextParagraph {
    runs: TextRun[];
    style?: TypographyStyle;
}

/** The text content of a text node. */
export interface TextContent {
    /** The full text content. */
    text: string;
    /** The paragraphs (for rich text). */
    paragraphs?: TextParagraph[];
    /** The default style for the text. */
    style: TypographyStyle;
}