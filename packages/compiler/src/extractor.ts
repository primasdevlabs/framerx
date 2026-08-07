/**
 * @framer/compiler — reusable component extraction pass.
 *
 * Phase 2: detect repeated node subtrees in the design AST and extract them
 * into reusable components, so the compiler never emits duplicate JSX.
 *
 * How it works:
 *  1. Every frame/group subtree is fingerprinted with a structural signature:
 *     node types, layout, structure, and the *presence* of style features.
 *     The VALUES of prop-able dimensions — text content, fill colors, stroke
 *     colors/widths, uniform corner radius, opacity, container size, text
 *     color — are excluded from the signature, so subtrees that differ only
 *     in those values group together.
 *  2. Groups with >= minOccurrences members are extraction candidates. The
 *     first member (sorted by id, for determinism) becomes the canonical
 *     template. Every text node becomes a prop slot; every style feature
 *     whose value varies across the group becomes a style prop (constant
 *     styles stay static Tailwind classes).
 *  3. Each member is rewritten as a DesignComponentNode instance whose props
 *     hold that member's values. The template is attached to the instances;
 *     text slots are marked with `metadata.custom.prop` and style slots with
 *     `metadata.custom.styleProps = { backgroundColor: 'accent' }`, which the
 *     generator renders as inline `style={{ backgroundColor: accent }}` while
 *     omitting the corresponding Tailwind class.
 *
 * The pass is conservative: structure, layout, fill type, gradient stops,
 * mixed (non-uniform) radii, and non-prop-able values remain in the
 * signature, so grouping never reduces rendering fidelity.
 */

import type { DesignComponentNode, DesignDocument, DesignNode } from '@framer/compiler-ast';
import type { CornerRadius } from '@framer/compiler-shared';
import { sanitizeComponentName, toKebabCase, toVariableName } from '@framer/compiler-shared';

/** The options for the component extraction pass. */
export interface ExtractOptions {
    /** The minimum number of occurrences required to extract a component. Defaults to 2. */
    minOccurrences?: number;
    /** The minimum number of nodes in a subtree for it to be considered. Defaults to 2. */
    minNodes?: number;
}

/** A group of structurally identical subtrees. */
interface CandidateGroup {
    /** The shared structural signature. */
    signature: string;
    /** The member nodes (sorted by id). */
    members: DesignNode[];
    /** The total number of nodes in each member subtree. */
    nodeCount: number;
}

/** A style feature that can be extracted as a prop. */
type StyleSlot =
    | 'gradient'
    | 'backgroundColor'
    | 'borderColor'
    | 'borderWidth'
    | 'radius'
    | 'opacity'
    | 'width'
    | 'height'
    | 'color';

/**
 * The style plan for a single node position in a component group.
 *
 * Decides, for the aligned position across all members, whether the node's
 * fills/strokes are extracted as value props (identical structure across
 * members) or as a variant (structure differs — e.g. filled vs outlined),
 * and which value slots apply at this position.
 */
interface NodeStylePlan {
    /** The value style slots at this position (empty for variant nodes). */
    slots: StyleSlot[];
    /** Whether fill structure differs across members (variant dimension). */
    fillsVariant: boolean;
    /** Whether stroke structure differs across members (variant dimension). */
    strokesVariant: boolean;
    /** The member nodes at this position (canonical first), stripped of children. */
    members: DesignNode[];
}

/** The per-node order in which style slots are visited (deterministic). */
const STYLE_SLOT_ORDER: StyleSlot[] = ['gradient', 'backgroundColor', 'borderColor', 'borderWidth', 'radius', 'opacity', 'width', 'height'];

/** Human-readable suffixes for nested-node style prop names. */
const STYLE_SLOT_SUFFIXES: Record<StyleSlot, string> = {
    gradient: 'Gradient',
    backgroundColor: 'Color',
    borderColor: 'BorderColor',
    borderWidth: 'BorderWidth',
    radius: 'Radius',
    opacity: 'Opacity',
    width: 'Width',
    height: 'Height',
    color: 'Color',
};

/** Style slots whose values are numbers (rendered as numeric inline styles). */
const NUMERIC_STYLE_SLOTS: ReadonlySet<StyleSlot> = new Set(['borderWidth', 'radius', 'opacity', 'width', 'height']);

