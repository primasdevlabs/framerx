# @framer/visual-regression

Screenshot the Framer source (as extracted by the plugin) and the generated
React project at desktop / tablet / mobile, pixel-diff them, and judge each
breakpoint against its own tolerance.

```
FramerDocument (plugin extraction)
    ├── reference renderer ──→ reference/index.html   (independent baseline)
    └── compiler ────────────→ generated project ──build──→ dist/   (candidate)

For each breakpoint:
    same browser · same viewport width · full-page screenshot of both
    ──→ pure-JS pixel diff (no native image deps)
    ──→ verdict: diffRatio ≤ breakpoint tolerance?
```

## Why two renderers?

The reference renderer (`src/reference/`) is an **independent** implementation
of the extracted `FramerDocument` → HTML/CSS. It does not reuse the React
generator, the Design AST, or Tailwind — it computes exact-px plain CSS from
the same source model. The compiler produces the candidate through a
completely separate path. Visual regression only means something when the two
sides were written independently and must agree.

## Running

```bash
# Requires a Chrome/Chromium install (system Chrome is auto-detected;
# set VR_CHROME_PATH or pass --chrome to override).
pnpm visual:regression --fixture fat-fixture
```

Fixtures: `fat-fixture` (65-property coverage document), `demo-landing`,
`master-golden`.

```bash
pnpm visual:regression \
    --fixture fat-fixture \
    --breakpoints desktop:1440:0.02,tablet:768:0.04,mobile:375:0.08 \
    --out .vr-out
```

A run compiles the fixture, writes the generated project, runs
`pnpm install && pnpm build` inside it (isolated via its own
`pnpm-workspace.yaml`), renders the reference page, serves both over HTTP,
screenshots at every breakpoint, and compares.

Exit code `0` = every breakpoint within tolerance; `1` = a breakpoint failed
or the suite could not run.

### Options

| Flag | Meaning |
| --- | --- |
| `--fixture <name>` | `fat-fixture` \| `demo-landing` \| `master-golden` |
| `--breakpoints <n:w:t,...>` | name:width:tolerance, e.g. `desktop:1440:0.02` |
| `--reference-url <url>` | screenshot a real deployed Framer page instead of the local reference |
| `--out <dir>` | artifact root (default `.vr-out`) |
| `--no-build` | don't run pnpm install/build (expects an existing `dist/`) |
| `--reuse` | reuse the previously generated project (skip compilation) |
| `--chrome <path>` | Chrome executable |
| `--settle-ms <ms>` | settle time for mount/entrance animations (default 800) |

## Output

```
.vr-out/<Project>/
  generated/        the compiled React project (installed + built)
  reference/        the independent reference page
  artifacts/        <breakpoint>-reference.png · -generated.png · -diff.png
  report.json       machine-readable verdicts (CI)
  report.md         human-readable table
```

The diff PNG tints changed pixels red on a dimmed copy of the reference.

## What the diff catches

- sections missing or out of order (height drift counts as diff)
- wrong colors / gradients / shadows / borders
- broken responsive behavior (the suite screenshots at three widths; the
  reference and the generated responsive.css both consume the document's own
  breakpoints)
- typography drift (sizes, weights, letter-spacing, italics)
- layout breaks (absolute positioning, flex/grid reflow)

External requests (Google Fonts, remote images) are **blocked** during
capture by default so both pages render with identical local resources — a
font that fails to load degrades identically on both sides instead of
skewing the diff.

## Notes

- Code components (arbitrary source, no canvas body) render as neutral
  placeholders in the reference; their real pixels can't be reproduced from
  the source model, so those regions legitimately contribute a small diff.
- Tolerances are per-breakpoint for a reason: sub-pixel antialiasing and
  Tailwind class rounding vs. exact px accumulate as the viewport shrinks.

## Testing

The pure-JS parts (PNG codec, comparator, tolerance verdicts, reference
renderer, static server) are unit-tested in `test/` and run in the default
vitest suite without a browser. The full browser run is opt-in:

```bash
VR_BROWSER=1 npx vitest run packages/visual-regression/test/browser-e2e.test.ts
```
