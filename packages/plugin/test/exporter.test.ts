/**
 * Tests for the exporter pipeline (compile → ZIP).
 */

import { mockFramerDocument } from '@framer/compiler-parser';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { compileProject } from '../src/exporter/exporter';
import { validateDocument } from '../src/exporter/schemas';

describe('compileProject', () => {
    it('compiles the mock document into a valid ZIP', async () => {
        const result = await compileProject(mockFramerDocument, { projectName: 'demo', format: true, animations: true });

        expect(result.name).toBe('Demo');
        expect(result.files.length).toBeGreaterThan(10);
        expect(result.zip).toBeDefined();

        const zip = await JSZip.loadAsync(result.zip!);
        const names = Object.keys(zip.files);
        expect(names).toContain('src/App.tsx');
        expect(names).toContain('src/sections/HeroSection.tsx');
        expect(names).toContain('src/components/FeatureCard.tsx');
    });

    it('honors the format option', async () => {
        const formatted = await compileProject(mockFramerDocument, { format: true });
        const raw = await compileProject(mockFramerDocument, { format: false });

        // App.tsx is emitted from a hand-clean template; sections contain nested
        // JSX that requires re-indentation, so they genuinely differ.
        const heroFormatted = formatted.files.find((f) => f.path === 'src/sections/HeroSection.tsx');
        const heroRaw = raw.files.find((f) => f.path === 'src/sections/HeroSection.tsx');

        expect(heroFormatted!.content).not.toBe(heroRaw!.content);
        // The formatted section is prettier-clean: the animated buttons are
        // extracted, so motion lives in the button component, not the section.
        expect(heroFormatted!.content).toContain("import { PrimaryButton } from '../components/PrimaryButton';");
        expect(heroFormatted!.content).not.toContain("import { motion } from 'motion/react';");
        const button = formatted.files.find((f) => f.path === 'src/components/PrimaryButton.tsx');
        expect(button!.content).toContain("import { motion } from 'motion/react';");
    });
});

describe('validateDocument', () => {
    it('accepts a well-formed document', () => {
        expect(() => validateDocument(mockFramerDocument)).not.toThrow();
    });

    it('rejects malformed documents', () => {
        expect(() => validateDocument({ id: 123 })).toThrow(/Invalid Framer document/);
        expect(() => validateDocument(null)).toThrow(/Invalid Framer document/);
    });
});