/** A gradient stop carried by a gradient prop (color + position for fidelity). */
interface GradientStopValue {
    color: string;
    position: number;
}

/** The structured gradient value carried by a gradient prop. */
interface GradientValue {
    angle?: number;
    center?: { x: number; y: number };
    stops: [GradientStopValue, GradientStopValue, ...GradientStopValue[]];
}

/** A prop slot discovered in the canonical template. */
interface SlotDef {
    /** The kind of slot. */
    kind: 'text' | 'style';
    /** The prop name. */
    propName: string;
    /** The TypeScript type of the prop. */
    type: 'string' | 'number' | 'gradient';
    /** The style slot (for style slots). */
    styleSlot?: StyleSlot;
}

/** The default extraction thresholds. */
const DEFAULT_MIN_OCCURRENCES = 2;
const DEFAULT_MIN_NODES = 2;

/**
 * Prop names that collide with the base props interface (className, children),
 * the variant prop, or React's special props. Nodes whose names derive to
 * these get a distinct fallback key so the generated code always compiles.
 */
const RESERVED_PROP_NAMES = new Set(['className', 'children', 'key', 'ref', 'style', 'variant']);

/** Extract reusable components from a design document. Returns a new document. */
export function extractComponents(document: DesignDocument, options: ExtractOptions = {}): DesignDocument {
    const minOccurrences = options.minOccurrences ?? DEFAULT_MIN_OCCURRENCES;
    const minNodes = options.minNodes ?? DEFAULT_MIN_NODES;

    // 1. Collect every candidate subtree (non-root frames/groups with children).
    const candidates: DesignNode[] = [];
    for (const root of document.nodes) {
        collectCandidates(root, true, candidates);
    }
    if (candidates.length === 0) return document;

    // 2. Group candidates by structural signature.
    const bySignature = new Map<string, CandidateGroup>();
    for (const node of candidates) {
        const signature = signatureOf(node);
        const group = bySignature.get(signature);
        if (group) {
            group.members.push(node);
        } else {
            bySignature.set(signature, {
                signature,
                members: [node],
                nodeCount: countTreeSize(node),
            });
        }
    }

    // 3. Eligible groups: enough occurrences, large enough, not nested inside
    //    an already-selected extraction. Larger groups win (parents over children).
    const eligible = [...bySignature.values()]
        .filter((group) => group.members.length >= minOccurrences && group.nodeCount >= minNodes)
        .map((group) => ({ ...group, members: [...group.members].sort((a, b) => a.id.localeCompare(b.id)) }))
        .sort((a, b) => b.nodeCount - a.nodeCount || a.members[0].id.localeCompare(b.members[0].id));

    const covered = new Set<string>();
    const replacements = new Map<string, DesignComponentNode>();
    const nameRegistry = new Set<string>(collectExistingComponentNames(document.nodes));

    for (const group of eligible) {
        // Any member already covered (itself or an ancestor extracted) → skip the group.
        if (group.members.some((member) => covered.has(member.id))) continue;

        const canonical = group.members[0];
        const plan = buildPlan(canonical, group.members);
        const hasVariant = plan.some((entry) => entry.fillsVariant || entry.strokesVariant);
        const variantValues = hasVariant ? assignVariantValues(group.members) : null;
        const slots = collectSlots(canonical, plan);
        const canonicalValues = collectSlotValues(canonical, slots, plan);
        const memberValues = group.members.map((member) => collectSlotValues(member, slots, plan));

        // Only style slots whose values actually vary become props; constant
        // styles keep their static Tailwind classes. Text always becomes props.
        // Gradient values are objects, so compare them structurally.
        const propNames = new Set<string>();
        for (const slot of slots) {
            const varies = memberValues.some((values) => {
                const a = values[slot.propName];
                const b = canonicalValues[slot.propName];
                if (a === b) return false;
                if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
                    return JSON.stringify(a) !== JSON.stringify(b);
                }
                return a !== b;
            });
            if (slot.kind === 'text' || varies) {
                propNames.add(slot.propName);
            }
        }

        const template = buildTemplate(canonical, slots, propNames, plan, variantValues);
        const componentName = uniqueComponentName(sanitizeComponentName(canonical.name), nameRegistry);
        const componentId = `component-${toKebabCase(componentName)}`;

        for (let i = 0; i < group.members.length; i += 1) {
            const member = group.members[i];
            markCovered(member, covered);
            const props = collectProps(memberValues[i], slots, propNames);
            if (variantValues) {
                props.variant = variantValues[i];
            }
            replacements.set(member.id, buildInstance(member, componentId, componentName, props, template));
        }
    }

    if (replacements.size === 0) return document;

    // 4. Rewrite the tree, replacing each member with its component instance.
    return {
        ...document,
        nodes: document.nodes.map((root) => rewriteNode(root, replacements)),
    };
}

