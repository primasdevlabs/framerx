/**
 * Reference renderer tests.
 *
 * The reference page must (1) be deterministic — same source in, byte-same
 * page out; (2) preserve every source value it renders (colors, sizes,
 * typography, gradients); (3) emit responsive media queries from the
 * document's own breakpoints; and (4) stay independent of the generated
 * React project (no Tailwind classes, no motion).
 */

import { describe, expect, it } from 'vitest';

import { fatFixtureDocument } from '@framer/compiler-parser';

import { nodeCss } from '../src/reference/css';
import { renderReferencePage, resolveBreakpoints, typographyCss } from '../src/reference/render';

describe('renderReferencePage', () => {
    it('is deterministic for identical input', () => {
        const a = renderReferencePage(fatFixtureDocument);
        const b = renderReferencePage(fatFixtureDocument);
        expect(a).toBe(b);
    });

    it('contains the exact source colors and sizes', () => {
        const html = renderReferencePage(fatFixtureDocument);
        expect(html).toContain('#6366f1');
        expect(html).toContain('#0ea5e9');
        expect(html).toContain('#a855f7');
        expect(html).toContain('48px'); // headline font size
        expect(html).toContain('360px'); // section height
        expect(html).toContain('220px'); // grid column width
    });

    it('preserves gradients, shadows, blur, rotation, cursor', () => {
        const html = renderReferencePage(fatFixtureDocument);
        expect(html).toContain('linear-gradient(135deg');
        expect(html).toContain('box-shadow');
        expect(html).toContain('blur(');
        expect(html).toContain('rotate(6deg)');
        expect(html).toContain('cursor: pointer');
        expect(html).toContain('image-rendering: crisp-edges');
    });

    it('preserves typography values (em letter-spacing, italic, transform)', () => {
        const html = renderReferencePage(fatFixtureDocument);
        expect(html).toContain('-0.02em');
        expect(html).toContain("font-style: italic");
        expect(html).toContain('text-transform: uppercase');
        expect(html).toContain('font-weight: 700');
    });

    it('emits media queries from the document breakpoints', () => {
        const html = renderReferencePage(fatFixtureDocument);
        // The fat fixture defines sm=640, md=768, lg=1024; only tiers that
        // carry source overrides emit media queries (sm here).
        expect(html).toContain('@media (min-width: 640px)');
        expect(html).not.toContain('@media (min-width: 768px)');
        expect(html).not.toContain('@media (min-width: 1024px)');
        expect(html).toContain('flex-direction: column'); // sm stack
        expect(html).toContain('font-size: 32px'); // sm headline
        expect(html).toContain('display: none'); // sm overlay hide
    });

    it('does not leak React/Tailwind implementation details', () => {
        const html = renderReferencePage(fatFixtureDocument);
        expect(html).not.toContain('className=');
        expect(html).not.toContain('motion.');
        expect(html).not.toContain('whileHover');
        expect(html).not.toContain('@tailwind');
    });

    it('resolves breakpoints: source wins over defaults', () => {
        const resolved = resolveBreakpoints(fatFixtureDocument);
        expect(resolved.map((b) => b.name)).toEqual(['sm', 'md', 'lg']);
    });

    it('renders text content escaped', () => {
        const html = renderReferencePage(fatFixtureDocument);
        expect(html).toContain('Build With Confidence');
        expect(html).toContain('Cursive, underlined.');
    });
});

describe('nodeCss / typographyCss', () => {
    it('maps fill → 100% and hug → fit-content', () => {
        const fill = nodeCss({
            id: 'n',
            type: 'Frame',
            name: 'N',
            frame: { x: 0, y: 0, width: 1440, height: 100 },
            layout: { strategy: 'flex', sizing: { widthMode: 'fill', heightMode: 'fixed' } },
            style: {},
        });
        expect(fill).toContainEqual({ property: 'width', value: '100%' });
        expect(fill).toContainEqual({ property: 'height', value: '100px' });

        const hug = nodeCss({
            id: 'n',
            type: 'Frame',
            name: 'N',
            frame: { x: 0, y: 0, width: 200, height: 100 },
            layout: { strategy: 'auto', sizing: { widthMode: 'hug', heightMode: 'auto' } },
            style: {},
        });
        expect(hug).toContainEqual({ property: 'width', value: 'fit-content' });
        expect(hug).toContainEqual({ property: 'height', value: 'auto' });
    });

    it('renders absolute positioning offsets', () => {
        const css = nodeCss({
            id: 'n',
            type: 'Frame',
            name: 'N',
            frame: { x: 32, y: 40, width: 240, height: 120 },
            layout: { strategy: 'absolute', position: 'absolute', offsets: { left: 32, top: 40 }, zIndex: 10 },
            style: {},
        });
        expect(css).toContainEqual({ property: 'position', value: 'absolute' });
        expect(css).toContainEqual({ property: 'left', value: '32px' });
        expect(css).toContainEqual({ property: 'top', value: '40px' });
        expect(css).toContainEqual({ property: 'z-index', value: '10' });
    });

    it('renders typography with exact values', () => {
        const css = typographyCss({
            fontFamily: 'Inter',
            fontSize: 48,
            fontWeight: 700,
            letterSpacing: -0.02,
            italic: true,
            color: '#0f172a',
        });
        expect(css).toContainEqual({ property: 'font-size', value: '48px' });
        expect(css).toContainEqual({ property: 'font-weight', value: '700' });
        expect(css).toContainEqual({ property: 'letter-spacing', value: '-0.02em' });
        expect(css).toContainEqual({ property: 'font-style', value: 'italic' });
        expect(css).toContainEqual({ property: 'color', value: '#0f172a' });
    });
});
