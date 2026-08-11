/**
 * Tests for string → identifier conversion. The generated project must never
 * contain an invalid identifier, no matter what characters the source names
 * carry — including TRAILING symbols, which the older regex left behind.
 */

import { describe, expect, it } from 'vitest';

import { sanitizeComponentName, toCamelCase, toKebabCase, toPascalCase, toVariableName } from '../src/string';

describe('toPascalCase', () => {
    it('strips trailing symbols that would produce an invalid identifier', () => {
        expect(toPascalCase('ThankYouForPurchase!')).toBe('ThankYouForPurchase');
        expect(toPascalCase('Main!')).toBe('Main');
        expect(toPascalCase('Badge!!!')).toBe('Badge');
    });

    it('capitalizes the character after internal separators', () => {
        expect(toPascalCase('Main 2')).toBe('Main2');
        expect(toPascalCase('data-test-id')).toBe('DataTestId');
        expect(toPascalCase('feature card')).toBe('FeatureCard');
    });

    it('handles leading and all-symbol strings', () => {
        expect(toPascalCase('!!!Hello')).toBe('Hello');
        expect(toPascalCase('!!!')).toBe('');
    });

    it('preserves unicode letters', () => {
        expect(toPascalCase('étude')).toBe('Étude');
        expect(toPascalCase('São Paulo')).toBe('SãoPaulo');
    });
});

describe('toCamelCase', () => {
    it('strips trailing symbols', () => {
        expect(toCamelCase('Content!')).toBe('content');
        expect(toCamelCase('icon!!!')).toBe('icon');
    });

    it('capitalizes the character after separators and lowercases the start', () => {
        expect(toCamelCase('Slot Position')).toBe('slotPosition');
        expect(toCamelCase('Header!')).toBe('header');
    });
});

describe('sanitizeComponentName', () => {
    it('never returns an invalid identifier', () => {
        expect(sanitizeComponentName('ThankYouForPurchase!')).toBe('ThankYouForPurchase');
        expect(sanitizeComponentName('Hero Section')).toBe('HeroSection');
        expect(sanitizeComponentName('123')).toBe('Component123');
        expect(sanitizeComponentName('!!!')).toBe('Component');
        expect(sanitizeComponentName('')).toBe('Component');
    });
});

describe('toVariableName / toKebabCase', () => {
    it('produces valid identifiers and slugs from symbol-heavy names', () => {
        expect(toVariableName('Icon!')).toBe('icon');
        expect(toVariableName('Item Count')).toBe('itemCount');
        expect(toKebabCase('ThankYouForPurchase!')).toBe('thank-you-for-purchase');
    });
});
