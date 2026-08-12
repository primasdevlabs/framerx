/**
 * End-to-end tests for the compiler pipeline:
 *   Framer document → parser → optimizer → generators → formatter → zip
 */

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { findFile, generateProject } from '@framer/compiler-generators';
import { mockFramerDocument, parseFramerDocument } from '@framer/compiler-parser';
import type { DesignNode } from '@framer/compiler-ast';

import { compile, compileFramerDocument } from '../src/index';
import { optimizeNode } from '../src/optimizer';

/** Build a minimal container node for optimizer tests. */
function containerNode(overrides: Partial<DesignNode> = {}): DesignNode {
    return {
        type: 'frame',
        id: 'n1',
        name: 'Empty Wrapper',
        frame: { x: 0, y: 0, width: 100, height: 100 },
        layout: {
            style: { strategy: 'auto' },
            position: { mode: 'static' },
            sizing: { widthMode: 'auto', heightMode: 'auto' },
            spacing: {},
        },
        style: {},
        constraints: { horizontal: 'left', vertical: 'top' },
        children: [],
        ...overrides,
    };
}

describe('parser', () => {
    it('parses the mock Framer document into a Design AST', () => {
        const doc = parseFramerDocument(mockFramerDocument);

        expect(doc.name).toBe('Marketing Landing Page');
        expect(doc.version).toBe('1.0.0');
        expect(doc.nodes).toHaveLength(6);
        expect(doc.metadata?.source).toBe('framer');
        expect(doc.breakpoints.length).toBeGreaterThan(0);
    });

    it('collects assets and fonts', () => {
        const doc = parseFramerDocument(mockFramerDocument);

        expect(doc.assets.length).toBe(1); // the dashboard image
        expect(doc.assets[0].type).toBe('image');
        expect(doc.assets[0].extension).toBe('png');

        expect(doc.fonts.map((f) => f.family)).toContain('Inter');
    });

    it('parses layout, style, and animations', () => {
        const doc = parseFramerDocument(mockFramerDocument);
        const hero = doc.nodes[0];

        expect(hero.type).toBe('frame');
        expect(hero.layout.style.strategy).toBe('flex');
        expect(hero.style.fills?.[0]).toMatchObject({ type: 'solid', color: '#0f172a' });

        // Primary button has a whileHover animation.
        const button = hero.children[2].children[0];
        expect(button.animations?.animations[0].trigger).toBe('hover');
        expect(button.animations?.animations[0].properties).toMatchObject({ scale: 1.05 });
    });
});

describe('optimizer', () => {
    it('removes empty unstyled wrapper containers', () => {
        const node = containerNode({ children: [containerNode({ id: 'empty' })] });
        const optimized = optimizeNode(node);

        expect(optimized.children).toHaveLength(0);
    });

    it('keeps containers that carry style, layout, or semantics', () => {
        // A styled container is not removed when nested inside a parent.
        const parent = containerNode({
            children: [containerNode({ id: 'styled', style: { opacity: 0.5 } })],
        });
        expect(optimizeNode(parent).children).toHaveLength(1);

        // An empty wrapper nested inside a parent is removed.
        const withEmpty = containerNode({ children: [containerNode({ id: 'empty' })] });
        expect(optimizeNode(withEmpty).children).toHaveLength(0);
    });

    it('keeps fixed-size empty containers (they occupy layout space)', () => {
        const parent = containerNode({
            children: [
                containerNode({
                    id: 'sized',
                    layout: { ...containerNode().layout, sizing: { widthMode: 'fixed', heightMode: 'fixed' } },
                }),
            ],
        });
        expect(optimizeNode(parent).children).toHaveLength(1);
    });

    it('never drops non-container nodes', () => {
        const text = containerNode({ id: 't', type: 'text', text: { text: 'hi', style: {} } });
        expect(optimizeNode(text)).toEqual(text);
    });
});

