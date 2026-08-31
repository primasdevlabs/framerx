/**
 * Design AST node → React component generation.
 */

import type { ComponentDefinition, DesignNode } from '@framer/compiler-ast';
import type { Fill } from '@framer/compiler-shared';
import { normalizeColor, pxToTailwindSpacing, sanitizeComponentName, toVariableName } from '@framer/compiler-shared';

import { collectBodySlots, propTypeToTs, slotPropName } from '../components/model';
import { generateMotionProps, type MotionProps } from '../motion/animation';
import { breakpointMinWidth } from '../responsive/css';
import { generateClasses } from '../tailwind/classes';
import {
    COLOR_STYLE_FIELDS,
    NUMERIC_TOKEN_FIELDS,
    NUMERIC_TOKEN_MODULES,
    collectTemplateColorProps,
    collectTemplateGradientProps,
    collectTemplateNumericProps,
} from '../tailwind/tokens';
import type { DesignTokens } from '../tailwind/tokens';
import type { GenerationWarning, VirtualFile } from '../types';

/** The options for generating a component file. */
export interface ComponentOptions {
    /** Whether to generate Motion animations. */
    animations?: boolean;
    /** The design tokens to prefer over arbitrary values. */
    tokens?: DesignTokens;
    /** The prefix for imports of sibling components, relative to this file. */
    importPrefix?: string;
    /** The resolved asset paths (src URL → project path) from the asset registry. */
    assetPaths?: ReadonlyMap<string, string>;
    /**
     * The document's breakpoints (name → min-width). Responsive image swaps
     * emit `<source media>` per tier inside a `<picture>`, so the tier
     * thresholds must come from the source document — never assumed.
     */
    breakpoints?: ReadonlyMap<string, number>;
    /**
     * The output component name. When omitted it derives from the node name
     * (sections pass their deduplicated name; component files pass the
     * deduplicated component name so colliding names never share a file).
     */
    componentName?: string;
    /**
     * Original component name → deduplicated output name. Instance
     * references (JSX elements + imports) resolve through this map so they
     * always match the generated file names. Superseded by `componentById`
     * when the definition model is available.
     */
    componentNameMap?: ReadonlyMap<string, string>;
    /**
     * The component definition being generated (component files only). The
     * definition's body, props interface, and slots are the single source of
     * truth — the node argument is the definition body.
     */
    definition?: ComponentDefinition;
    /**
     * componentId → definition. Instance references resolve their slots and
     * output names through this map.
     */
    componentById?: ReadonlyMap<string, ComponentDefinition>;
    /**
     * Definition name → code-component import info. Code components live in
     * their own files (not src/components) and may be default exports, so
     * their imports resolve through this map instead of the standard
     * `{ Name } from '<prefix>Name'` form.
     */
    codeImports?: ReadonlyMap<string, { spec: string; isDefault: boolean }>;
    /** A shared warning collector (semantic issues during generation). */
    warnings?: GenerationWarning[];
}

/** Generate a React component file for a node. */
export function generateComponent(node: DesignNode, options: ComponentOptions = {}): VirtualFile {
    const definition = options.definition;
    const componentName = options.componentName ?? definition?.name ?? sanitizeComponentName(node.name);

    // A component instance renders its master template (text nodes carry prop
    // markers); a plain node renders itself. Definition files render the
    // definition body — the single implementation shared by all instances.
    const body = definition?.body ?? (node.type === 'component' && node.template ? node.template : node);
    const className = generateClasses(body, options.tokens).join(' ');
    const motionProps = options.animations ? generateMotionProps(body) : undefined;
    const hasMotion = usesMotionInTree(body, options.animations);
    const hasExit = hasExitInTree(body, options.animations);

    // Variant-marked template nodes render class sets switched by the variant
    // prop: one `variantClasses` record per marked node.
    const variantNodes = collectVariantNodes(body);
    const variantData = new Map<string, VariantRenderData>();
    const variantDecls = variantNodes
        .map((variantNode, index) => {
            const data = buildVariantData(variantNode, options.tokens);
            const recordName = index === 0 ? 'variantClassMap' : `variantClassMap${index + 1}`;
            const backgroundRecordName = index === 0 ? 'variantBackgroundMap' : `variantBackgroundMap${index + 1}`;
            variantData.set(variantNode.id, { ...data, recordName, backgroundRecordName });
            const decls = [variantRecordDecl(recordName, data.variants)];
            // Gradient members render per-variant inline backgrounds, not classes.
            if (Object.keys(data.backgrounds).length > 0) {
                decls.push(variantBackgroundDecl(backgroundRecordName, data.backgrounds));
            }
            return decls.join('\n\n');
        })
        .join('\n\n');

    // The props interface + destructuring. Definitions carry it explicitly;
    // legacy bodies derive it from the template's prop markers.
    const { markers, slotProps, variantDefaults } = definition
        ? definitionPropModel(definition)
        : legacyPropModel(body);
    const hasSlots = slotProps.length > 0;

    const componentRefs = collectComponentReferences(body, options);
    // Instances render token references (accent={colors.emerald500},
    // width={spacing[95]}) and color/length props are typed ColorValue,
    // RadiusValue, or SpacingValue — both sourced from the tokens module.
    // Instances only render references when tokens are available; otherwise
    // they fall back to literals and the imports would be unused.
    const instanceModules = options.tokens ? collectInstanceTokenModules(body) : new Set<string>();
    const tokenValues = ['colors', 'radii', 'spacing'].filter((module) => instanceModules.has(module));
    const tokenTypes = ['ColorValue', 'RadiusValue', 'SpacingValue', 'GradientValue'].filter((type) =>
        markers.some((marker) => marker.type === type),
    );
    const imports = buildImports(
        hasMotion,
        hasExit,
        hasSlots,
        componentRefs,
        tokenValues,
        tokenTypes,
        options.importPrefix ?? './',
        options.codeImports,
    );
    const renderOptions: RenderOptions = {
        ...options,
        variantData,
        assetPaths: options.assetPaths,
        componentNameMap: options.componentNameMap,
        componentById: options.componentById,
        slotPropNames: collectSlotPropNames(body),
        warnings: options.warnings,
    };
    const children = body.children.map((child) => renderNode(child, renderOptions)).join('\n');

    const props = buildProps(node, markers, slotProps);
    // Instance-only props (merged from instance values, no body marker) stay
    // in the interface but are not destructured — the body cannot reference
    // them and an unused destructured variable fails the generated project's
    // strict build.
    const instanceOnly = new Set(definition?.instanceProps ?? []);
    // A leaf-root component (image/text/vector) renders its OWN element with
    // the classes baked in. The consumer `className` is destructured like any
    // other prop and MERGED into that element (see renderElement), so it is
    // never an unused variable.
    const destructuredProps = buildDestructuredProps(
        markers.filter((marker) => !instanceOnly.has(marker.name)).map((marker) => marker.name),
        slotProps,
        variantDefaults,
    );

    const content = `${imports}
${
    variantDecls
        ? `${variantDecls}

`
        : ''
}interface ${componentName}Props {
    className?: string;
    ${props}
}

export function ${componentName}(${destructuredProps}: ${componentName}Props) {
    return (
        ${renderElement(body, componentName, className, children, hasMotion, motionProps, variantData, options.tokens, options.assetPaths, options.breakpoints)}
    );
}
`;

    // The caller (generateSection) overrides the path for sections; component
    // files live in src/components under the deduplicated output name.
    return {
        path: `src/components/${componentName}.tsx`,
        content,
    };
}

