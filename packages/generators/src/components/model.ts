/**
 * Component definition model — the single source of truth for instance
 * rendering and component file generation.
 *
 * True definition/instance separation:
 *
 *   ComponentDefinition (id, props interface, body, slots)
 *        ↓
 *   components/<Name>.tsx          ← ONE implementation file per definition
 *        ↑
 *   <Name {...props}>{children}</Name>   ← N instance references
 *
 * Definitions come from (in order):
 *   1. `document.components` when the separation pass already populated it.
 *   2. Extraction templates (repeated-subtree components): the shared
 *      template IS the body — instances hold only prop values.
 *   3. Source components (no template): the canonical instance (lowest id,
 *      deterministic) becomes the body. When the SDK exposes no master body
 *      and instances carry only props, prop-driven text nodes are synthesized
 *      so content is never silently dropped (an empty frame with props that
 *      render nothing is a data-loss bug). Slot positions come from the
 *      source tree and from the union of instance slot names — named content
 *      always has a position, never a silent drop.
 */

import type {
    ComponentDefinition,
    ComponentProp,
    ComponentPropType,
    ComponentSlot,
    DesignComponentNode,
    DesignDocument,
    DesignNode,
} from '@framer/compiler-ast';
import { sanitizeComponentName, stableId, toVariableName } from '@framer/compiler-shared';

import { COLOR_STYLE_FIELDS, NUMERIC_TOKEN_FIELDS } from '../tailwind/tokens';

/** The style-slot fields whose values render as raw numbers. */
const NUMERIC_STYLE_FIELDS: ReadonlySet<string> = new Set(['width', 'height', 'radius', 'opacity', 'borderWidth']);

/** Deep-clone a design node tree (plain data — JSON-safe). */
export function cloneNode<T extends DesignNode>(node: T): T {
    return JSON.parse(JSON.stringify(node)) as T;
}

/** The default slot name (Framer's default children slot). */
export const DEFAULT_SLOT_NAME = 'children';

/** Whether a slot name is the default children slot. */
export function isDefaultSlotName(name: string): boolean {
    return name === DEFAULT_SLOT_NAME || name === '';
}

/** The JSX/React prop name for a slot (default slot → children). */
export function slotPropName(name: string): string {
    return isDefaultSlotName(name) ? DEFAULT_SLOT_NAME : toVariableName(name) || 'children';
}

/** Map a component prop type to the TypeScript type string it renders as. */
export function propTypeToTs(type: ComponentPropType, values?: string[]): string {
    switch (type) {
        case 'gradient':
            return 'GradientValue';
        case 'color':
            return 'ColorValue';
        case 'radius':
            return 'RadiusValue';
        case 'spacing':
            return 'SpacingValue';
        case 'union':
            return values && values.length > 0 ? values.map((value) => `'${value}'`).join(' | ') : 'string';
        case 'number':
            return 'number';
        case 'boolean':
            return 'boolean';
        case 'unknown':
            return 'unknown';
        case 'string':
        default:
            return 'string';
    }
}

/** Derive the typed props interface from a definition body's prop markers. */
export function derivePropTypes(body: DesignNode): Record<string, ComponentProp> {
    const props: Record<string, ComponentProp> = {};
    const visit = (node: DesignNode): void => {
        const prop = node.metadata?.custom?.prop;
        if (typeof prop === 'string' && props[prop] === undefined) {
            props[prop] = { type: 'string' };
        }
        const styleProps = node.metadata?.custom?.styleProps;
        if (styleProps && typeof styleProps === 'object') {
            for (const [field, propName] of Object.entries(styleProps)) {
                if (typeof propName !== 'string' || props[propName] !== undefined) continue;
                const type: ComponentPropType =
                    field === 'gradient'
                        ? 'gradient'
                        : COLOR_STYLE_FIELDS.has(field)
                          ? 'color'
                          : field === 'radius'
                            ? 'radius'
                            : NUMERIC_TOKEN_FIELDS.has(field)
                              ? 'spacing'
                              : NUMERIC_STYLE_FIELDS.has(field)
                                ? 'number'
                                : 'string';
                props[propName] = { type };
            }
        }
        const variant = node.metadata?.custom?.variant;
        if (variant && typeof variant === 'object') {
            const marker = variant as { propName?: string; values?: string[]; default?: unknown };
            const name = marker.propName ?? 'variant';
            if (props[name] === undefined) {
                props[name] = {
                    type: 'union',
                    values: marker.values ?? [],
                    default: marker.default,
                };
            }
        }
        for (const child of node.children) {
            visit(child);
        }
    };
    visit(body);
    return props;
}

