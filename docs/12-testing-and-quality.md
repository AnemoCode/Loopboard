# 12: Testing & Quality

## Test pyramid

| Level | Tool | Scope | Runs |
|-------|------|-------|------|
| Unit | Vitest | geometry, mdl parser/writer, analysis, model commands, validators, zod schemas | every commit, < 30 s |
| Property-based | fast-check (in Vitest) | CRDT convergence, arc geometry, MDL round-trip on generated diagrams | every commit |
| Component | Vitest + Testing Library (jsdom/happy-dom) | panels, dialogs, toolbar state | every commit |
| Visual regression | Vitest + `@cld/render` golden SVG/PNG | renderer output for fixtures and themes | every commit |
| Integration | Vitest + Testcontainers (Postgres, Redis) | API routes, collab persistence, auth flows | every PR |
| E2E | Playwright | full stack via compose; **multi-user** scenarios with 2–3 browser contexts | every PR |
| Load | k6 (+ `xk6-websockets`) or a custom Node Yjs bot script | many clients per doc, many docs per collab | before releases |

## Critical test suites

### 1. MDL codec (`packages/mdl`)
- **Fixtures:** the repo's coffee/agroforestry `.mdl`, plus the PLE-generated feature fixtures (see 07).
- `parse → write` must give byte-identical output for each unedited fixture. Where that's impossible, document why in the fixture's README and require semantic equality instead.
- `parse → toDoc → toMdl → parse` must preserve: variable names, positions (±0), link endpoints, polarity, curvature control points, loop markers (type + direction), colors.
- Snapshot of the parse AST for every fixture.
- Fuzzing: random truncation and garbage injection must never throw, only produce warnings.
- **Manual acceptance:** open the exported files in Vensim PLE, done per release by a checklist in `docs/runbooks/vensim-check.md`.

### 2. Geometry (`packages/geometry`)
- Arc through three points: collinear fallback, tiny radius, control point coincident with an endpoint.
- Clipping against a rect, an ellipse, text bounds. Arrowhead placement and polarity-side selection.
- Hit-testing tolerance at different zoom levels.

### 3. Collaboration correctness
- **Convergence property test:** N simulated clients (in-memory Yjs docs) apply random command sequences (create/move/delete/link/style/reorder layers) with random network partitions and delivery orders. Afterwards all docs have the same state, and `validate()` passes after `repair()`.
- Specific races: delete a node while another client links to it; delete a layer while another moves elements into it; rename a variable to a name being created concurrently (dedupe rule).
- Undo isolation: user A's undo never reverts user B's change.

### 4. E2E multi-user scenarios (Playwright)
1. Alice creates a project and invites Bob as editor. Bob accepts, both open the editor, and each sees the other's avatar.
2. Alice moves a variable; Bob sees the transient movement and then the final position (assert within 500 ms).
3. Both create links at the same time; both see both links.
4. Bob selects a node; Alice sees Bob's selection outline and name chip.
5. Carol (commenter) adds a comment that Alice sees live, but Carol can't move nodes (UI disabled, and forced updates are rejected).
6. Offline: Bob goes offline (`context.setOffline(true)`), edits, comes back, and the changes merge.
7. Import the fixture `.mdl`, export `.mdl` again, and diff against the original (semantic).
8. Export PNG / PDF / SVG and assert the files are valid and non-empty, with page count = number of diagrams.
9. Revoking Bob's access disconnects Bob within 2 s.

### 5. Renderer visual regression
- Golden SVG strings per fixture, theme and option set (deterministic output). PNGs from resvg are compared with `pixelmatch`, threshold 0.1%.
- The editor canvas screenshot (Playwright) is compared with the export PNG for the same diagram. This guards against the "editor and export drift apart" risk.

## Performance budgets

| Metric | Budget | How measured |
|--------|--------|--------------|
| Initial JS (gzipped) | ≤ 300 KB editor route, ≤ 150 KB dashboard | `vite build` + size-limit in CI |
| Time to interactive editor (cached) | ≤ 1.5 s | Playwright trace on a mid-tier laptop |
| Pan/zoom FPS with 500 elements | ≥ 55 fps | in-browser perf test with a synthetic doc |
| Drag latency local | < 16 ms per frame | Performance API marks |
| Remote update visible | < 150 ms p95 same region | E2E timestamps, k6 |
| Collab server | ≥ 2,000 concurrent connections / 200 active docs per vCPU | load test |
| Doc store latency | < 50 ms p95 | metrics |

## Code quality

- TypeScript `strict`, `noUncheckedIndexedAccess`, project references.
- ESLint (typescript-eslint strict, react-hooks, import ordering) + Prettier. `pnpm lint` blocks CI.
- Conventional commits. `changesets` for versioning (optional).
- PR template: screenshots/GIF for UI changes, a test plan, and docs updated where needed.
- Pre-commit with lefthook: lint-staged + typecheck on changed packages.
- Coverage targets: `mdl`, `geometry`, `model`, `analysis` ≥ 90%. Apps ≥ 60% (meaningful tests, not coverage gaming).
- Dependency updates: Renovate weekly, grouped.

## Accessibility testing

- `@axe-core/playwright` on the dashboard, the dialogs and the editor chrome.
- Keyboard-only E2E: create a variable, link and loop marker without a mouse (through the command palette and shortcuts).