/** Check whether any node in the tree uses Motion (including descendants). */
function usesMotionInTree(node: DesignNode, enabled?: boolean): boolean {
    if (!enabled) return false;
    // Component instances render their own animations inside their component
    // file — they must not mark the parent tree as motion-using.
    if (node.type === 'component') return false;
    if (Object.keys(generateMotionProps(node)).length > 0) return true;
    return node.children.some((child) => usesMotionInTree(child, enabled));
}

/**
 * Collect the names of components referenced within a node tree (excluding
 * the node itself). Names resolve through the definition model (componentId
 * → definition) so imports always match the generated component files; the
 * legacy name map is the fallback for documents without definitions.
 */
function collectComponentReferences(node: DesignNode, options: RenderOptions | ComponentOptions): Set<string> {
    const refs = new Set<string>();
    const visit = (n: DesignNode): void => {
        if (n.type === 'component') {
            const name =
                options.componentById?.get(n.componentId)?.name ??
                options.componentNameMap?.get(n.componentName) ??
                sanitizeComponentName(n.componentName);
            refs.add(name);
            // Slot content renders inside this file — collect its references.
            // Templates are NOT descended into: a master's nested components
            // render inside the component's own file, never here.
            if (n.slots) {
                for (const slotNodes of Object.values(n.slots)) {
                    for (const slotNode of slotNodes) visit(slotNode);
                }
            }
        }
        for (const child of n.children) {
            visit(child);
        }
    };
    for (const child of node.children) {
        visit(child);
    }
    return refs;
}

/** Check whether any node in the tree has exit animations. */
function hasExitInTree(node: DesignNode, enabled?: boolean): boolean {
    if (!enabled || node.type === 'component') return false;
    const props = generateMotionProps(node);
    if (props.exit && Object.keys(props.exit).length > 0) return true;
    return node.children.some((child) => hasExitInTree(child, enabled));
}

/** Build the import statements for a component. */
function buildImports(
    hasMotion: boolean,
    hasExit: boolean,
    hasSlots: boolean,
    componentRefs: Set<string>,
    tokenValues: string[],
    tokenTypes: string[],
    importPrefix: string,
    codeImports?: ReadonlyMap<string, { spec: string; isDefault: boolean }>,
): string {
    const imports: string[] = [];

    if (hasSlots) {
        imports.push("import type { ReactNode } from 'react';");
    }

    if (hasExit) {
        imports.push("import { motion, AnimatePresence } from 'motion/react';");
    } else if (hasMotion) {
        imports.push("import { motion } from 'motion/react';");
    }

    // The tokens module lives at src/tokens.ts — one level up from both
    // src/components and src/sections. Only the parts actually used are
    // imported, so the generated files never carry unused imports.
    if (tokenValues.length > 0 || tokenTypes.length > 0) {
        const parts = [...tokenValues, ...tokenTypes.map((type) => `type ${type}`)];
        imports.push(`import { ${parts.join(', ')} } from '../tokens';`);
    }

    for (const ref of componentRefs) {
        const code = codeImports?.get(ref);
        if (code) {
            // Code components live in their own files and may be default
            // exports — the import form follows the module's actual export.
            imports.push(
                code.isDefault ? `import ${ref} from '${code.spec}';` : `import { ${ref} } from '${code.spec}';`,
            );
        } else {
            imports.push(`import { ${ref} } from '${importPrefix}${ref}';`);
        }
    }

    return imports.join('\n');
}

/** The prop model of a generated component (typed props + slot props). */
interface PropModel {
    /** The typed (non-slot) prop markers, in interface order. */
    markers: PropMarker[];
    /** The ReactNode slot prop names (children + named slots). */
    slotProps: string[];
    /** Prop name → default value (variant props). */
    variantDefaults: Record<string, string>;
}

/** The prop model of a definition (single source of truth for the interface). */
function definitionPropModel(definition: ComponentDefinition): PropModel {
    const markers: PropMarker[] = [];
    const slotProps: string[] = [];
    const variantDefaults: Record<string, string> = {};
    for (const [name, prop] of Object.entries(definition.props)) {
        markers.push({ name, type: propTypeToTs(prop.type, prop.values) });
        if (prop.type === 'union' && typeof prop.default === 'string') {
            variantDefaults[name] = prop.default;
        }
    }
    const seen = new Set<string>();
    for (const slot of definition.slots) {
        const propName = slotPropName(slot.name);
        if (!seen.has(propName)) {
            seen.add(propName);
            slotProps.push(propName);
        }
    }
    return { markers, slotProps, variantDefaults };
}

/** The prop model of a legacy body (derived from template prop markers). */
function legacyPropModel(body: DesignNode): PropModel {
    const { markers, variantDefaults } = collectPropMarkers(body);
    const slotProps: string[] = [];
    const seen = new Set<string>();
    const visit = (node: DesignNode): void => {
        if (node.type === 'slot') {
            const propName = slotPropName(node.slotName);
            if (!seen.has(propName)) {
                seen.add(propName);
                slotProps.push(propName);
            }
        }
        for (const child of node.children) {
            visit(child);
        }
    };
    visit(body);
    return { markers, slotProps, variantDefaults };
}

/** Build the props interface for a component. */
function buildProps(node: DesignNode, propMarkers: PropMarker[], slotProps: string[]): string {
    const props: string[] = [];

    // Template-driven props: one per prop marker in the template.
    if (propMarkers.length > 0) {
        for (const marker of propMarkers) {
            props.push(`${marker.name}?: ${marker.type};`);
        }
    } else if (node.type === 'component') {
        // Fallback for components declared in the source without a template:
        // infer the interface from the instance props.
        for (const [key, value] of Object.entries(node.props ?? {})) {
            const type = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';
            props.push(`${toVariableName(key)}?: ${type};`);
        }
    }

    // ReactNode props for the body's slot positions (children + named slots).
    for (const prop of slotProps) {
        if (!props.some((existing) => existing.startsWith(`${prop}?:`))) {
            props.push(`${prop}?: ReactNode;`);
        }
    }

    return props.join('\n    ');
}

/** Build the function-parameter destructuring for a component. */
function buildDestructuredProps(
    propNames: string[],
    slotProps: string[],
    variantDefaults: Record<string, string>,
): string {
    const parts = ['className'];
    for (const name of propNames) {
        parts.push(variantDefaults[name] !== undefined ? `${name} = '${variantDefaults[name]}'` : name);
    }
    for (const prop of slotProps) {
        parts.push(prop);
    }
    return `{ ${parts.join(', ')} }`;
}

/** A prop marker discovered in a component template. */
interface PropMarker {
    /** The prop name. */
    name: string;
    /** The TypeScript type of the prop. */
    type: string;
}