/** Collect candidate subtrees. Excludes root nodes (they generate sections). */
function collectCandidates(node: DesignNode, isRoot: boolean, out: DesignNode[]): void {
    if (!isRoot && isExtractable(node)) out.push(node);
    for (const child of node.children) {
        collectCandidates(child, false, out);
    }
}

/** A subtree worth considering: a container with at least one child, not already a component/slot. */
function isExtractable(node: DesignNode): boolean {
    return (
        (node.type === 'frame' || node.type === 'group') &&
        node.children.length > 0 &&
        // Instances cannot pass slot content, so extracting slot-bearing trees would drop it.
        !containsSlot(node)
    );
}

/** Check whether a subtree contains a slot node. */
function containsSlot(node: DesignNode): boolean {
    if (node.type === 'slot') return true;
    return node.children.some(containsSlot);
}

/**
 * The structural signature of a subtree.
 *
 * Includes everything that affects rendering EXCEPT the VALUES of prop-able
 * dimensions (text content, colors, sizes, radius, opacity). Presence and
 * type are still significant: a solid fill vs a gradient, or a 380px vs a
 * fill-sized container, never group.
 */
function signatureOf(node: DesignNode): string {
    const parts: string[] = [node.type];
    // Position is excluded (flex/grid parents position children). Container
    // size is prop-able (fixed sizing), so exclude it for frames/groups; other
    // node types keep their size in the signature.
    if (node.type !== 'frame' && node.type !== 'group') {
        parts.push(JSON.stringify([node.frame.width, node.frame.height]));
    }
    parts.push(JSON.stringify(node.layout));
    parts.push(JSON.stringify(styleSignature(node)));
    parts.push(JSON.stringify(node.constraints));
    // Ids (e.g. per-animation ids assigned by the parser) never affect
    // rendering and differ between otherwise-identical members.
    parts.push(stableJson(node.animations ?? null));
    parts.push(stableJson(node.interactions ?? null));

    switch (node.type) {
        case 'text':
            parts.push(JSON.stringify({ ...node.text.style, color: node.text.style.color === undefined ? undefined : true }));
            break;
        case 'image':
            parts.push(JSON.stringify([node.objectFit ?? null, node.objectPosition ?? null, node.asset?.src ?? null, node.asset?.alt ?? null]));
            break;
        case 'vector':
            parts.push(JSON.stringify([node.svg ?? null, node.pathData ?? null, node.asset?.src ?? null]));
            break;
        case 'component':
            // Nested component instances must not merge across different props.
            parts.push(JSON.stringify([node.componentId, node.componentName, node.props ?? null, node.slots ?? null]));
            break;
        case 'slot':
            parts.push(node.slotName);
            break;
        case 'frame':
            // Semantic flags affect the rendered output (section vs div, scroll).
            parts.push(JSON.stringify([node.isSection ?? null, node.isScrollContainer ?? null, node.semanticTag ?? null]));
            break;
        case 'group':
            break;
    }

    for (const child of node.children) {
        parts.push(signatureOf(child));
    }
    return parts.join('\u0000');
}

/**
 * The style portion of the signature. Prop-able VALUES are stripped, but
 * presence is preserved (as booleans) so structurally different styles still
 * prevent grouping. Mixed (non-uniform) radii keep their full value — they
 * cannot be expressed as a single prop.
 *
 * Fills and strokes are excluded ENTIRELY (presence and value): differences
 * in fill/stroke structure are modeled as a `variant` prop rather than a
 * grouping boundary (e.g. a filled primary button vs an outlined secondary).
 */