describe('generators', () => {
    it('generates a complete project file set', () => {
        const doc = parseFramerDocument(mockFramerDocument);
        const project = generateProject(doc);

        const paths = project.files.map((f) => f.path);
        expect(paths).toContain('package.json');
        expect(paths).toContain('tsconfig.json');
        expect(paths).toContain('vite.config.ts');
        expect(paths).toContain('tailwind.config.ts');
        expect(paths).toContain('src/App.tsx');
        expect(paths).toContain('src/main.tsx');
        expect(paths).toContain('src/styles/index.css');
        expect(paths).toContain('src/vite-env.d.ts');
        expect(paths).toContain('index.html');
        expect(paths).toContain('.prettierrc');
        expect(paths).toContain('README.md');
    });

    it('generates sections for root nodes', () => {
        const doc = parseFramerDocument(mockFramerDocument);
        const project = generateProject(doc);

        expect(findFile(project, 'src/sections/HeroSection.tsx')).toBeDefined();
        expect(findFile(project, 'src/sections/FeaturesSection.tsx')).toBeDefined();
        expect(findFile(project, 'src/sections/AnimatedShowcase.tsx')).toBeDefined();
        expect(findFile(project, 'src/sections/TestimonialsSection.tsx')).toBeDefined();
        expect(findFile(project, 'src/sections/MetricsSection.tsx')).toBeDefined();
        expect(findFile(project, 'src/sections/GradientSection.tsx')).toBeDefined();
    });

    it('extracts duplicate component instances once', () => {
        const doc = parseFramerDocument(mockFramerDocument);
        const project = generateProject(doc);

        const cards = project.files.filter((f) => f.path === 'src/components/FeatureCard.tsx');
        expect(cards).toHaveLength(1);
    });

    it('imports referenced components in sections', () => {
        const doc = parseFramerDocument(mockFramerDocument);
        const project = generateProject(doc);

        const section = findFile(project, 'src/sections/FeaturesSection.tsx');
        expect(section).toBeDefined();
        expect(section!.content).toContain("import { FeatureCard } from '../components/FeatureCard';");
        expect(section!.content).toContain('<FeatureCard');
    });

    it('generates Motion props for animated nodes', () => {
        const doc = parseFramerDocument(mockFramerDocument);
        const project = generateProject(doc, { animations: true });

        const showcase = findFile(project, 'src/sections/AnimatedShowcase.tsx');
        expect(showcase!.content).toContain("import { motion } from 'motion/react';");
        expect(showcase!.content).toContain('whileInView');
        expect(showcase!.content).toContain('viewport');
    });

    it('never self-imports a component and emits vite-env.d.ts', () => {
        const doc = parseFramerDocument(mockFramerDocument);
        const project = generateProject(doc, { animations: true });

        const featureCard = findFile(project, 'src/components/FeatureCard.tsx');
        expect(featureCard!.content).not.toContain('from ./FeatureCard');
        expect(featureCard!.content).not.toContain("from './FeatureCard'");

        expect(findFile(project, 'src/vite-env.d.ts')).toBeDefined();
    });

    it('imports motion when an animated child renders motion components', () => {
        const doc = parseFramerDocument(mockFramerDocument);
        const project = generateProject(doc, { animations: true });

        // The root Hero Section has no animation, but its button child does.
        const hero = findFile(project, 'src/sections/HeroSection.tsx');
        expect(hero!.content).toContain("import { motion } from 'motion/react';");
        expect(hero!.content).toContain('whileHover');
    });

    it('emits only valid Tailwind classes', () => {
        const doc = parseFramerDocument(mockFramerDocument);
        const project = generateProject(doc, { animations: true });

        const showcase = findFile(project, 'src/sections/AnimatedShowcase.tsx');
        // Padding 60px is off the default scale → a theme token makes py-15 valid.
        expect(showcase!.content).toContain('py-15');
        expect(showcase!.content).not.toContain('py-[60px]');

        const features = findFile(project, 'src/sections/FeaturesSection.tsx');
        expect(features!.content).toContain('justify-between');
        expect(features!.content).not.toContain('justify-space-between');
    });

    it('prefers palette and token classes over arbitrary values', async () => {
        // Extraction runs in the compiler pipeline, so use compileFramerDocument
        // to see the extracted component files.
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });
        const project = { name: 'Demo', files: result.files, nodes: result.nodes };

        // Palette colors resolve to standard Tailwind classes.
        const hero = findFile(project, 'src/sections/HeroSection.tsx');
        expect(hero!.content).toContain('bg-slate-900');
        expect(hero!.content).not.toContain('bg-[#0f172a]');

        // Non-palette colors become theme tokens (bg-color1).
        const testimonials = findFile(project, 'src/sections/TestimonialsSection.tsx');
        expect(testimonials!.content).toContain('bg-color1');
        expect(testimonials!.content).not.toContain('bg-[#eef2f7]');

        // Off-scale radii and spacing become tokens (rounded-20, w-95).
        const card = findFile(project, 'src/components/TestimonialCard.tsx');
        expect(card!.content).toContain('rounded-20');
        expect(card!.content).not.toContain('rounded-[20px]');
        expect(card!.content).toContain('w-95');

        // The theme resolves exactly the emitted tokens.
        const config = findFile(project, 'tailwind.config.ts');
        expect(config!.content).toContain("color1: '#eef2f7'");
        expect(config!.content).toContain("'20': '20px'");
        expect(config!.content).toContain("'15': '60px'");
    });

    it('renders gradient fills as inline backgrounds with token references', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });
        const project = { name: 'Demo', files: result.files, nodes: result.nodes };

        // The showcase's linear gradient renders as an inline background with
        // token-module stop references — not a bg-* class (none exists) and
        // not a literal hex string.
        const showcase = findFile(project, 'src/sections/AnimatedShowcase.tsx');
        expect(showcase).toBeDefined();
        expect(showcase!.content).toContain(
            'background: `linear-gradient(135deg, ${colors.indigo500} 0%, ${colors.violet500} 100%)`',
        );
        expect(showcase!.content).not.toContain('bg-[#6366f1]');
        expect(showcase!.content).toContain("import { colors } from '../tokens';");

        // The gradient stops are named in the tokens module.
        const tokensFile = findFile(project, 'src/tokens.ts');
        expect(tokensFile!.content).toContain("indigo500: '#6366f1'");
        expect(tokensFile!.content).toContain("violet500: '#8b5cf6'");
    });

    it('renders the extracted gradient demo cards with token-referenced gradient props', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });
        const project = { name: 'Demo', files: result.files, nodes: result.nodes };

        // The repeated gradient cards extract into one component with a typed
        // GradientValue prop, rendered as a prop-driven background (no token
        // refs in this file, so no unused colors import).
        const card = findFile(project, 'src/components/GradientCard.tsx');
        expect(card).toBeDefined();
        expect(card!.content).toContain("import { type GradientValue } from '../tokens';");
        expect(card!.content).toContain('gradient?: GradientValue;');
        expect(card!.content).toContain('gradientLabel?: string;');
        // Prettier breaks the guarded ternary across lines; the `: undefined`
        // else-branch is what keeps the optional prop strict-tsc-safe.
        expect(card!.content).toContain('background: gradient');
        expect(card!.content).toContain(
            "? `linear-gradient(${gradient.angle ?? 0}deg, ${gradient.stops.map((s) => `${s.color} ${Math.round(s.position * 1000) / 10}%`).join(', ')})`",
        );
        expect(card!.content).toContain(': undefined,');
        expect(card!.content).not.toContain('import { colors }');

        // Instances pass gradient object literals with token-referenced stops
        // (Prettier formats the object across lines).
        const section = findFile(project, 'src/sections/GradientSection.tsx');
        expect(section).toBeDefined();
        expect(section!.content).toContain('{ color: colors.indigo500, position: 0 },');
        expect(section!.content).toContain('{ color: colors.violet500, position: 1 },');
        expect(section!.content).toContain('angle: 135,');
        expect(section!.content).toContain('gradientLabel="Indigo to Violet"');
        // The three-stop card carries its non-even middle position (12.5%).
        expect(section!.content).toContain('{ color: colors.white, position: 0.25 },');
        expect(section!.content).toContain("import { colors } from '../tokens';");

        // The tokens module carries the gradient types and stop colors.
        const tokensFile = findFile(project, 'src/tokens.ts');
        expect(tokensFile!.content).toContain('export type GradientValue');
        expect(tokensFile!.content).toContain("sky500: '#0ea5e9'");

        // The label's off-scale width (316px → unit 79) becomes a theme token;
        // Tailwind silently ignores unknown classes, so assert it explicitly.
        const config = findFile(project, 'tailwind.config.ts');
        expect(config!.content).toContain("'79': '316px'");
    });

    it('renders instance color props as token references', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });
        const project = { name: 'Demo', files: result.files, nodes: result.nodes };

        // Accent colors render as module references, not literal hex strings.
        const metrics = findFile(project, 'src/sections/MetricsSection.tsx');
        expect(metrics!.content).toContain("import { colors, radii, spacing } from '../tokens';");
        expect(metrics!.content).toContain('accent={colors.emerald500}');
        expect(metrics!.content).toContain('accent={colors.blue500}');
        expect(metrics!.content).toContain('accent={colors.violet500}');
        expect(metrics!.content).not.toMatch(/accent="#[0-9a-f]{6}"/);

        // Numeric length props render as token references too.
        expect(metrics!.content).toContain('radius={radii[20]}');
        expect(metrics!.content).toContain('width={spacing[95]}');
        expect(metrics!.content).toContain('width={spacing[85]}');

        const hero = findFile(project, 'src/sections/HeroSection.tsx');
        expect(hero!.content).toContain('buttonLabelColor={colors.white}');
        expect(hero!.content).toContain('buttonLabelColor={colors.slate400}');

        // Color/length props are typed from the tokens module.
        const card = findFile(project, 'src/components/StatCard.tsx');
        expect(card!.content).toContain(
            "import { type ColorValue, type RadiusValue, type SpacingValue } from '../tokens';",
        );
        expect(card!.content).toContain('accent?: ColorValue;');
        expect(card!.content).toContain('radius?: RadiusValue;');
        expect(card!.content).toContain('width?: SpacingValue;');

        // The tokens module carries colors, radii, and spacing.
        const tokensFile = findFile(project, 'src/tokens.ts');
        expect(tokensFile).toBeDefined();
        expect(tokensFile!.content).toContain("emerald500: '#10b981'");
        expect(tokensFile!.content).toContain('export const radii = {');
        expect(tokensFile!.content).toContain('export const spacing = {');
        expect(tokensFile!.content).toContain('95: 380,');
        expect(tokensFile!.content).toContain('export type RadiusValue');
        expect(tokensFile!.content).toContain('export type SpacingValue');
    });
});

