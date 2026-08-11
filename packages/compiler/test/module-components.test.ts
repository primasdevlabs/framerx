/**
 * Shared module components — published ES-module bundles on Framer's CDN.
 *
 * A shared module has no canvas master and no local code file: the instance's
 * insertURL IS the bundle. The plugin fetches the bundle (+ its remote-import
 * closure) and marks it `isModule`; these tests pin the full compile path:
 *   - the bundle is emitted at its project path, adapted (`from 'framer'` →
 *     `./framer`), NOT stripped of addPropertyControls (the bundles call
 *     RenderTarget at runtime)
 *   - the Framer runtime shim (src/code/framer.js) is emitted once
 *   - a .d.ts declaration makes the import type-check (tsconfig has no
 *     allowJs) while Vite bundles the real .js
 *   - instances render with a `slots` prop (the module contract) + children
 *   - bare imports (@motionone/dom, framer-motion) are pinned in package.json
 *   - no 'framer runtime' warning (the shim covers it), validation passes
 */

import { describe, expect, it } from 'vitest';

import type { FramerDocument, FramerNode } from '@framer/compiler-parser';

import { compileFramerDocument } from '../src/index';

/** A module-backed component instance carrying its fetched bundle source. */
function moduleInstance(
    id: string,
    name: string,
    code: NonNullable<NonNullable<FramerNode['component']>['code']>,
    props?: Record<string, unknown>,
    children: FramerNode[] = [],
): FramerNode {
    return {
        id,
        type: 'Component',
        name,
        frame: { x: 0, y: 0, width: 320, height: 200 },
        layout: { strategy: 'auto' },
        style: {},
        component: { id: code.path, name, props, code },
        children,
    };
}

/** A frame node (the section root). */
function sectionRoot(id: string, name: string, children: FramerNode[]): FramerNode {
    return {
        id,
        type: 'Frame',
        name,
        frame: { x: 0, y: 0, width: 1440, height: 900 },
        layout: { strategy: 'flex', direction: 'column', alignItems: 'flex-start' },
        style: {},
        children,
    };
}

/** A text node (instance children). */
function textNode(id: string, name: string, text: string): FramerNode {
    return {
        id,
        type: 'Text',
        name,
        frame: { x: 0, y: 0, width: 200, height: 32 },
        layout: { strategy: 'auto' },
        style: {},
        text: { text, style: { fontFamily: 'Inter', fontSize: 16 } },
        children: [],
    };
}

/** The Ticker bundle shape from a real extraction (minified-style source). */
const tickerCode = {
    source: `import{jsx as _jsx}from"react/jsx-runtime";
import{Children}from"react";
import{addPropertyControls,ControlType,RenderTarget}from"framer";
import{useMotionValue,useTransform,motion,frame}from"framer-motion";
import{resize}from"@motionone/dom";
export default function Ticker(props){
  let{slots=[],text,speed=10}=props;
  const isCanvas=RenderTarget.current()===RenderTarget.canvas;
  return _jsx("div",{children:[text, slots.map((s,i)=>_jsx("span",{children:s},i))]});
}
addPropertyControls(Ticker,{text:{type:ControlType.String},speed:{type:ControlType.Number}});
`,
    fileName: 'Ticker.js',
    path: 'code/Ticker.js',
    exportName: 'default',
    isDefaultExport: true,
    isModule: true,
};

/** A document with module-backed instances in a Hero section. */
function makeDocument(instances: FramerNode[]): FramerDocument {
    return {
        id: 'doc_modules',
        name: 'Module Components Doc',
        version: '1.0.0',
        nodes: [sectionRoot('root', 'Hero Section', instances)],
    };
}