/** Style fields whose values are numeric (rendered as numeric inline styles). */
const NUMERIC_STYLE_FIELDS = new Set(['width', 'height', 'radius', 'opacity', 'borderWidth']);

/** Map an extraction style slot to its React/CSS inline-style property name. */
const STYLE_SLOT_TO_CSS: Record<string, string> = {
    backgroundColor: 'backgroundColor',
    borderColor: 'borderColor',
    borderWidth: 'borderWidth',
    radius: 'borderRadius',
    opacity: 'opacity',
    width: 'width',
    height: 'height',
    color: 'color',
};

/** Collect the prop markers referenced by a template (in walk order, deduplicated). */
function collectPropMarkers(node: DesignNode): { markers: PropMarker[]; variantDefaults: Record<string, string> } {
    const markers: PropMarker[] = [];
    const variantDefaults: Record<string, string> = {};
    const seen = new Set<string>();
    const visit = (n: DesignNode): void => {
        const prop = n.metadata?.custom?.prop;
        if (typeof prop === 'string' && !seen.has(prop)) {
            seen.add(prop);
            markers.push({ name: prop, type: 'string' });
        }
        const styleProps = n.metadata?.custom?.styleProps;
        if (styleProps && typeof styleProps === 'object') {
            for (const [field, name] of Object.entries(styleProps)) {
                if (typeof name === 'string' && !seen.has(name)) {
                    seen.add(name);
                    markers.push({
                        name,
                        type:
                            field === 'gradient'
                                ? 'GradientValue'
                                : COLOR_STYLE_FIELDS.has(field)
                                  ? 'ColorValue'
                                  : field === 'radius'
                                    ? 'RadiusValue'
                                    : NUMERIC_TOKEN_FIELDS.has(field)
                                      ? 'SpacingValue'
                                      : NUMERIC_STYLE_FIELDS.has(field)
                                        ? 'number'
                                        : 'string',
                    });
                }
            }
        }
        const variant = n.metadata?.custom?.variant;
        if (variant && typeof variant === 'object') {
            const marker = variant as VariantMarker;
            const name = marker.propName ?? 'variant';
            if (!seen.has(name)) {
                // Type the prop as a union of the actual variant values so
                // invalid variants are compile errors.
                const type =
                    marker.values.length > 0 ? marker.values.map((value) => `'${value}'`).join(' | ') : 'string';
                markers.push({ name, type });
                seen.add(name);
            }
            variantDefaults[name] = marker.default;
        }
        for (const child of n.children) {
            visit(child);
        }
    };
    visit(node);
    return { markers, variantDefaults };
}

/** The variant marker stored on a template node by the extraction pass. */
interface VariantMarker {
    /** The variant prop name. */
    propName: string;
    /** The default variant value (the canonical member's). */
    default: string;
    /** The variant values, aligned with `members`. */
    values: string[];
    /** The member nodes at this position (canonical first), children stripped. */
    members: DesignNode[];
}

/** The rendered data for a variant-marked node. */
interface VariantRenderData {
    /** The name of the variant class record (variantClassMap, variantClassMap2…). */
    recordName: string;
    /** The name of the variant background record (variantBackgroundMap…). */
    backgroundRecordName: string;
    /** The classes common to all variants. */
    common: string;
    /** Variant value → classes unique to that variant. */
    variants: Record<string, string>;
    /** Variant value → inline gradient background expression (gradient members only). */
    backgrounds: Record<string, string>;
}

/** Compute the common and per-variant class sets for a variant-marked node. */
function buildVariantData(
    node: DesignNode,
    tokens?: DesignTokens,
): { common: string; variants: Record<string, string>; backgrounds: Record<string, string> } {
    const marker = node.metadata?.custom?.variant as VariantMarker | undefined;
    if (!marker || marker.members.length === 0) {
        return { common: '', variants: {}, backgrounds: {} };
    }
    const classes: Record<string, string[]> = {};
    const backgrounds: Record<string, string> = {};
    for (let i = 0; i < marker.values.length; i += 1) {
        classes[marker.values[i]] = generateClasses(marker.members[i], tokens);
        // Solid members are class-driven; gradient members render a per-variant
        // inline background (the class set cannot express a gradient).
        const fill = marker.members[i].style.fills?.[0];
        if (fill && fill.type !== 'solid') {
            backgrounds[marker.values[i]] = gradientBackground(fill, tokens);
        }
    }
    const first = marker.values[0];
    const common = classes[first].filter((candidate) =>
        marker.values.every((value) => classes[value].includes(candidate)),
    );
    const commonSet = new Set(common);
    const variants: Record<string, string> = {};
    for (const value of marker.values) {
        variants[value] = classes[value].filter((candidate) => !commonSet.has(candidate)).join(' ');
    }
    return { common: common.join(' '), variants, backgrounds };
}

/** Collect variant-marked nodes in a template, in walk order. */
function collectVariantNodes(node: DesignNode): DesignNode[] {
    const nodes: DesignNode[] = [];
    const visit = (n: DesignNode): void => {
        if (n.metadata?.custom?.variant) nodes.push(n);
        for (const child of n.children) {
            visit(child);
        }
    };
    visit(node);
    return nodes;
}

/** Emit a `const variantClassMap: Record<string, string> = {...}` declaration. */
function variantRecordDecl(name: string, variants: Record<string, string>): string {
    const entries = Object.entries(variants)
        .map(([value, classes]) => `    '${value}': '${classes}',`)
        .join('\n');
    return `const ${name}: Record<string, string> = {\n${entries}\n};`;
}

/** Emit a `const variantBackgroundMap: Record<string, string> = {...}` declaration. */
function variantBackgroundDecl(name: string, backgrounds: Record<string, string>): string {
    const entries = Object.entries(backgrounds)
        .map(([value, background]) => `    '${value}': ${background},`)
        .join('\n');
    return `const ${name}: Record<string, string> = {\n${entries}\n};`;
}

/**
 * Build an inline `background` expression that renders a gradient from a prop
 * value (e.g. `accentGradient`) instead of a static fill. Stops are joined
 * directly — CSS distributes them evenly. The gradient function matches the
 * template node's fill type, which every member of a gradient-slot group
 * shares.
 */
function gradientFromProp(prop: string, fill?: Fill): string {
    // Each stop renders as `color position%` — positions are carried through
    // the prop so non-evenly spaced gradients stay exact. One decimal of
    // percent keeps common positions like 0.125 → 12.5% exact (whole-percent
    // rounding would render 12.5% as 13%).
    const stopsExpr = `\${${prop}.stops.map((s) => \`\${s.color} \${Math.round(s.position * 1000) / 10}%\`).join(', ')}`;
    if (fill?.type === 'radial') {
        return `\`radial-gradient(circle at \${(${prop}.center?.x ?? 0.5) * 100}% \${(${prop}.center?.y ?? 0.5) * 100}%, ${stopsExpr})\``;
    }
    return `\`linear-gradient(\${${prop}.angle ?? 0}deg, ${stopsExpr})\``;
}