/** Collect the slot positions declared by a body (walk order). */
export function collectBodySlots(body: DesignNode): ComponentSlot[] {
    const slots: ComponentSlot[] = [];
    const visit = (node: DesignNode): void => {
        if (node.type === 'slot') {
            const entry: ComponentSlot = { nodeId: node.id, name: node.slotName || DEFAULT_SLOT_NAME };
            // Per-slot props from the master's slot placeholder survive into
            // the model — the definition records them even though the slot
            // prop itself types as ReactNode.
            const slotProps = node.metadata?.custom?.slotProps;
            if (slotProps && typeof slotProps === 'object' && Object.keys(slotProps).length > 0) {
                entry.props = slotProps as Record<string, unknown>;
            }
            slots.push(entry);
        }
        for (const child of node.children) {
            visit(child);
        }
    };
    visit(body);
    return slots;
}

/** Whether a body declares a default (children) slot position. */
export function bodyHasDefaultSlot(body: DesignNode): boolean {
    return collectBodySlots(body).some((slot) => isDefaultSlotName(slot.name));
}

/** The design node ids of every slot in a body, keyed by slot name. */
export function slotNodeIdsBySlotName(body: DesignNode): Map<string, string> {
    const byName = new Map<string, string>();
    for (const slot of collectBodySlots(body)) {
        if (!byName.has(slot.name)) byName.set(slot.name, slot.nodeId);
    }
    return byName;
}