describe('shared module components', () => {
    it('marks the definition as code-backed and emits the bundle adapted — never stripped, never warned synthesized', async () => {
        const result = await compileFramerDocument(
            makeDocument([moduleInstance('t1', 'Ticker', tickerCode, { text: 'Latest news', speed: 24 })]),
            { projectName: 'module-demo' },
        );

        const synthesized = result.diagnostics.validation.warnings.find((w) => w.message.includes('synthesized'));
        expect(synthesized).toBeUndefined();
        expect(result.diagnostics.componentsFromCode).toBe(1);

        // The bundle lands at its project path.
        const file = result.files.find((f) => f.path === 'src/code/Ticker.js');
        expect(file).toBeDefined();
        // Adapted: the framer import points at the local shim (prettier
        // normalizes the emitted source to single quotes).
        expect(file!.content).toContain("from './framer'");
        expect(file!.content).not.toContain('from"framer"');
        // The real implementation survives, including the runtime RenderTarget
        // usage (NOT stripped — the shim provides it).
        expect(file!.content).toContain('export default function Ticker');
        expect(file!.content).toContain('RenderTarget.current()');
        expect(file!.content).toContain('addPropertyControls');
    });

    it('emits the framer runtime shim and a type declaration for the bundle', async () => {
        const result = await compileFramerDocument(
            makeDocument([moduleInstance('t1', 'Ticker', tickerCode)]),
            { projectName: 'module-demo' },
        );

        // The shim provides RenderTarget/ControlType/addPropertyControls.
        const shim = result.files.find((f) => f.path === 'src/code/framer.js');
        expect(shim).toBeDefined();
        expect(shim!.content).toContain('RenderTarget');
        expect(shim!.content).toContain('current: () => \'web\'');
        expect(shim!.content).toContain('export function addPropertyControls');
        expect(shim!.content).toContain('ControlType');

        // The .d.ts lets the section's import type-check against the .js bundle.
        const declaration = result.files.find((f) => f.path === 'src/code/Ticker.d.ts');
        expect(declaration).toBeDefined();
        expect(declaration!.content).toContain('export default Ticker');
    });

    it('renders instances with the slots prop (module contract) + children', async () => {
        const result = await compileFramerDocument(
            makeDocument([
                moduleInstance('t1', 'Ticker', tickerCode, { text: 'Latest news', speed: 24 }, [
                    textNode('child', 'Item', 'Breaking'),
                ]),
            ]),
            { projectName: 'module-demo' },
        );

        const section = result.files.find((f) => f.path === 'src/sections/HeroSection.tsx')!;
        // The default-import form against the code file.
        expect(section.content).toContain("import Ticker from '../code/Ticker';");
        // Real props + the slots array + JSX children both pass.
        expect(section.content).toContain('<Ticker');
        expect(section.content).toContain('text="Latest news"');
        expect(section.content).toContain('speed={24}');
        expect(section.content).toContain('slots={[');
        expect(section.content).toContain('Breaking');
        expect(section.content).toContain('</Ticker>');
    });

    it('pins the module bare imports in package.json and raises no framer-runtime warning', async () => {
        const result = await compileFramerDocument(
            makeDocument([moduleInstance('t1', 'Ticker', tickerCode)]),
            { projectName: 'module-demo' },
        );

        const pkg = result.files.find((f) => f.path === 'package.json')!;
        const json = JSON.parse(pkg.content) as { dependencies: Record<string, string> };
        expect(json.dependencies['framer-motion']).toBe('^12.0.0');
        expect(json.dependencies['@motionone/dom']).toBe('^10.18.0');
        // The shim covers 'framer' — no warning about the runtime import.
        const framerWarning = result.diagnostics.validation.warnings.find((w) => w.message.includes("imports the 'framer' runtime"));
        expect(framerWarning).toBeUndefined();
        // No unknown-dependency warning (both bare imports are pinned).
        const unknownWarning = result.diagnostics.validation.warnings.find((w) => w.message.includes('unknown dependencies'));
        expect(unknownWarning).toBeUndefined();
        expect(result.diagnostics.validation.valid).toBe(true);
    });

    it('emits the shim once across multiple module definitions', async () => {
        const result = await compileFramerDocument(
            makeDocument([
                moduleInstance('t1', 'Ticker', tickerCode),
                moduleInstance('s1', 'Slideshow', {
                    ...tickerCode,
                    fileName: 'Slideshow.js',
                    path: 'code/Slideshow.js',
                }),
            ]),
            { projectName: 'module-demo' },
        );

        const shims = result.files.filter((f) => f.path === 'src/code/framer.js');
        expect(shims).toHaveLength(1);
        // Both bundles emitted, each with its own declaration.
        expect(result.files.find((f) => f.path === 'src/code/Ticker.js')).toBeDefined();
        expect(result.files.find((f) => f.path === 'src/code/Slideshow.js')).toBeDefined();
        expect(result.files.find((f) => f.path === 'src/code/Ticker.d.ts')).toBeDefined();
        expect(result.files.find((f) => f.path === 'src/code/Slideshow.d.ts')).toBeDefined();
    });

    it('emits the transitive remote-import closure of the bundle as local files', async () => {
        const result = await compileFramerDocument(
            makeDocument([
                moduleInstance('t1', 'Ticker', {
                    ...tickerCode,
                    source: `import { Helper } from "./Helper"\nexport default function Ticker() { return Helper(); }\n`,
                    dependencies: [
                        { path: 'code/Helper.js', source: `import { RenderTarget } from "framer"\nexport function Helper() { return RenderTarget.current(); }\n` },
                    ],
                }),
            ]),
            { projectName: 'module-demo' },
        );

        const helper = result.files.find((f) => f.path === 'src/code/Helper.js');
        expect(helper).toBeDefined();
        // The dependency's framer import is adapted the same way as the entry.
        expect(helper!.content).toContain("from './framer'");
        expect(helper!.content).not.toContain('from "framer"');
        expect(result.diagnostics.validation.valid).toBe(true);
    });

    it('is deterministic across exports', async () => {
        const doc = makeDocument([moduleInstance('t1', 'Ticker', tickerCode, { text: 'x', speed: 24 }, [textNode('c', 'Item', 'Y')])]);
        const a = await compileFramerDocument(doc, { projectName: 'module-demo' });
        const b = await compileFramerDocument(doc, { projectName: 'module-demo' });

        expect(a.files.map((f) => f.content)).toEqual(b.files.map((f) => f.content));
    });
});
