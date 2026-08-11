/**
 * @framer/compiler — definition/instance separation pass.
 *
 * Stage 3b: model every reusable component as ONE definition (id, props
 * interface, body, slots) and keep instances as references. The generator
 * emits one implementation file per definition; instances render as
 * `<Name {...props}>{slotContent}</Name>`.
 *
 * The pass is thin: the deterministic definition model lives in the
 * generators (`buildComponentDefinitions`), which is also what generation
 * consumes — so the modeled definitions and the generated files can never
 * disagree.
 */

import type { DesignDocument } from '@framer/compiler-ast';
import { buildComponentDefinitions } from '@framer/compiler-generators';

/** Attach the component definitions to a document (deterministic). */
export function separateComponents(document: DesignDocument): DesignDocument {
    return {
        ...document,
        components: buildComponentDefinitions(document),
    };
}
