/**
 * Design AST node → React component generation.
 */

import type { DesignNode } from '@framer/compiler-ast';
import type { Fill } from '@framer/compiler-shared';
import { normalizeColor, pxToTailwindSpacing, sanitizeComponentName, toVariableName } from '@framer/compiler-shared';

import { generateMotionProps, type MotionProps } from '../motion/animation';
import { generateClasses } from '../tailwind/classes';
import { COLOR_STYLE_FIELDS, NUMERIC_TOKEN_FIELDS, NUMERIC_TOKEN_MODULES, collectTemplateColorProps, collectTemplateGradientProps, collectTemplateNumericProps } from '../tailwind/tokens';
import type { DesignTokens } from '../tailwind/tokens';
import type { VirtualFile } from '../types';

/** The options for generating a component file. */
export interface ComponentOptions {
    /** Whether to generate Motion animations. */
    animations?: boolean;
    /** The design tokens to prefer over arbitrary values. */
    tokens?: DesignTokens;
    /** The prefix for imports of sibling components, relative to this file. */
    importPrefix?: string;
}

/** Generate a React component file for a node. */
export function generateComponent(node: DesignNode, options: ComponentOptions = {}): VirtualFile {
    const componentName = sanitizeComponentName(node.name);

    // A component instance renders its master template (text nodes carry prop
    // markers); a plain node renders itself.
    const body = node.type === 'component' && node.template ? node.template : node;
    const className = generateClasses(body, options.tokens).join(' ');
    const motionProps = options.animations ? generateMotionProps(body) : undefined;
    const hasMotion = usesMotionInTree(body, options.animations);

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

    const componentRefs = collectComponentReferences(body);
    const hasSlots = treeHasSlots(body);
    const { markers, variantDefaults } = collectPropMarkers(body);
    // Instances render token references (accent={colors.emerald500},
    // width={spacing[95]}) and color/length props are typed ColorValue,
    // RadiusValue, or SpacingValue — both sourced from the tokens module.
    // Instances only render references when tokens are available; otherwise
    // they fall back to literals and the imports would be unused.
    const instanceModules = options.tokens ? collectInstanceTokenModules(body) : new Set<string>();
    const tokenValues = ['colors', 'radii', 'spacing'].filter((module) => instanceModules.has(module));
    const tokenTypes = ['ColorValue', 'RadiusValue', 'SpacingValue', 'GradientValue'].filter((type) => markers.some((marker) => marker.type === type));
    const imports = buildImports(hasMotion, hasSlots, componentRefs, tokenValues, tokenTypes, options.importPrefix ?? './');
    const renderOptions = { ...options, variantData };
    const children = body.children.map((child) => renderNode(child, renderOptions)).join('\n');

    const props = buildProps(node, markers, hasSlots);
    const destructuredProps = buildDestructuredProps(markers.map((marker) => marker.name), hasSlots, variantDefaults);

    const content = `${imports}
${variantDecls ? `${variantDecls}

` : ''}interface ${componentName}Props {
    className?: string;
    ${props}
}

export function ${componentName}(${destructuredProps}: ${componentName}Props) {
    return (
        ${renderElement(body, componentName, className, children, hasMotion, motionProps, variantData, options.tokens)}
    );
}
`;

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

/** Collect the names of components referenced within a node tree (excluding the node itself). */
function collectComponentReferences(node: DesignNode): Set<string> {
    const refs = new Set<string>();
    const visit = (n: DesignNode): void => {
        if (n.type === 'component') {
            refs.add(sanitizeComponentName(n.componentName));
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

/** Build the import statements for a component. */
function buildImports(
    hasMotion: boolean,
    hasSlots: boolean,
    componentRefs: Set<string>,
    tokenValues: string[],
    tokenTypes: string[],
    importPrefix: string,
): string {
    const imports: string[] = [];

    if (hasSlots) {
        imports.push("import type { ReactNode } from 'react';");
    }

    if (hasMotion) {
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
        imports.push(`import { ${ref} } from '${importPrefix}${ref}';`);
    }

    return imports.join('\n');
}

/** Build the props interface for a component. */
function buildProps(node: DesignNode, propMarkers: PropMarker[], hasSlots: boolean): string {
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

    // The React children prop is only meaningful when the tree renders slots.
    if (hasSlots) {
        props.push('children?: ReactNode;');
    }

    return props.join('\n    ');
}

/** Build the function-parameter destructuring for a component. */
function buildDestructuredProps(propNames: string[], hasSlots: boolean, variantDefaults: Record<string, string>): string {
    const parts = ['className'];
    for (const name of propNames) {
        parts.push(variantDefaults[name] !== undefined ? `${name} = '${variantDefaults[name]}'` : name);
    }
    if (hasSlots) parts.push('children');
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
                        type: field === 'gradient' ? 'GradientValue'
                            : COLOR_STYLE_FIELDS.has(field) ? 'ColorValue'
                            : field === 'radius' ? 'RadiusValue'
                            : NUMERIC_TOKEN_FIELDS.has(field) ? 'SpacingValue'
                            : NUMERIC_STYLE_FIELDS.has(field) ? 'number' : 'string',
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
                const type = marker.values.length > 0 ? marker.values.map((value) => `'${value}'`).join(' | ') : 'string';
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
function buildVariantData(node: DesignNode, tokens?: DesignTokens): { common: string; variants: Record<string, string>; backgrounds: Record<string, string> } {
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
    const common = classes[first].filter((candidate) => marker.values.every((value) => classes[value].includes(candidate)));
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
    if (fill.type === 'solid' || fill.stops.length === 0) return `''`;
    const stops: string[] = [];
    let hasRefs = false;
    for (const stop of fill.stops) {
        const color = tokens ? resolveColorName(stop.color, tokens) : undefined;
        const position = `${Math.round(stop.position * 100)}%`;
        stops.push(color ? `\${colors.${color}} ${position}` : `${normalizeColor(stop.color)} ${position}`);
        if (color) hasRefs = true;
    }
    const stopsText = stops.join(', ');
    const fn = fill.type === 'linear'
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

/**
 * Render the inline style attribute for a node.
 *
 * Composes the prop-driven style fields (from the extraction pass) with an
 * inline `background` for gradient fills, which Tailwind classes cannot
 * express. Variant-marked nodes instead switch backgrounds per-variant via
 * their `variantBackgroundMap` record (their members may carry gradients).
 */
function renderStyleAttrs(node: DesignNode, tokens?: DesignTokens, variant?: VariantRenderData): string {
    const entries: string[] = [];
    if (variant) {
        if (Object.keys(variant.backgrounds).length > 0) {
            entries.push(`background: \${${variant.backgroundRecordName}[variant] ?? undefined}`);
        }
    } else {
        const styleProps = node.metadata?.custom?.styleProps;
        const gradientProp = styleProps && typeof styleProps === 'object'
            ? (styleProps as Record<string, unknown>)['gradient']
            : undefined;
        if (typeof gradientProp === 'string') {
            // Prop-driven gradient: render the CSS from the prop value. The
            // gradient function matches the template's fill type (members in a
            // gradient-slot group always share the fill type).
            entries.push(`background: ${gradientFromProp(gradientProp, node.style.fills?.[0])}`);
        } else {
            const fill = node.style.fills?.[0];
            if (fill && fill.type !== 'solid') {
                entries.push(`background: ${gradientBackground(fill, tokens)}`);
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
    if (entries.length === 0) return '';
    return ` style={{ ${entries.join(', ')} }}`;
}

/** Check whether any node in the tree renders a slot (needs the React children prop). */
function treeHasSlots(node: DesignNode): boolean {
    if (node.children.some((child) => child.type === 'slot')) return true;
    return node.children.some((child) => treeHasSlots(child));
}

/** The render options threaded through the JSX renderers. */
interface RenderOptions {
    /** Whether to generate Motion animations. */
    animations?: boolean;
    /** The design tokens to prefer over arbitrary values. */
    tokens?: DesignTokens;
    /** Variant render data keyed by template node id. */
    variantData?: Map<string, VariantRenderData>;
}

/** Render a node as JSX. */
function renderNode(node: DesignNode, options: RenderOptions): string {
    const className = generateClasses(node, options.tokens).join(' ');
    const motionProps = options.animations ? generateMotionProps(node) : undefined;
    const hasMotion = Boolean(motionProps && Object.keys(motionProps).length > 0);

    switch (node.type) {
        case 'text':
            return renderTextNode(node, className, options.tokens);
        case 'image':
            return renderImageNode(node, className, options.tokens);
        case 'vector':
            return renderVectorNode(node, className, options.tokens);
        case 'component':
            return renderComponentNode(node, className, options);
        case 'slot':
            return '{children}';
        case 'frame':
        case 'group':
        default:
            return renderContainerNode(node, options);
    }
}

/** Render a text node as JSX. */
function renderTextNode(node: DesignNode, className: string, tokens?: DesignTokens): string {
    if (node.type !== 'text') return '';
    const tag = node.text.style.fontSize !== undefined && node.text.style.fontSize >= 32 ? 'h2' : 'p';
    const styleAttrs = renderStyleAttrs(node, tokens);

    // Template-driven text renders a prop interpolation instead of static text.
    const prop = node.metadata?.custom?.prop;
    if (typeof prop === 'string') {
        return `<${tag} className="${className}"${styleAttrs}>{${prop}}</${tag}>`;
    }

    return `<${tag} className="${className}"${styleAttrs}>${escapeJsx(node.text.text)}</${tag}>`;
}

/** Render an image node as JSX. */
function renderImageNode(node: DesignNode, className: string, tokens?: DesignTokens): string {
    if (node.type !== 'image') return '';
    const src = node.asset.src;
    const alt = node.asset.alt ?? node.name;
    const objectFit = node.objectFit ?? 'cover';
    const styleAttrs = renderStyleAttrs(node, tokens);
    return `<img src="${src}" alt="${escapeAttr(alt)}" className="${className} object-${objectFit}"${styleAttrs} />`;
}

/** Render a vector node as JSX. */
function renderVectorNode(node: DesignNode, className: string, tokens?: DesignTokens): string {
    if (node.type !== 'vector') return '';
    const styleAttrs = renderStyleAttrs(node, tokens);
    if (node.svg) {
        return `<div className="${className}"${styleAttrs} dangerouslySetInnerHTML={{ __html: ${JSON.stringify(node.svg)} }} />`;
    }
    return `<div className="${className}"${styleAttrs} />`;
}

/** Render a component node as JSX. */
function renderComponentNode(node: DesignNode, className: string, options: RenderOptions): string {
    if (node.type !== 'component') return '';
    const name = sanitizeComponentName(node.componentName);
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
    // A component with a template renders its own root (classes + inline style
    // props), so the instance only passes its prop values.
    if (node.template) return `<${name} ${props} />`;
    return `<${name} ${props} className="${className}" />`;
}

/** The tokens-module objects referenced by instances in a tree (colors/radii/spacing). */
/** Whether a node renders a gradient (its own fill or a variant member's). */
function rendersGradient(node: DesignNode): boolean {
    // Prop-driven gradients render from the prop value, not with token refs in
    // this file — the static fill is only a fallback shape marker.
    const styleProps = node.metadata?.custom?.styleProps;
    const gradientProp = styleProps && typeof styleProps === 'object'
        ? (styleProps as Record<string, unknown>)['gradient']
        : undefined;
    const fill = node.style.fills?.[0];
    if (typeof gradientProp !== 'string' && fill && fill.type !== 'solid') return true;
    const variant = node.metadata?.custom?.variant;
    if (variant && typeof variant === 'object') {
        const members = (variant as { members?: DesignNode[] }).members;
        for (const member of members ?? []) {
            const memberFill = member.style.fills?.[0];
            if (memberFill && memberFill.type !== 'solid') return true;
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
        .filter((stop): stop is { color: unknown; position: unknown } => typeof stop === 'object' && stop !== null && 'color' in stop && 'position' in stop)
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
    const tag = node.type === 'frame' && node.isSection ? 'section' : 'div';
    const motionAttrs = hasMotion ? formatMotionAttrs(motionProps) : '';
    const styleAttrs = renderStyleAttrs(node, options.tokens, variant);
    const tagName = hasMotion ? 'motion.div' : tag;

    return `<${tagName} ${classAttr}${styleAttrs}${motionAttrs}>
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
): string {
    const tag = node.type === 'frame' && node.isSection ? 'section' : 'div';
    const motionAttrs = hasMotion ? formatMotionAttrs(motionProps) : '';
    const variant = variantData?.get(node.id);
    const styleAttrs = renderStyleAttrs(node, tokens, variant);
    const tagName = hasMotion ? 'motion.div' : tag;

    const classAttr = variant ? renderVariantClassAttr(variant, true) : `className={className ?? "${className}"}`;

    return `<${tagName} ${classAttr}${styleAttrs}${motionAttrs}>
    ${children}
</${tagName}>`;
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