function styleSignature(node: DesignNode): unknown {
    const style = node.style;
    const uniformRadius = radiusValue(style.radius);
    return {
        ...style,
        fills: undefined,
        strokes: undefined,
        radius: style.radius === undefined ? undefined : uniformRadius === undefined ? JSON.stringify(style.radius) : true,
        opacity: style.opacity === undefined ? undefined : true,
    };
}

/** JSON.stringify with unique ids stripped (they never affect rendering). */
function stableJson(value: unknown): string {
    return JSON.stringify(value, (key, val) => (key === 'id' ? undefined : val));
}

/** Count the total number of nodes in a subtree. */
function countTreeSize(node: DesignNode): number {
    let count = 1;
    for (const child of node.children) {
        count += countTreeSize(child);
    }
    return count;
}

/** Mark a node and all its descendants as covered by an extraction. */
function markCovered(node: DesignNode, covered: Set<string>): void {
    covered.add(node.id);
    for (const child of node.children) {
        markCovered(child, covered);
    }
}

/**
 * Build the style plan for a component group by walking the canonical tree
 * in parallel with every member (their tree shapes are identical by the
 * grouping signature).
 */
function buildPlan(canonical: DesignNode, members: DesignNode[]): NodeStylePlan[] {
    const plan: NodeStylePlan[] = [];
    const visit = (cNode: DesignNode, mNodes: DesignNode[]): void => {
        const isContainer = cNode.type === 'frame' || cNode.type === 'group';
        const fillStructs = mNodes.map((m) => (m.style.fills ?? []).map((fill) => fill.type).join(',') || 'none');
        const strokeStructs = mNodes.map((m) => (m.style.strokes ?? []).map((stroke) => stroke.fill.type).join(',') || 'none');
        const fillsVariant = isContainer && !allEqual(fillStructs);
        const strokesVariant = isContainer && !allEqual(strokeStructs);

        // Value slots at this position. Variant nodes carry none — their whole
        // class set is switched by the variant prop.
        const slots: StyleSlot[] = [];
        if (cNode.type === 'text') {
            if (cNode.text.style.color !== undefined) slots.push('color');
        } else if (!fillsVariant && !strokesVariant) {
            if (fillStructs[0] === 'solid') slots.push('backgroundColor');
            // Same-type gradient fills become a value prop (angle/stops), so
            // members with different gradients render their own — the template
            // renders the prop instead of the canonical member's static fill.
            else if (fillStructs[0] === 'linear' || fillStructs[0] === 'radial') slots.push('gradient');
            if (strokeStructs[0] !== 'none') slots.push('borderColor', 'borderWidth');
            for (const slot of ['radius', 'opacity', 'width', 'height'] as const) {
                if (styleSlotValue(cNode, slot) !== undefined) slots.push(slot);
            }
            slots.sort((a, b) => STYLE_SLOT_ORDER.indexOf(a) - STYLE_SLOT_ORDER.indexOf(b));
        }

        plan.push({
            slots,
            fillsVariant,
            strokesVariant,
            members: mNodes.map((m) => ({ ...m, children: [] })),
        });
        cNode.children.forEach((child, index) => visit(child, mNodes.map((m) => m.children[index])));
    };
    visit(canonical, members);
    return plan;
}

/** Check whether all strings in an array are equal. */
function allEqual(values: string[]): boolean {
    return values.every((value) => value === values[0]);
}

/** Assign deterministic variant values (kebab of the root name, deduplicated). */
function assignVariantValues(members: DesignNode[]): string[] {
    const used = new Set<string>();
    return members.map((member) => {
        const base = toKebabCase(member.name) || 'variant';
        let value = base;
        let index = 2;
        while (used.has(value)) {
            value = `${base}${index}`;
            index += 1;
        }
        used.add(value);
        return value;
    });
}