/**
 * Build an inline `background` expression for a gradient fill.
 *
 * Stop colors reference the tokens module (`${colors.indigo500}`) when tokens
 * are available, so gradients compose with the design-token system; otherwise
 * they fall back to literal CSS colors.
 */
function gradientBackground(fill: Fill, tokens?: DesignTokens): string {
    // Callers only pass gradients, but narrowing requires the guard; empty
    // stops would produce invalid CSS (`linear-gradient(135deg, )`).
    if (fill.type === 'solid' || fill.type === 'image') return `''`;
    if (fill.stops.length === 0) return `''`;
    const stops: string[] = [];
    let hasRefs = false;
    for (const stop of fill.stops) {
        const color = tokens ? resolveColorName(stop.color, tokens) : undefined;
        const position = `${Math.round(stop.position * 100)}%`;
        stops.push(color ? `\${colors.${color}} ${position}` : `${normalizeColor(stop.color)} ${position}`);
        if (color) hasRefs = true;
    }
    const stopsText = stops.join(', ');
    const fn =
        fill.type === 'linear'
            ? `linear-gradient(${fill.angle}deg, ${stopsText})`
            : `radial-gradient(circle at ${Math.round(fill.center.x * 100)}% ${Math.round(fill.center.y * 100)}%, ${stopsText})`;
    return hasRefs ? `\`${fn}\`` : `'${fn}'`;
}

/** Render a variant-aware className attribute for a node. */
function renderVariantClassAttr(data: VariantRenderData, allowOverride: boolean): string {
    let content = `\${${data.recordName}[variant] ?? ''}`;
    if (data.common) content += ` ${data.common}`;
    if (allowOverride) content += `\${className ? \` \${className}\` : ''}`;
    return `className={\`${content}\`}`;
}

/** Escape a string for inclusion in a single-quoted JS string literal. */
function escapeInlineString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Render the inline style attribute for a node.
 *
 * Composes the prop-driven style fields (from the extraction pass) with an
 * inline `background` for gradient fills and image fills (which Tailwind
 * classes cannot express). Variant-marked nodes instead switch backgrounds
 * per-variant via their `variantBackgroundMap` record.
 */
function renderStyleAttrs(
    node: DesignNode,
    tokens?: DesignTokens,
    variant?: VariantRenderData,
    assetPaths?: ReadonlyMap<string, string>,
): string {
    const entries: string[] = [];
    if (variant) {
        if (Object.keys(variant.backgrounds).length > 0) {
            entries.push(`background: \${${variant.backgroundRecordName}[variant] ?? undefined}`);
        }
    } else {
        const styleProps = node.metadata?.custom?.styleProps;
        const gradientProp =
            styleProps && typeof styleProps === 'object'
                ? (styleProps as Record<string, unknown>)['gradient']
                : undefined;
        if (typeof gradientProp === 'string') {
            // Prop-driven gradient: render the CSS from the prop value. The
            // gradient function matches the template's fill type (members in a
            // gradient-slot group always share the fill type). The ternary
            // guards the optional prop (and narrows it) so the generated code
            // compiles under strict null checks.
            entries.push(
                `background: ${gradientProp} ? ${gradientFromProp(gradientProp, node.style.fills?.[0])} : undefined`,
            );
        } else {
            const fill = node.style.fills?.[0];
            if (fill && fill.type !== 'solid') {
                if (fill.type === 'image') {
                    // A responsive image-fill swap overrides `background-image`
                    // per tier in responsive.css — but an INLINE base style
                    // would beat every stylesheet rule (inline > class, no
                    // matter the cascade), so the swap would never apply. When
                    // the frame carries image overrides, the base fill is
                    // emitted as a base-tier rule by generateResponsiveCss
                    // instead of inline (the reference renderer does the same).
                    if (!hasResponsiveImageOverrides(node)) {
                        // Image fill → CSS background-image. Resolved through
                        // the asset registry so the reference always points at
                        // a real file inside the project.
                        const imgSrc = imageFillSrc(fill.image, assetPaths);
                        entries.push(`backgroundImage: \`url('${imgSrc}')\``);
                        entries.push(`backgroundSize: 'cover'`);
                        entries.push(`backgroundPosition: '${fill.image.objectPosition ?? 'center'}'`);
                    }
                } else {
                    entries.push(`background: ${gradientBackground(fill, tokens)}`);
                }
            }
        }
        if (node.style.shadows && node.style.shadows.length > 0) {
            const shadowStrs = node.style.shadows.map((s) => {
                const inset = s.inset ? 'inset ' : '';
                return `${inset}${s.offsetX}px ${s.offsetY}px ${s.blur}px ${s.spread}px ${s.color}`;
            });
            entries.push(`boxShadow: '${shadowStrs.join(', ')}'`);
        }
        if (node.style.filters && node.style.filters.length > 0) {
            const filterStrs = node.style.filters
                .map((f) => {
                    if (f.type === 'blur') return `blur(${f.radius}px)`;
                    if ('amount' in f) return `${f.type}(${f.amount})`;
                    if ('angle' in f) return `${f.type}(${f.angle}deg)`;
                    return '';
                })
                .filter(Boolean);
            if (filterStrs.length > 0) {
                entries.push(`filter: '${filterStrs.join(' ')}'`);
            }
        }
        if (node.style.transform) {
            // CSS transform as an exact inline style (Tailwind classes cannot
            // compose rotate + scale + translate without arbitrary complexity).
            const t = node.style.transform;
            const transformParts: string[] = [];
            if (t.rotate !== undefined && t.rotate !== 0) transformParts.push(`rotate(${t.rotate}deg)`);
            if (t.scaleX !== undefined && t.scaleX !== 1) transformParts.push(`scaleX(${t.scaleX})`);
            if (t.scaleY !== undefined && t.scaleY !== 1) transformParts.push(`scaleY(${t.scaleY})`);
            if (t.skewX !== undefined && t.skewX !== 0) transformParts.push(`skewX(${t.skewX}deg)`);
            if (t.skewY !== undefined && t.skewY !== 0) transformParts.push(`skewY(${t.skewY}deg)`);
            if (t.translateX !== undefined && t.translateX !== 0) transformParts.push(`translateX(${t.translateX}px)`);
            if (t.translateY !== undefined && t.translateY !== 0) transformParts.push(`translateY(${t.translateY}px)`);
            if (transformParts.length > 0) {
                entries.push(`transform: '${transformParts.join(' ')}'`);
            }
        }
        if (styleProps && typeof styleProps === 'object') {
            for (const [field, prop] of Object.entries(styleProps)) {
                if (typeof prop !== 'string' || field === 'gradient') continue;
                const cssProperty = STYLE_SLOT_TO_CSS[field] ?? field;
                entries.push(`${cssProperty}: ${prop}`);
            }
        }
    }
    // Cursor — forwarded verbatim from the SDK as an arbitrary CSS string.
    // Tailwind only has named utilities (`cursor-pointer`, `cursor-grab`...)
    // so exact strings are emitted inline to preserve designer intent.
    if (node.style.cursor) {
        entries.push(`cursor: '${escapeInlineString(node.style.cursor)}'`);
    }
    // Image rendering hint (`auto`, `crisp-edges`, `pixelated`) — Tailwind
    // does not cover this utility, so we emit it verbatim inline.
    if (node.style.imageRendering) {
        entries.push(`imageRendering: '${escapeInlineString(node.style.imageRendering)}'`);
    }
    // Grid column / row sizes — emit `grid-template-columns: repeat(N, Xpx)`
    // so Framer's "auto-fill with fixed column width" setup renders faithfully.
    if (node.layout?.style?.strategy === 'grid') {
        const gl = node.layout.style;
        if (gl.columnWidth !== undefined && gl.columnWidth > 0) {
            const cols = typeof gl.columns === 'number' ? gl.columns : 1;
            entries.push(`gridTemplateColumns: 'repeat(${cols}, ${gl.columnWidth}px)'`);
        }
        if (gl.rowHeight !== undefined && gl.rowHeight > 0) {
            const rows = typeof gl.rows === 'number' ? gl.rows : 1;
            entries.push(`gridTemplateRows: 'repeat(${rows}, ${gl.rowHeight}px)'`);
        }
    }
    if (entries.length === 0) return '';
    return ` style={{ ${entries.join(', ')} }}`;
}