describe('compiler pipeline', () => {
    it('compiles a Framer document end-to-end', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });

        expect(result.name).toBe('Demo');
        expect(result.files.length).toBeGreaterThan(10);
        expect(result.zip).toBeDefined();
        expect(result.zip!.byteLength).toBeGreaterThan(100);
    });

    it('compiles a Design AST without any Framer dependency', async () => {
        const doc = parseFramerDocument(mockFramerDocument);
        const result = await compile(doc, { projectName: 'platform-agnostic', zip: false });

        expect(result.name).toBe('PlatformAgnostic');
        expect(result.zip).toBeUndefined();
        expect(findFile({ name: result.name, files: result.files, nodes: result.nodes }, 'src/App.tsx')).toBeDefined();
    });

    it('formats generated files with Prettier', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });

        const app = result.files.find((f) => f.path === 'src/App.tsx');
        expect(app).toBeDefined();
        expect(app!.content).toContain('export default function App()');
        // Prettier normalizes indentation — the template should be re-indented to 4 spaces.
        expect(app!.content).not.toMatch(/^ {8}<HeroSection/m);

        const pkg = result.files.find((f) => f.path === 'package.json');
        expect(JSON.parse(pkg!.content)).toBeDefined();
    });

    it('generates Motion animations by default', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });

        const showcase = result.files.find((f) => f.path === 'src/sections/AnimatedShowcase.tsx');
        expect(showcase!.content).toContain("import { motion } from 'motion/react';");
        expect(showcase!.content).toContain('whileInView');

        // Hover animations move into the extracted button component.
        const button = result.files.find((f) => f.path === 'src/components/PrimaryButton.tsx');
        expect(button!.content).toContain('whileHover');
    });

    it('produces a valid ZIP containing the expected entries', async () => {
        const result = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });

        const zip = await JSZip.loadAsync(result.zip!);
        const names = Object.keys(zip.files);

        expect(names).toContain('package.json');
        expect(names).toContain('src/App.tsx');
        expect(names).toContain('src/sections/HeroSection.tsx');
        expect(names).toContain('src/components/FeatureCard.tsx');
    });

    it('is deterministic across runs (same input → same output)', async () => {
        const a = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });
        const b = await compileFramerDocument(mockFramerDocument, { projectName: 'demo' });

        expect(a.files.map((f) => f.path)).toEqual(b.files.map((f) => f.path));
        expect(a.files.map((f) => f.content)).toEqual(b.files.map((f) => f.content));
    });
});