/** Extract a style slot's value from a node (or undefined if not applicable). */
function styleSlotValue(node: DesignNode, slot: StyleSlot): string | number | GradientValue | undefined {
    switch (slot) {
        case 'gradient': {
            const fill = node.style.fills?.[0];
            if (fill?.type !== 'linear' && fill?.type !== 'radial') return undefined;
            // Stop colors AND positions travel through the prop so non-evenly
            // spaced gradients render with exact fidelity.
            const stops = fill.stops.map((stop) => ({ color: stop.color, position: stop.position })) as [GradientStopValue, GradientStopValue, ...GradientStopValue[]];
            return fill.type === 'linear'
                ? { angle: fill.angle, stops }
                : { center: fill.center, stops };
        }
        case 'backgroundColor':
            return node.style.fills?.[0]?.type === 'solid' ? node.style.fills[0].color : undefined;
        case 'color':
            return node.type === 'text' ? node.text.style.color : undefined;
        case 'borderColor': {
            const stroke = node.style.strokes?.[0];
            return stroke?.fill?.type === 'solid' ? stroke.fill.color : undefined;
        }
        case 'borderWidth':
            return node.style.strokes?.[0]?.width;
        case 'radius':
            return radiusValue(node.style.radius);
        case 'opacity':
            return node.style.opacity;
        case 'width':
            return node.layout.sizing.widthMode === 'fixed' ? node.frame.width : undefined;
        case 'height':
            return node.layout.sizing.heightMode === 'fixed' ? node.frame.height : undefined;
        default:
            return undefined;
    }
}

/** The value of a corner radius when uniform (handles number shorthand). */
function radiusValue(radius: CornerRadius | number | undefined): number | undefined {
    if (radius === undefined) return undefined;
    if (typeof radius === 'number') return radius;
    const { topLeft, topRight, bottomRight, bottomLeft } = radius;
    if (topLeft === topRight && topRight === bottomRight && bottomRight === bottomLeft) return topLeft;
    return undefined;
}

/**
 * Collect the prop slots of a template: one text slot per text node plus the
 * plan's value style slots, in a stable walk order, with deduplicated names.
 */
function collectSlots(node: DesignNode, plan: NodeStylePlan[]): SlotDef[] {
    const slots: SlotDef[] = [];
    const used = new Set<string>();
    let planIndex = 0;
    const visit = (n: DesignNode, isRoot: boolean): void => {
        if (n.type === 'text') {
            const base = toVariableName(n.name || 'content');
            slots.push({ kind: 'text', propName: nextPropName(base, used), type: 'string' });
        }
        const entry = plan[planIndex];
        planIndex += 1;
        entry.slots.forEach((slot, index) => {
            slots.push({
                kind: 'style',
                propName: stylePropName(n, slot, index, isRoot, used),
                type: slot === 'gradient' ? 'gradient' : NUMERIC_STYLE_SLOTS.has(slot) ? 'number' : 'string',
                styleSlot: slot,
            });
        });
        for (const child of n.children) {
            visit(child, false);
        }
    };
    visit(node, true);
    return slots;
}

/** Collect a member's slot values, aligned positionally with the slot defs. */
function collectSlotValues(node: DesignNode, slots: SlotDef[], plan: NodeStylePlan[]): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    let index = 0;
    let planIndex = 0;
    const visit = (n: DesignNode): void => {
        if (n.type === 'text') {
            if (index < slots.length) values[slots[index].propName] = n.text.text;
            index += 1;
        }
        const entry = plan[planIndex];
        planIndex += 1;
        for (const slot of entry.slots) {
            if (index < slots.length) {
                const value = styleSlotValue(n, slot);
                if (value !== undefined) values[slots[index].propName] = value;
            }
            index += 1;
        }
        for (const child of n.children) {
            visit(child);
        }
    };
    visit(node);
    return values;
}

/** Build the final props record for an instance (only prop slots, known values). */
function collectProps(
    values: Record<string, unknown>,
    slots: SlotDef[],
    propNames: Set<string>,
): Record<string, unknown> {
    const props: Record<string, unknown> = {};
    for (const slot of slots) {
        if (propNames.has(slot.propName)) {
            const value = values[slot.propName];
            if (value !== undefined) props[slot.propName] = value;
        }
    }
    return props;
}

/**
 * Deep-clone the canonical subtree as the component template, marking text
 * slots with `metadata.custom.prop` and style slots (that became props) with
 * `metadata.custom.styleProps`.
 */