/** Collect slot node ids → rendered prop names (`{children}` / `{slotName}`). */
function collectSlotPropNames(node: DesignNode): Map<string, string> {
    const byId = new Map<string, string>();
    for (const slot of collectBodySlots(node)) {
        if (!byId.has(slot.nodeId)) byId.set(slot.nodeId, slotPropName(slot.name));
    }
    return byId;
}

/** The render options threaded through the JSX renderers. */
interface RenderOptions {
    /** Whether to generate Motion animations. */
    animations?: boolean;
    /** The design tokens to prefer over arbitrary values. */
    tokens?: DesignTokens;
    /** Variant render data keyed by template node id. */
    variantData?: Map<string, VariantRenderData>;
    /** The resolved asset paths (src URL → project path) from the asset registry. */
    assetPaths?: ReadonlyMap<string, string>;
    /** The document's breakpoints (name → min-width) for `<source media>` tiers. */
    breakpoints?: ReadonlyMap<string, number>;
    /**
     * Whether a consumer-passed `className` prop must be MERGED into the
     * element's baked-in classes (leaf-root components only — they have no
     * wrapper element of their own to receive the prop).
     */
    mergeConsumerClassName?: boolean;
    /** Original component name → deduplicated output name. */
    componentNameMap?: ReadonlyMap<string, string>;
    /** componentId → definition (slot names + output names for instances). */
    componentById?: ReadonlyMap<string, ComponentDefinition>;
    /** Slot node id → rendered prop name. */
    slotPropNames?: ReadonlyMap<string, string>;
    /** A shared warning collector (semantic issues during generation). */
    warnings?: GenerationWarning[];
}

/** Render a node as JSX. */
function renderNode(node: DesignNode, options: RenderOptions): string {
    const className = generateClasses(node, options.tokens).join(' ');
    const motionProps = options.animations ? generateMotionProps(node) : undefined;
    const hasMotion = Boolean(motionProps && Object.keys(motionProps).length > 0);

    switch (node.type) {
        case 'text':
            return renderTextNode(
                node,
                className,
                options.tokens,
                hasMotion,
                motionProps,
                options.assetPaths,
                options.mergeConsumerClassName,
            );
        case 'image':
            return renderImageNode(
                node,
                className,
                options.tokens,
                hasMotion,
                motionProps,
                options.assetPaths,
                options.breakpoints,
                options.mergeConsumerClassName,
            );
        case 'vector':
            return renderVectorNode(
                node,
                className,
                options.tokens,
                hasMotion,
                motionProps,
                options.assetPaths,
                options.mergeConsumerClassName,
            );
        case 'component':
            return renderComponentNode(node, className, options);
        case 'slot': {
            const propName = options.slotPropNames?.get(node.id) ?? 'children';
            // A master-authored slot placeholder may carry DEFAULT content
            // (shown when a consumer passes nothing). Preserve it: content
            // wins when passed, the master's placeholder renders otherwise.
            if (node.children.length > 0) {
                const defaultContent = node.children.map((child) => renderNode(child, options)).join('\n');
                return `{${propName} ?? <>\n${indentChildren(defaultContent)}\n</>}`;
            }
            return `{${propName}}`;
        }
        case 'frame':
        case 'group':
        default:
            return renderContainerNode(node, options);
    }
}

/**
 * A className attribute that MERGES the consumer-passed `className` prop into
 * the element's baked-in classes (instead of replacing them). Leaf-root
 * components (image/text/vector) have no wrapper element of their own, so the
 * prop must land on their own element — and its classes must survive. When
 * there are no baked classes the prop is passed through directly.
 */
function renderMergedClassAttr(classes: string): string {
    if (!classes) return 'className={className}';
    return `className={\`${classes}\${className ? \` \${className}\` : ''}\`}`;
}

/** Render a text node as JSX. */
function renderTextNode(
    node: DesignNode,
    className: string,
    tokens?: DesignTokens,
    hasMotion?: boolean,
    motionProps?: MotionProps,
    assetPaths?: ReadonlyMap<string, string>,
    mergeConsumerClassName?: boolean,
): string {
    if (node.type !== 'text') return '';
    const baseTag = node.text.style.fontSize !== undefined && node.text.style.fontSize >= 32 ? 'h2' : 'p';
    const tag = hasMotion ? `motion.${baseTag}` : baseTag;
    const motionAttrs = hasMotion ? formatMotionAttrs(motionProps) : '';
    const styleAttrs = renderStyleAttrs(node, tokens, undefined, assetPaths);
    const classAttr = mergeConsumerClassName ? renderMergedClassAttr(className) : `className="${className}"`;

    // Template-driven text renders a prop interpolation instead of static text.
    const prop = node.metadata?.custom?.prop;
    const content = typeof prop === 'string' ? `{${prop}}` : escapeJsx(node.text.text);
    return `<${tag} ${classAttr}${styleAttrs}${motionAttrs}>${content}</${tag}>`;
}

/**
 * Resolve the src for an image asset.
 *
 * Precedence: the asset registry's assigned path (the single source of truth,
 * collision-safe and deduplicated) → the legacy name-derived path for binary
 * data → the remote URL as a runtime reference (reported as a warning by the
 * validator).
 */
function imageAssetSrc(
    asset: import('@framer/compiler-ast').AssetRef,
    assetPaths?: ReadonlyMap<string, string>,
): string {
    const resolved = assetPaths?.get(asset.src);
    if (resolved) return toReferencePath(resolved);
    if (asset.data) {
        const ext = asset.src.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/)?.[1] ?? 'png';
        const name = (asset.name ?? 'image').replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
        return `/assets/images/${name}.${ext}`;
    }
    return asset.src;
}

