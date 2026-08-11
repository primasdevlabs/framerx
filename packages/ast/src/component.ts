/**
 * Component definition model for the Design AST.
 *
 * True definition/instance separation: a component definition is ONE
 * implementation (id, props interface, body) that every instance references.
 * The generator emits one file per definition; instances render as
 * `<Name {...props}>{slotContent}</Name>` references — never as duplicated
 * bodies.
 *
 *   ComponentDefinition (this module)
 *        ↓
 *   components/Name.tsx          ← one implementation file
 *        ↑
 *   <Name …/>  <Name …/>  …      ← N instance references
 */

import type { DesignNode } from './nodes';

/** The source-level type of a component prop. */
export type ComponentPropType =
    /** A plain string value. */
    | 'string'
    /** A numeric value. */
    | 'number'
    /** A boolean value. */
    | 'boolean'
    /** A gradient (angle/stops) rendered as an inline background. */
    | 'gradient'
    /** A color value rendered from the design-token palette. */
    | 'color'
    /** A radius value rendered from the design-token palette. */
    | 'radius'
    /** A spacing/size value rendered from the design-token palette. */
    | 'spacing'
    /** A union of discrete values (component variants). */
    | 'union'
    /** Any value (falls back to a literal). */
    | 'unknown';

/** A single prop in a component definition's interface. */
export interface ComponentProp {
    /** The source-level type of the prop. */
    type: ComponentPropType;
    /** The default value (only variant props carry one in generated code). */
    default?: unknown;
    /** The allowed values (union/variant props). */
    values?: string[];
}

/** A slot position inside a component body. */
export interface ComponentSlot {
    /** The slot node id inside the body tree. */
    nodeId: string;
    /** The slot name ('children' or '' is the default children slot). */
    name: string;
    /**
     * The per-slot props carried by the master's slot placeholder (its
     * controls), when the source exposes them. These describe the slot's
     * default content — preserved so nothing the SDK exposes is dropped.
     */
    props?: Record<string, unknown>;
}

/** How a definition's body was obtained. */
export type ComponentBodySource =
    /** The real component master fetched through the SDK (true definition body). */
    | 'master'
    /** A repeated-subtree extraction template (a real canvas body). */
    | 'extracted'
    /**
     * The component is a CODE component — its real source was fetched
     * through the SDK and is emitted verbatim as the implementation.
     */
    | 'code'
    /**
     * No master, template, or source was available — the body was
     * synthesized from instance props and appended slot positions (a
     * fidelity fallback).
     */
    | 'synthesized';

/**
 * A reusable component definition — one implementation, N instances.
 *
 * Produced by the separation pass (compiler) from either:
 *   - an extraction template (repeated-subtree components), or
 *   - the canonical instance of a source component (children stripped,
 *     prop-driven text synthesized when the SDK exposes no master body).
 *
 * The body is the single rendered implementation. Instance nodes keep their
 * own props / children / named slot content and reference the definition by
 * `componentId`.
 */
export interface ComponentDefinition {
    /** The stable definition id (source component id, else a deterministic hash). */
    id: string;
    /** The unique output component name (file name + JSX identifier). */
    name: string;
    /** The props interface: prop name → type/default. */
    props: Record<string, ComponentProp>;
    /**
     * Prop names merged from instance values that the body itself does not
     * consume (no marker in the body). They still appear in the props
     * interface — a real Framer instance only passes props its definition
     * exposes — but the generator must NOT destructure them (the body cannot
     * reference them, and an unused destructured variable fails the generated
     * project's `noUnusedLocals` build).
     */
    instanceProps?: string[];
    /** The default prop values (canonical instance values). */
    defaults: Record<string, unknown>;
    /** The rendered body tree (the single implementation). */
    body: DesignNode;
    /** The slot positions inside the body. */
    slots: ComponentSlot[];
    /**
     * How the body was obtained. 'master' means the real definition body was
     * fetched through the SDK; 'code' means the component's real source was
     * fetched and is emitted verbatim; 'synthesized' means the exporter fell
     * back to instance-derived content (reported as a warning — never
     * silent).
     */
    bodySource: ComponentBodySource;
    /**
     * The real source of a code component, emitted verbatim as the
     * implementation (bodySource === 'code'). `dependencies` are the
     * transitive relative-import closure — also emitted.
     */
    code?: {
        /** The full source code of the component file. */
        source: string;
        /** The file name (e.g. `Phosphor.tsx`). */
        fileName: string;
        /** The file path inside the project (e.g. `code/Phosphor.tsx`). */
        path: string;
        /** The export name of the component inside the file. */
        exportName: string;
        /** Whether the component is the file's default export. */
        isDefaultExport: boolean;
        /** Transitive relative-import dependencies (path + source). */
        dependencies?: Array<{ path: string; source: string }>;
        /**
         * Whether the source is a published shared-module bundle fetched from
         * Framer's CDN rather than a project code file. The generator adapts
         * these differently: `from 'framer'` rewrites to a local runtime shim,
         * and instances pass content as a `slots` prop (the module contract).
         */
        isModule?: boolean;
    };
    /** The original source component id (when known). */
    sourceId?: string;
}