function buildTemplate(
    node: DesignNode,
    slots: SlotDef[],
    propNames: Set<string>,
    plan: NodeStylePlan[],
    variantValues: string[] | null,
): DesignNode {
    let index = 0;
    let planIndex = 0;
    // IMPORTANT: the walk must consume each node's own slots (text + style)
    // BEFORE recursing into children, matching the order used by collectSlots
    // and collectSlotValues, so the index alignment stays correct.
    const clone = (n: DesignNode): DesignNode => {
        const custom: Record<string, unknown> = { ...(n.metadata?.custom ?? {}) };

        if (n.type === 'text') {
            const slot = slots[index];
            index += 1;
            if (slot?.kind === 'text' && propNames.has(slot.propName)) {
                custom.prop = slot.propName;
            }
        }
        const entry = plan[planIndex];
        planIndex += 1;
        if (entry.slots.length > 0) {
            const styleProps: Record<string, string> = {};
            for (const styleSlot of entry.slots) {
                const slot = slots[index];
                index += 1;
                if (slot?.kind === 'style' && propNames.has(slot.propName)) {
                    // Gradient slots are marked under the 'gradient' field so
                    // the generator renders the background from the prop.
                    const marker = styleSlot === 'gradient' ? 'gradient' : styleSlot;
                    styleProps[marker] = slot.propName;
                }
            }
            if (Object.keys(styleProps).length > 0) {
                custom.styleProps = styleProps;
            }
        }
        if (variantValues && (entry.fillsVariant || entry.strokesVariant)) {
            custom.variant = {
                propName: 'variant',
                default: variantValues[0],
                values: [...variantValues],
                members: entry.members,
            };
        }

        return { ...n, children: n.children.map(clone), metadata: { ...(n.metadata ?? {}), custom } };
    };
    return clone(node);
}

/** Build a component instance node for a member. */
function buildInstance(
    member: DesignNode,
    componentId: string,
    componentName: string,
    props: Record<string, unknown>,
    template: DesignNode,
): DesignComponentNode {
    return {
        id: member.id,
        name: member.name,
        type: 'component',
        componentId,
        componentName,
        props,
        template,
        frame: member.frame,
        layout: member.layout,
        style: member.style,
        constraints: member.constraints,
        animations: member.animations,
        interactions: member.interactions,
        children: [],
        metadata: {
            ...member.metadata,
            custom: {
                ...(member.metadata?.custom ?? {}),
                extracted: true,
            },
        },
    };
}

/** Collect names of components already declared in the document (they must not clash). */
function collectExistingComponentNames(nodes: DesignNode[]): string[] {
    const names: string[] = [];
    const visit = (n: DesignNode): void => {
        if (n.type === 'component') names.push(sanitizeComponentName(n.componentName));
        for (const child of n.children) {
            visit(child);
        }
    };
    for (const root of nodes) {
        visit(root);
    }
    return names;
}

/** Return a component name that is unique across the document. */
function uniqueComponentName(base: string, registry: Set<string>): string {
    if (!registry.has(base)) {
        registry.add(base);
        return base;
    }
    let index = 2;
    while (registry.has(`${base}${index}`)) index += 1;
    registry.add(`${base}${index}`);
    return `${base}${index}`;
}

/** A deduplicated, reserved-name-safe prop name. */
function nextPropName(base: string, used: Set<string>): string {
    const safeBase = RESERVED_PROP_NAMES.has(base) ? `${base}Text` : base;
    if (!used.has(safeBase)) {
        used.add(safeBase);
        return safeBase;
    }
    let index = 2;
    while (used.has(`${safeBase}${index}`)) index += 1;
    used.add(`${safeBase}${index}`);
    return `${safeBase}${index}`;
}

/** The prop name for a style slot: field name for the root, node name otherwise. */
function stylePropName(node: DesignNode, slot: StyleSlot, index: number, isRoot: boolean, used: Set<string>): string {
    let base: string;
    if (isRoot) {
        // The component root uses clean field names (backgroundColor, radius…).
        base = slot;
    } else if (node.type === 'text') {
        // Text nodes already have a content prop named after the node.
        base = toVariableName(`${node.name}${STYLE_SLOT_SUFFIXES[slot]}`);
    } else {
        base = index === 0 ? toVariableName(node.name) : toVariableName(`${node.name}${STYLE_SLOT_SUFFIXES[slot]}`);
    }
    return nextPropName(base, used);
}

/** Rewrite a node tree, replacing covered members with their component instances. */
function rewriteNode(node: DesignNode, replacements: Map<string, DesignComponentNode>): DesignNode {
    const replaced = replacements.get(node.id);
    if (replaced) return replaced;
    return {
        ...node,
        children: node.children.map((child) => rewriteNode(child, replacements)),
    };
}
