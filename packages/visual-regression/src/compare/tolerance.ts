/**
 * Per-breakpoint tolerances.
 *
 * Visual regression is never 0-diff: two independent renderers of the same
 * design legitimately differ in sub-pixel antialiasing, Tailwind class
 * rounding vs. exact px, and system-font fallbacks. Each breakpoint gets its
 * own tolerance (a fraction, e.g. 0.02 = 2% of pixels may differ).
 * Responsive reflows accumulate more differences on small screens, so mobile
 * tolerances are typically looser than desktop.
 */

export interface BreakpointTolerance {
    name: string;
    /** The viewport width to screenshot at. */
    width: number;
    /** Max allowed diffRatio (0..1) before the breakpoint fails. */
    tolerance: number;
}

export interface ToleranceVerdict {
    name: string;
    width: number;
    tolerance: number;
    diffRatio: number;
    /** diffRatio ≤ tolerance. */
    passed: boolean;
    /** diffRatio - tolerance (positive = over budget). */
    excess: number;
}

/** The default suite breakpoints (desktop / tablet / mobile). */
export const DEFAULT_BREAKPOINT_TOLERANCES: readonly BreakpointTolerance[] = Object.freeze([
    { name: 'desktop', width: 1440, tolerance: 0.02 },
    { name: 'tablet', width: 768, tolerance: 0.04 },
    { name: 'mobile', width: 375, tolerance: 0.08 },
]);

/** Verdict for one breakpoint comparison. */
export function verdictFor(diffRatio: number, bp: BreakpointTolerance): ToleranceVerdict {
    const passed = diffRatio <= bp.tolerance;
    return {
        name: bp.name,
        width: bp.width,
        tolerance: bp.tolerance,
        diffRatio,
        passed,
        excess: diffRatio - bp.tolerance,
    };
}

/** Verdicts for a full run; `allPassed` is true only when every tier passed. */
export function summarizeVerdicts(verdicts: ToleranceVerdict[]): { allPassed: boolean; failed: ToleranceVerdict[] } {
    const failed = verdicts.filter((v) => !v.passed);
    return { allPassed: failed.length === 0, failed };
}