/**
 * Convert a project-root asset path to a reference usable from the generated
 * code. `public/` files become ABSOLUTE URLs (`/assets/images/x.png`): Vite
 * serves `public/` at the root in dev AND copies it verbatim into `dist/`, so
 * the same reference works in the source tree and the production build — a
 * relative `../assets/...` would resolve outside `dist/` and 404. (Fonts
 * already follow this pattern: `public/fonts` + `url('/fonts/x.woff2')`.)
 */
function toReferencePath(projectPath: string): string {
    if (projectPath.startsWith('public/')) return `/${projectPath.slice('public/'.length)}`;
    if (projectPath.startsWith('src/')) return `../${projectPath.slice('src/'.length)}`;
    return projectPath;
}

/**
 * Whether a node's responsive behavior swaps its image fill on any tier
 * (a frame's `background-image` — standalone `<img>` swaps are JSX `<picture>`
 * tiers and do not affect the inline style).
 */
function hasResponsiveImageOverrides(node: DesignNode): boolean {
    const behavior = node.layout.responsive;
    if (!behavior?.breakpoints) return false;
    return Object.values(behavior.breakpoints).some((override) => Boolean(override?.image));
}

/**
 * Resolve the src for an image fill through the asset registry, falling back
 * to the legacy name-derived path or the remote URL.
 */
function imageFillSrc(
    image: import('@framer/compiler-shared').ImageFillRef,
    assetPaths?: ReadonlyMap<string, string>,
): string {
    const resolved = assetPaths?.get(image.src);
    if (resolved) return toReferencePath(resolved);
    if (image.data && image.src) {
        const ext = image.src.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/)?.[1] ?? 'png';
        const name = (image.name ?? 'image').replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
        return `/assets/images/${name}.${ext}`;
    }
    return image.src;
}

/** Render an image node as JSX. */
function renderImageNode(
    node: DesignNode,
    className: string,
    tokens?: DesignTokens,
    hasMotion?: boolean,
    motionProps?: MotionProps,
    assetPaths?: ReadonlyMap<string, string>,
    breakpoints?: ReadonlyMap<string, number>,
    mergeConsumerClassName?: boolean,
): string {
    if (node.type !== 'image') return '';
    const src = imageAssetSrc(node.asset, assetPaths);
    const alt = node.asset.alt ?? node.name;
    const objectFit = node.objectFit ?? 'cover';
    const tag = hasMotion ? 'motion.img' : 'img';
    const motionAttrs = hasMotion ? formatMotionAttrs(motionProps) : '';
    const styleAttrs = renderStyleAttrs(node, tokens, undefined, assetPaths);
    const imgClasses = `${className} object-${objectFit}`;
    const classAttr = mergeConsumerClassName ? renderMergedClassAttr(imgClasses) : `className="${imgClasses}"`;
    const img = `<${tag} src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" ${classAttr}${styleAttrs}${motionAttrs} />`;

    // Responsive image swaps fold into the responsive model as per-breakpoint
    // image overrides. A <picture> element with one <source media> per tier
    // swaps the rendered image natively — unlike content: url() (which drops
    // object-fit on the content-replaced image), the <img> keeps its
    // `object-<fit>` class at every tier. The <picture> box is display:
    // contents (see index.css) so the <img> stays the layout element (flex
    // item / positioned box) exactly as before the swap existed.
    const responsiveTiers = responsiveImageTiers(node, breakpoints);
    if (responsiveTiers.length === 0) return img;

    const sources = responsiveTiers
        .map(
            ({ minWidth, src: tierSrc }) =>
                `    <source media="(min-width: ${minWidth}px)" srcSet="${escapeAttr(responsiveImageSrc(tierSrc, assetPaths))}" />`,
        )
        .join('\n');
    return `<picture>\n${sources}\n${indentChildren(img)}\n</picture>`;
}

/**
 * The tiers where a node swaps its image, DESCENDING by min-width. Browsers
 * select the FIRST `<source>` whose media query matches (tree order), so the
 * largest breakpoint must come first — otherwise a tablet source would shadow
 * the desktop one. Each tier resolves through the asset registry so the
 * `<source srcSet>` references the same local file the base `<img>` uses.
 */
function responsiveImageTiers(
    node: DesignNode,
    breakpoints?: ReadonlyMap<string, number>,
): Array<{ minWidth: number; src: string }> {
    const behavior = node.layout.responsive;
    if (!behavior?.breakpoints) return [];
    const tiers: Array<{ minWidth: number; src: string }> = [];
    for (const [breakpointName, override] of Object.entries(behavior.breakpoints)) {
        const src = override?.image?.src;
        if (!src) continue;
        // A tier whose breakpoint is not in the document scale cannot be
        // placed — skip it. `(min-width: 0px)` would match EVERY viewport and,
        // as the last source in tree order, shadow the <img> fallback
        // everywhere: the wrong image at every size. A real min-width-0
        // breakpoint still resolves (the map returns 0, not undefined).
        // Case-insensitive: tier names come from the canvas (e.g. 'Desktop')
        // while the scale may spell them differently (e.g. 'desktop').
        const minWidth = breakpoints ? breakpointMinWidth(breakpoints, breakpointName) : undefined;
        if (minWidth === undefined) continue;
        tiers.push({ minWidth, src });
    }
    return tiers.sort((a, b) => b.minWidth - a.minWidth);
}

/** Resolve an override image's source URL through the asset registry. */
function responsiveImageSrc(src: string, assetPaths?: ReadonlyMap<string, string>): string {
    const resolved = assetPaths?.get(src);
    if (resolved) return toReferencePath(resolved);
    return src;
}

/** Render a vector node as JSX. */
function renderVectorNode(
    node: DesignNode,
    className: string,
    tokens?: DesignTokens,
    hasMotion?: boolean,
    motionProps?: MotionProps,
    assetPaths?: ReadonlyMap<string, string>,
    mergeConsumerClassName?: boolean,
): string {
    if (node.type !== 'vector') return '';
    const styleAttrs = renderStyleAttrs(node, tokens, undefined, assetPaths);
    const motionAttrs = hasMotion ? formatMotionAttrs(motionProps) : '';
    const tag = hasMotion ? 'motion.div' : 'div';
    const classAttr = mergeConsumerClassName ? renderMergedClassAttr(className) : `className="${className}"`;
    if (node.svg) {
        let svg = node.svg.trim();
        if (svg.startsWith('<svg') && !hasMotion) {
            return svg.replace(/^<svg([^>]*)>/, (_, attrs) => `<svg ${classAttr}${styleAttrs}${attrs}>`);
        }
        return `<${tag} ${classAttr}${styleAttrs}${motionAttrs} dangerouslySetInnerHTML={{ __html: ${JSON.stringify(node.svg)} }} />`;
    }
    if (node.asset?.src) {
        const src = imageAssetSrc(node.asset, assetPaths);
        const imgTag = hasMotion ? 'motion.img' : 'img';
        return `<${imgTag} src="${escapeAttr(src)}" alt="${escapeAttr(node.name)}" ${classAttr}${styleAttrs}${motionAttrs} />`;
    }
    if (node.pathData) {
        const w = Math.round(node.frame.width || 24);
        const h = Math.round(node.frame.height || 24);
        const svgTag = hasMotion ? 'motion.svg' : 'svg';
        return `<${svgTag} viewBox="0 0 ${w} ${h}" ${classAttr}${styleAttrs}${motionAttrs}><path d="${escapeAttr(node.pathData)}" fill="currentColor" /></${svgTag}>`;
    }
    return `<${tag} ${classAttr}${styleAttrs}${motionAttrs} />`;
}

