/**
 * Demo: run the full compiler pipeline on the mock Framer document.
 *
 * Usage (from the repo root):
 *   pnpm demo
 *
 * Output:
 *   demo-output/<project-name>/   — the extracted project (npm install && npm run dev)
 *   demo-output/<project-name>.zip — the distributable archive
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { fatFixtureDocument, mockFramerDocument } from '@framer/compiler-parser';

import { compileFramerDocument, formatCoverage } from '../src/index';

async function main(): Promise<void> {
    const fixtureName = process.argv[2] ?? 'demo-landing';
    const fixtures = {
        'demo-landing': { name: 'demo-landing', document: mockFramerDocument },
        'fat-fixture': { name: 'fat-fixture', document: fatFixtureDocument },
        FatFixture: { name: 'FatFixture', document: fatFixtureDocument },
    } as const;
    const selection = fixtures[fixtureName as keyof typeof fixtures] ?? fixtures['demo-landing'];
    const result = await compileFramerDocument(selection.document, { projectName: selection.name });

    const root = resolve(process.cwd(), 'demo-output');
    const projectDir = join(root, result.name);

    await mkdir(projectDir, { recursive: true });
    await mkdir(root, { recursive: true });

    for (const file of result.files) {
        const target = join(projectDir, file.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.binary && file.data ? file.data : file.content);
    }

    if (result.zip) {
        await writeFile(join(root, `${result.name}.zip`), result.zip);
    }

    const componentCount = result.files.filter((f) => f.path.startsWith('src/components/')).length;
    const sectionCount = result.files.filter((f) => f.path.startsWith('src/sections/')).length;
    const d = result.diagnostics;

    console.log(`✓ Compiled ${result.name}`);
    console.log(`  Files:       ${result.files.length} (${sectionCount} sections, ${componentCount} components)`);
    console.log(`  Formatted:   yes`);
    console.log(`  ZIP size:    ${result.zip ? `${(result.zip.byteLength / 1024).toFixed(1)} KB` : 'disabled'}`);
    console.log(
        `  Diagnostics: ${d.nodesDiscovered} nodes · ${d.uniqueComponents} unique components (${d.componentsFromMasters} master-backed, ${d.componentsFromCode} code, ${d.componentsSynthesized} synthesized) · ${d.componentInstances} instances · ${d.assetsDiscovered} assets discovered · ${d.uniqueAssets} unique assets`,
    );
    console.log(`  Manifest:    .export-manifest.json emitted at project root`);
    if (d.coverage) console.log(formatCoverage(d.coverage));
    console.log(`  Validation:  ${d.errors === 0 ? '✓ valid' : `✗ ${d.errors} errors`} · ${d.warnings} warnings`);
    for (const warning of d.validation.warnings) {
        console.log(`    ⚠ ${warning.path ? `${warning.path}: ` : ''}${warning.message}`);
    }
    console.log(`  Project at:  ${projectDir}`);
    console.log(`  Archive at:  ${join(root, `${result.name}.zip`)}`);
    console.log('');
    console.log('Next steps:');
    console.log(`  cd ${projectDir} && npm install && npm run dev`);
}

main().catch((error: unknown) => {
    console.error('Compilation failed:', error);
    process.exit(1);
});
