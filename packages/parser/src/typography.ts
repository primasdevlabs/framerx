/**
 * Framer typography → Design AST typography conversion.
 */

import type { TextContent, TextParagraph, TextRun, TypographyStyle } from '@framer/compiler-ast';
import { normalizeColor } from '@framer/compiler-shared';

import type { FramerText, FramerTypography } from './types';

/** Convert Framer typography to a Design AST TypographyStyle. */
export function parseTypography(typography?: FramerTypography): TypographyStyle {
    if (!typography) return {};

    const result: TypographyStyle = {};

    if (typography.fontFamily) result.fontFamily = typography.fontFamily;
    if (typography.fontSize !== undefined) result.fontSize = typography.fontSize;
    if (typography.fontWeight !== undefined) {
        result.fontWeight = typography.fontWeight as TypographyStyle['fontWeight'];
    }
    if (typography.lineHeight !== undefined) result.lineHeight = typography.lineHeight;
    if (typography.letterSpacing !== undefined) result.letterSpacing = typography.letterSpacing;
    if (typography.color) result.color = normalizeColor(typography.color);
    if (typography.textAlign) result.textAlign = typography.textAlign as TypographyStyle['textAlign'];
    if (typography.textDecoration)
        result.textDecoration = typography.textDecoration as TypographyStyle['textDecoration'];
    if (typography.textTransform) result.textTransform = typography.textTransform as TypographyStyle['textTransform'];
    if (typography.verticalAlign) result.verticalAlign = typography.verticalAlign as TypographyStyle['verticalAlign'];
    if (typography.whiteSpace) result.whiteSpace = typography.whiteSpace as TypographyStyle['whiteSpace'];
    if (typography.textOverflow) result.textOverflow = typography.textOverflow as TypographyStyle['textOverflow'];
    if (typography.lineClamp !== undefined) result.lineClamp = typography.lineClamp;
    if (typography.italic !== undefined) result.italic = typography.italic;
    if (typography.underline !== undefined) result.underline = typography.underline;
    if (typography.strikethrough !== undefined) result.strikethrough = typography.strikethrough;
    if (typography.textIndent !== undefined) result.textIndent = typography.textIndent;
    if (typography.textShadow) result.textShadow = typography.textShadow;

    return result;
}

/** Convert Framer text to a Design AST TextContent. */
export function parseText(text?: FramerText): TextContent {
    const style = parseTypography(text?.style);
    const content = text?.text ?? '';

    let paragraphs: TextParagraph[] | undefined;
    if (text?.runs && text.runs.length > 0) {
        paragraphs = buildParagraphs(text.runs);
    }

    return {
        text: content,
        paragraphs,
        style,
    };
}

/** Build paragraphs from text runs. */
function buildParagraphs(runs: FramerText['runs']): TextParagraph[] {
    if (!runs) return [];

    const paragraphs: TextParagraph[] = [];
    let current: TextRun[] = [];

    for (const run of runs) {
        const textRun: TextRun = {
            text: run.text,
            style: parseTypography(run.style),
        };

        if (run.text.includes('\n')) {
            const parts = run.text.split('\n');
            parts.forEach((part: string, index: number) => {
                if (index > 0) {
                    paragraphs.push({ runs: current });
                    current = [];
                }
                if (part.length > 0) {
                    current.push({ ...textRun, text: part });
                }
            });
        } else {
            current.push(textRun);
        }
    }

    if (current.length > 0) {
        paragraphs.push({ runs: current });
    }

    return paragraphs;
}