/** Render a component node as JSX. */
function renderComponentNode(node: DesignNode, className: string, options: RenderOptions): string {
    if (node.type !== 'component') return '';
    const definition =
        options.componentById?.get(node.componentId) ?? options.componentById?.get(node.metadata?.sourceId ?? '');
    const name =
        definition?.name ??
        options.componentNameMap?.get(node.componentName) ??
        sanitizeComponentName(node.componentName);
    const colorProps = options.tokens ? collectTemplateColorProps(node.template) : null;
    const numericProps = options.tokens ? collectTemplateNumericProps(node.template) : null;
    const gradientProps = options.tokens ? collectTemplateGradientProps(node.template) : null;
    const props = Object.entries(node.props ?? {})
        .map(([key, value]) => {
            const propName = toVariableName(key);
            // Color-style props render as token references (accent={colors.emerald500}).
            if (typeof value === 'string' && colorProps?.has(key)) {
                const colorName = resolveColorName(value, options.tokens);
                if (colorName) return `${propName}={colors.${colorName}}`;
            }
            // Numeric length props render as token references (radius={radii[20]},
            // width={spacing[95]}); opacity and other numbers stay raw.
            if (typeof value === 'number') {
                const field = numericProps?.get(key);
                if (field !== undefined) {
                    const module = NUMERIC_TOKEN_MODULES[field];
                    if (module === 'radii') return `${propName}={radii[${value}]}`;
                    return `${propName}={spacing[${pxToTailwindSpacing(value)}]}`;
                }
                return `${propName}={${value}}`;
            }
            if (typeof value === 'string') return `${propName}="${escapeAttr(value)}"`;
            if (typeof value === 'boolean') return `${propName}={${value}}`;
            // Gradient props render as object literals with token refs
            // (accentGradient={{ angle: 135, stops: [colors.indigo500, …] }}).
            if (gradientProps?.has(key) && typeof value === 'object' && value !== null) {
                return `${propName}={${renderGradientPropValue(value, options.tokens)}}`;
            }
            return `${propName}={${JSON.stringify(value)}}`;
        })
        .join(' ');
    // Named slot content passes as JSX expression props (`content={<Button />}`),
    // rendered at the matching slot node in the component body.
    const slotAttrs: string[] = [];
    if (definition) {
        for (const [slotName, slotNodes] of Object.entries(node.slots ?? {})) {
            if (slotNodes.length === 0) continue;
            if (!definition.slots.some((slot) => slot.name === slotName)) {
                options.warnings?.push({
                    stage: 'components',
                    nodeId: node.id,
                    message: `Instance of ${name} carries slot content '${slotName}' but its definition body declares no slot with that name — the content is not rendered.`,
                });
                continue;
            }
            const jsx =
                slotNodes.length === 1
                    ? renderNode(slotNodes[0], options)
                    : `<>\n${indentChildren(slotNodes.map((slotNode) => renderNode(slotNode, options)).join('\n'))}\n</>`;
            slotAttrs.push(`${slotPropName(slotName)}={${jsx}}`);
        }
    }
    const allAttrs = [props, ...slotAttrs].filter(Boolean).join(' ');
    const attrsAttr = allAttrs ? ` ${allAttrs}` : '';

    // Instance-specific children (default slot content) are passed as React
    // children; the component body renders them at its children slot node.
    const instanceChildren = node.children.map((child) => renderNode(child, options)).join('\n');
    const hasInstanceChildren = instanceChildren.trim().length > 0;

    // Code-backed instances render as references with their real props. The
    // component's own source decides where children render — React ignores
    // children a component does not render, so passing them is always safe.
    if (definition?.code) {
        if (hasInstanceChildren) {
            // Shared module components (Framer's published-bundle contract)
            // receive canvas content as a `slots` array prop — the bundles
            // destructure `slots` from props. Pass BOTH forms: `slots={[...]}`
            // (the module contract) and JSX children (the React convention) —
            // the component reads whichever it was authored against, and one
            // that ignores the other never mounts it.
            const moduleSlots = definition.code.isModule ? ` slots={[<>${indentChildren(instanceChildren)}</>]}` : '';
            return `<${name}${attrsAttr}${moduleSlots}>\n${indentChildren(instanceChildren)}\n</${name}>`;
        }
        return `<${name}${attrsAttr} />`;
    }

    // Definition-driven instances render as references: props + slot content.
    if (definition) {
        if (hasInstanceChildren && !definition.slots.some((slot) => slot.name === 'children' || slot.name === '')) {
            options.warnings?.push({
                stage: 'components',
                nodeId: node.id,
                message: `Instance of ${name} carries children but its definition body declares no children slot — the children are passed but have no position to render into.`,
            });
        }
        if (hasInstanceChildren) {
            return `<${name}${attrsAttr}>\n${indentChildren(instanceChildren)}\n</${name}>`;
        }
        return `<${name}${attrsAttr} />`;
    }

    // Legacy instances (no definition model): render the resolved body.
    if (node.template) return `<${name} ${props} />`;
    if (!hasInstanceChildren) return `<${name} ${props} className="${className}" />`;
    return `<${name} ${props} className="${className}">\n${indentChildren(instanceChildren)}\n</${name}>`;
}

/** Indent rendered children for a multi-line JSX block. */
function indentChildren(children: string): string {
    return children
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n');
}

/** The tokens-module objects referenced by instances in a tree (colors/radii/spacing). */
/** Whether a fill is a gradient (linear/radial). Image fills render as
 * `backgroundImage` with NO token refs, so they must not count here. */
function isGradientFill(fill: Fill | undefined): boolean {
    return Boolean(fill && (fill.type === 'linear' || fill.type === 'radial'));
}

/** Whether a node renders a gradient (its own fill or a variant member's). */
function rendersGradient(node: DesignNode): boolean {
    // Prop-driven gradients render from the prop value, not with token refs in
    // this file — the static fill is only a fallback shape marker.
    const styleProps = node.metadata?.custom?.styleProps;
    const gradientProp =
        styleProps && typeof styleProps === 'object' ? (styleProps as Record<string, unknown>)['gradient'] : undefined;
    const fill = node.style.fills?.[0];
    if (typeof gradientProp !== 'string' && isGradientFill(fill)) return true;
    const variant = node.metadata?.custom?.variant;
    if (variant && typeof variant === 'object') {
        const members = (variant as { members?: DesignNode[] }).members;
        for (const member of members ?? []) {
            if (isGradientFill(member.style.fills?.[0])) return true;
        }
    }
    return false;
}