/** Collect every component instance in a tree (templates, slots, children). */
export function collectNestedInstances(
    node: DesignNode,
    out: DesignComponentNode[] = [],
    seen = new Set<string>(),
): DesignComponentNode[] {
    const visit = (n: DesignNode): void => {
        if (n.type === 'component') {
            if (seen.has(n.id)) return;
            seen.add(n.id);
            out.push(n);
            if (n.template) visit(n.template);
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
    visit(node);
    return out;
}

/** The deterministic identity of a component instance group. */
function groupKey(instance: DesignComponentNode): string {
    if (instance.componentId) return instance.componentId;
    if (instance.componentName) return instance.componentName;
    return stableId('component', JSON.stringify([instance.name, instance.props ?? null]));
}

/** Build the component definitions for a document (deterministic). */
export function buildComponentDefinitions(document: DesignDocument): ComponentDefinition[] {
    // The separation pass already ran — its model is the single source of truth.
    if (document.components && document.components.length > 0) {
        return document.components;
    }

    // Collect every instance in the document (children, templates, slot content).
    const instances: DesignComponentNode[] = [];
    const seen = new Set<string>();
    for (const root of document.nodes) {
        collectNestedInstances(root, instances, seen);
    }

    // Group by component identity (componentId → componentName → structural hash).
    const groups = new Map<string, DesignComponentNode[]>();
    for (const instance of instances) {
        const key = groupKey(instance);
        const members = groups.get(key);
        if (members) {
            members.push(instance);
        } else {
            groups.set(key, [instance]);
        }
    }

    // Deterministic order: sorted by group key, members sorted by id.
    const orderedKeys = [...groups.keys()].sort();
    const definitions: ComponentDefinition[] = [];
    const nameRegistry = new Set<string>();

    for (const key of orderedKeys) {
        const members = [...groups.get(key)!].sort((a, b) => a.id.localeCompare(b.id));
        const canonical = members[0];
        // A code component's real name is its module export name — the ground
        // truth for the file and the import specifier. Instance labels may
        // differ, so the export name wins when the source is known. Shared
        // module bundles report the LITERAL export name 'default' (the
        // component identifier's `:default` suffix), which is not a component
        // name — the instance label is the ground truth there.
        const code = codeOf(canonical);
        const exportName = code && code.exportName && code.exportName !== 'default' ? code.exportName : undefined;
        const baseName = sanitizeComponentName(exportName ?? canonical.componentName) || 'Component';
        const name = uniqueDefinitionName(baseName, nameRegistry);

        const body = buildDefinitionBody(key, canonical, members);
        const props = derivePropTypes(body);
        // Instance-passed props that the body doesn't consume still belong in
        // the props interface — a real Framer instance can only pass props
        // its definition exposes. They are typed from the observed values so
        // the interface stays permissive, and recorded separately so the
        // generator can include them in the interface WITHOUT destructuring
        // them (the body can't reference a prop it has no marker for, and
        // destructuring an unused variable fails the generated project's
        // `noUnusedLocals` build).
        const instanceProps = mergeInstanceProps(props, members);
        const slots = collectBodySlots(body);
        const defaults = collectDefaults(members, props);

        definitions.push({
            id: key,
            name,
            props,
            instanceProps,
            defaults,
            body,
            slots,
            // How the body was obtained: a real master (marked by the parser),
            // the component's real source (code components), a repeated-subtree
            // extraction template, or the synthesized fallback (reported as a
            // warning — never silent).
            bodySource: bodySourceOf(canonical),
            // The code source is carried on the definition so the generator
            // emits the true implementation verbatim.
            code,
            sourceId: canonical.metadata?.sourceId,
        });
    }

    return definitions;
}

/** The code source carried on an instance's metadata (when it is a code component). */
function codeOf(canonical: DesignComponentNode): ComponentDefinition['code'] | undefined {
    const code = canonical.metadata?.custom?.code;
    if (!code || typeof code !== 'object') return undefined;
    return code as ComponentDefinition['code'];
}

/**
 * How a definition's body was obtained, from its canonical instance.
 *
 * A code component's real source wins (the true implementation). A
 * master-backed template is marked `masterBody` on its root by the parser;
 * extraction templates carry no such marker. No template at all means the
 * body was synthesized from instance props.
 */
function bodySourceOf(canonical: DesignComponentNode): ComponentDefinition['bodySource'] {
    if (codeOf(canonical)) return 'code';
    if (canonical.template) {
        return canonical.template.metadata?.custom?.masterBody === true ? 'master' : 'extracted';
    }
    return 'synthesized';
}

/** A unique definition name (first keeps the base; collisions get -2, -3…). */
function uniqueDefinitionName(base: string, registry: Set<string>): string {
    if (!registry.has(base)) {
        registry.add(base);
        return base;
    }
    let index = 2;
    while (registry.has(`${base}${index}`)) index += 1;
    registry.add(`${base}${index}`);
    return `${base}${index}`;
}

/**
 * Build the single implementation body for a component group.
 *
 *  - Extraction groups: the shared template (prop markers already in place).
 *  - Source groups: the canonical instance, children stripped. Prop-driven
 *    text nodes are synthesized when the instance carries only props (the
 *    SDK exposed no master body) so content renders instead of vanishing;
 *    slot positions are appended for every named slot the instances carry
 *    and for default (children) content, so nothing is dropped silently.
 */
function buildDefinitionBody(key: string, canonical: DesignComponentNode, members: DesignComponentNode[]): DesignNode {
    // Extraction templates are the rendered body — no synthesis.
    if (canonical.template) return cloneNode(canonical.template);

    // Code components emit their real source verbatim — the body tree is
    // never rendered, so no prop synthesis and no appended slots.
    if (codeOf(canonical)) return cloneNode(canonical);

    const body = cloneNode(canonical);
    const bodySlots = collectBodySlots(body);
    const existingSlotNames = new Set(bodySlots.map((slot) => slot.name));

    // Synthesize prop-driven text when the source body is empty but the
    // instances carry values — an empty frame that ignores its props is the
    // data-loss case this pass exists to fix.
    if (body.children.length === 0) {
        const propNames = Object.keys(canonical.props ?? {});
        if (propNames.length > 0) {
            // 'title' first (the canonical card heading), then remaining props
            // in insertion order — deterministic and readable.
            const ordered = [...propNames].sort((a, b) => (a === 'title' ? -1 : b === 'title' ? 1 : 0));
            body.children = ordered.map((propName) => synthesizedTextNode(key, propName, canonical.props![propName]));
        }
    }

    // Every named slot carried by any instance gets a position (union of
    // slot names, insertion order — deterministic for a given source).
    const namedSlotNames = new Set<string>();
    for (const member of members) {
        for (const name of Object.keys(member.slots ?? {})) {
            if (!isDefaultSlotName(name)) namedSlotNames.add(name);
        }
    }
    for (const name of namedSlotNames) {
        if (!existingSlotNames.has(name)) {
            body.children.push(slotNode(key, name));
        }
    }

    // Default (children) content gets a position when any instance passes it.
    const hasChildrenContent = members.some((member) => (member.children?.length ?? 0) > 0);
    if (hasChildrenContent && !existingSlotNames.has(DEFAULT_SLOT_NAME)) {
        body.children.push(slotNode(key, DEFAULT_SLOT_NAME));
    }

    return body;
}

/** A synthesized text node driven by a prop (renders `{propName}`). */
function synthesizedTextNode(key: string, propName: string, value: unknown): DesignNode {
    const isTitle = propName === 'title';
    return {
        type: 'text',
        id: stableId('synth', `${key}:${propName}`),
        name: isTitle ? 'Title' : 'Body',
        frame: { x: 0, y: 0, width: 0, height: 0 },
        layout: {
            style: { strategy: 'auto' },
            position: { mode: 'static' },
            sizing: { widthMode: 'auto', heightMode: 'auto' },
            spacing: {},
        },
        style: {},
        constraints: { horizontal: 'left', vertical: 'top' },
        children: [],
        text: {
            text: typeof value === 'string' ? value : String(value ?? ''),
            style: isTitle ? { fontSize: 24, fontWeight: 700 } : { fontSize: 16 },
        },
        metadata: { custom: { prop: propName } },
    };
}

/** A slot node (default or named) appended to a synthesized body. */
function slotNode(key: string, name: string): DesignNode {
    return {
        type: 'slot',
        id: stableId('slot', `${key}:${name}`),
        name: isDefaultSlotName(name) ? 'Children' : name,
        slotName: name,
        frame: { x: 0, y: 0, width: 0, height: 0 },
        layout: {
            style: { strategy: 'auto' },
            position: { mode: 'static' },
            sizing: { widthMode: 'auto', heightMode: 'auto' },
            spacing: {},
        },
        style: {},
        constraints: { horizontal: 'left', vertical: 'top' },
        children: [],
    };
}

/**
 * Add instance-passed props the body doesn't declare to the props interface.
 * Returns the names added (in first-seen deterministic order — members are
 * sorted by id). Types are derived from the observed value kinds: all-string
 * → string, all-number → number, all-boolean → boolean, mixed → unknown.
 */
function mergeInstanceProps(props: Record<string, ComponentProp>, members: DesignComponentNode[]): string[] {
    const added: string[] = [];
    const seen = new Set<string>();
    for (const member of members) {
        for (const key of Object.keys(member.props ?? {})) {
            if (props[key] !== undefined || seen.has(key)) continue;
            seen.add(key);
            const values = members.map((m) => m.props?.[key]).filter((v): v is unknown => v !== undefined);
            props[key] = { type: propTypeFromValues(values) };
            added.push(key);
        }
    }
    return added;
}

/** Derive a ComponentProp type from observed values. */
function propTypeFromValues(values: unknown[]): ComponentProp['type'] {
    const kinds = new Set(values.map((v) => (v === null ? 'null' : typeof v)));
    if (kinds.size === 1) {
        const kind = [...kinds][0];
        if (kind === 'number') return 'number';
        if (kind === 'boolean') return 'boolean';
        if (kind === 'string') return 'string';
    }
    return 'unknown';
}

/** The default prop values for a definition (canonical instance values). */
function collectDefaults(
    members: DesignComponentNode[],
    props: Record<string, ComponentProp>,
): Record<string, unknown> {
    const canonical = members[0];
    const defaults: Record<string, unknown> = {};
    for (const name of Object.keys(props)) {
        const value = canonical.props?.[name];
        if (value !== undefined) defaults[name] = value;
    }
    return defaults;
}

/** Build a componentId → definition map for instance resolution. */
export function definitionById(definitions: ComponentDefinition[]): Map<string, ComponentDefinition> {
    const map = new Map<string, ComponentDefinition>();
    for (const definition of definitions) {
        map.set(definition.id, definition);
        if (definition.sourceId) map.set(definition.sourceId, definition);
    }
    return map;
}