/** The tokens-module objects referenced by instances in a tree (colors/radii/spacing). */
function collectInstanceTokenModules(node: DesignNode): Set<string> {
    const modules = new Set<string>();
    const visit = (n: DesignNode): void => {
        // Gradient fills render as `background: \`…${colors.X}…\`` inline styles.
        if (rendersGradient(n)) modules.add('colors');
        if (n.type === 'component' && n.template) {
            const colorProps = collectTemplateColorProps(n.template);
            if (Object.keys(n.props ?? {}).some((key) => colorProps.has(key))) modules.add('colors');
            const gradientProps = collectTemplateGradientProps(n.template);
            if (Object.keys(n.props ?? {}).some((key) => gradientProps.has(key))) modules.add('colors');
            const numericProps = collectTemplateNumericProps(n.template);
            for (const [key, field] of numericProps) {
                if (typeof n.props?.[key] === 'number') modules.add(NUMERIC_TOKEN_MODULES[field]);
            }
            visit(n.template);
            return;
        }
        for (const child of n.children) {
            visit(child);
        }
    };
    visit(node);
    return modules;
}

/** Resolve a color value to its tokens-module name (undefined if unknown). */
function resolveColorName(value: string, tokens?: DesignTokens): string | undefined {
    if (!tokens) return undefined;
    return tokens.colorNames[normalizeColor(value)];
}

/** Render a gradient prop value as a JSX object literal with token refs. */
function renderGradientPropValue(value: unknown, tokens?: DesignTokens): string {
    const gradient = value as { angle?: number; center?: { x: number; y: number }; stops?: unknown[] };
    const stops = (gradient.stops ?? [])
        .filter(
            (stop): stop is { color: unknown; position: unknown } =>
                typeof stop === 'object' && stop !== null && 'color' in stop && 'position' in stop,
        )
        .map((stop) => {
            const color = typeof stop.color === 'string' ? stop.color : '';
            const name = tokens ? resolveColorName(color, tokens) : undefined;
            const colorRef = name ? `colors.${name}` : `'${normalizeColor(color)}'`;
            return `{ color: ${colorRef}, position: ${stop.position} }`;
        });
    const parts: string[] = [];
    if (stops.length > 0) parts.push(`stops: [${stops.join(', ')}]`);
    if (gradient.angle !== undefined) parts.push(`angle: ${gradient.angle}`);
    if (gradient.center !== undefined) parts.push(`center: { x: ${gradient.center.x}, y: ${gradient.center.y} }`);
    return `{ ${parts.join(', ')} }`;
}

/** Render a container node as JSX. */
function renderContainerNode(node: DesignNode, options: RenderOptions): string {
    const className = generateClasses(node, options.tokens).join(' ');
    const motionProps = options.animations ? generateMotionProps(node) : undefined;
    const hasMotion = Boolean(motionProps && Object.keys(motionProps).length > 0);
    const children = node.children.map((child) => renderNode(child, options)).join('\n');

    const variant = options.variantData?.get(node.id);
    const classAttr = variant ? renderVariantClassAttr(variant, false) : `className="${className}"`;
    const sourceTag = node.type === 'frame' && node.isSection ? 'section' : 'div';
    const link = firstLinkInteraction(node);
    const tag = link ? 'a' : sourceTag;
    const motionAttrs = hasMotion ? formatMotionAttrs(motionProps) : '';
    const styleAttrs = renderStyleAttrs(node, options.tokens, variant, options.assetPaths);
    const tagName = hasMotion ? `motion.${tag}` : tag;

    return `<${tagName} ${classAttr}${linkAttrs(link)}${styleAttrs}${motionAttrs}>
    ${children}
</${tagName}>`;
}

/** Render the root element of a component. */
function renderElement(
    node: DesignNode,
    componentName: string,
    className: string,
    children: string,
    hasMotion: boolean,
    motionProps: MotionProps | undefined,
    variantData?: Map<string, VariantRenderData>,
    tokens?: DesignTokens,
    assetPaths?: ReadonlyMap<string, string>,
    breakpoints?: ReadonlyMap<string, number>,
): string {
    // Leaf roots (text/image/vector) must render as their own element — never
    // drop them into an empty container div. They have no wrapper element to
    // receive a consumer `className`, so the leaf renderers MERGE the prop
    // into their baked-in classes.
    if (node.type === 'image' || node.type === 'text' || node.type === 'vector') {
        return renderNode(node, {
            animations: hasMotion,
            tokens,
            variantData,
            assetPaths,
            breakpoints,
            mergeConsumerClassName: true,
        });
    }

    const sourceTag = node.type === 'frame' && node.isSection ? 'section' : 'div';
    const link = firstLinkInteraction(node);
    const tag = link ? 'a' : sourceTag;
    const motionAttrs = hasMotion ? formatMotionAttrs(motionProps) : '';
    const variant = variantData?.get(node.id);
    const styleAttrs = renderStyleAttrs(node, tokens, variant, assetPaths);
    const tagName = hasMotion ? `motion.${tag}` : tag;

    // A consumer `className` MERGES into the baked-in classes (never replaces
    // them — replacement would silently drop the layout classes). This matches
    // the leaf-root merge and the variant attribute, which already appends.
    const classAttr = variant ? renderVariantClassAttr(variant, true) : renderMergedClassAttr(className);

    return `<${tagName} ${classAttr}${linkAttrs(link)}${styleAttrs}${motionAttrs}>
    ${children}
</${tagName}>`;
}

/** The first navigation link carried by a node's interaction state. */
function firstLinkInteraction(node: DesignNode): { url: string; newTab?: boolean } | undefined {
    for (const interactions of [
        node.interactions?.onClick,
        node.interactions?.onHover,
        node.interactions?.onFocus,
        node.interactions?.onMount,
    ]) {
        const link = interactions?.find((interaction) => interaction.type === 'link');
        if (link && link.type === 'link') return link;
    }
    return undefined;
}

/** Render a link interaction as real anchor attributes. */
function linkAttrs(link?: { url: string; newTab?: boolean }): string {
    if (!link) return '';
    const target = link.newTab ? ' target="_blank" rel="noreferrer"' : '';
    return ` href="${escapeAttr(link.url)}"${target}`;
}

/** Format Motion props as JSX attributes. */
function formatMotionAttrs(props?: MotionProps): string {
    if (!props) return '';
    const attrs: string[] = [];
    for (const [key, value] of Object.entries(props)) {
        if (value === undefined) continue;
        attrs.push(`${key}={${JSON.stringify(value)}}`);
    }
    return attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
}

/** Escape text for safe inclusion in JSX. */
function escapeJsx(text: string): string {
    const amp = '\u0026';
    return text
        .replace(/&/g, `${amp}amp;`)
        .replace(/</g, `${amp}lt;`)
        .replace(/>/g, `${amp}gt;`)
        .replace(/{/g, `${amp}#123;`)
        .replace(/}/g, `${amp}#125;`);
}

/** Escape an attribute value for safe inclusion in JSX. */
function escapeAttr(value: string): string {
    const amp = '\u0026';
    return value
        .replace(/&/g, `${amp}amp;`)
        .replace(/"/g, `${amp}quot;`)
        .replace(/</g, `${amp}lt;`)
        .replace(/>/g, `${amp}gt;`);
}
