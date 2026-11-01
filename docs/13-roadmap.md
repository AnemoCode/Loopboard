# 13: Roadmap & Implementation Plan

Estimates are in **ideal person-weeks (pw)** for one experienced full-stack developer. With two developers, the frontend-engine and backend/infra tracks largely run in parallel. Each phase ends with a demoable, deployable build.

```
Phase 0  Foundations                    ██                    ~1.5 pw
Phase 1  Single-user editor core        ████████              ~6 pw
Phase 2  Collaboration + projects (MVP) ██████                ~5 pw
Phase 3  Vensim interop + export        █████                 ~4 pw
         ───────── MVP / public beta ─────────                ≈ 16–17 pw
Phase 4  Comments, layers, versions     ████                  ~3.5 pw
Phase 5  CLD intelligence & polish      ████                  ~3.5 pw
Phase 6  Scale, orgs, hardening         ongoing
```

Phase 3 (MDL) can start in parallel with Phase 1, because the codec is a pure package that only depends on `@cld/shared` types.

---

## Phase 0: Foundations (~1.5 pw)

**Goal:** an empty but production-shaped monorepo that builds, tests, runs in Docker and deploys.

- [ ] pnpm workspace + Turborepo, `packages/config` (tsconfig/eslint/prettier presets)
- [ ] Scaffold `apps/web` (Vite + React + Tailwind v4 + shadcn init + TanStack Router/Query)
- [ ] Scaffold `apps/api` (Fastify + Zod type provider + pino + env validation + health routes)
- [ ] Scaffold `apps/collab` (Hocuspocus with a hello-world doc)
- [ ] Empty `packages/{shared,model,geometry,render,editor,mdl,analysis,ui-tokens}` with Vitest
- [ ] Drizzle setup + first migration (projects, members, documents) + `migrate` entrypoint
- [ ] Better Auth: email/password, sessions, `/api/me`. Sign-in/up pages
- [ ] Dockerfiles (multi-stage, turbo prune), `compose.yaml`, `compose.dev.yaml`, Caddyfile, `.env.example`, Mailpit
- [ ] GitHub Actions: lint, typecheck, test, build images
- [ ] Move the fixture `.mdl` to `packages/mdl/test/fixtures/` (sanitize the filename)
- [ ] `CONTRIBUTING.md`: how to run, conventions

**Done when:** `docker compose up` gives you a sign-up/login page over HTTPS on localhost, and CI is green.

---

## Phase 1: Single-user editor core (~6 pw)

**Goal:** draw a complete CLD alone, persisted locally in a Y.Doc (no server sync yet, though the document already lives in Yjs so Phase 2 only has to connect it).

**1a. Model & geometry (1.5 pw)**
- [ ] Yjs schema + typed accessors (`@cld/model`): variables, diagrams, layers, elements, defaults
- [ ] Commands: create/update/delete variable node, link, loop, shape, text; move; resize; set style; reorder (fractional index); group
- [ ] Invariants: `validate()` + `repair()`
- [ ] `@cld/geometry`: arc-through-3-points, boundary clipping (rect/ellipse/text), arrowheads, polarity placement, delay mark position, bounding boxes, hit-tests
- [ ] Tests incl. property tests

**1b. Canvas engine (2.5 pw)**
- [ ] Viewport: pan/zoom (wheel, pinch, space-drag), world↔screen transforms, dotted grid
- [ ] Scene store derived from Y.Doc with incremental updates. R-tree spatial index
- [ ] Element components: variable (forms), link (arc, heads, polarity, delay), loop marker (cw/ccw), shape, text
- [ ] Tools state machines: select (click, shift, marquee), hand, variable, link (drag from handle), loop, shape, text
- [ ] Transform handles: move, resize, link midpoint curve handle, endpoint re-attach
- [ ] Inline text editing (variable names, text boxes) with auto-wrap and measuring
- [ ] Snapping: grid + smart guides
- [ ] Undo/redo (Y.UndoManager), copy/paste/duplicate, delete with cascade, nudge

**1c. Editor UI (2 pw)**
- [ ] Editor shell: top bar, left toolbar, right Design panel, zoom controls
- [ ] Style controls: fill, border (color/width/dash), text (font/size/weight/color/align), arrow (color/width/dash/head), polarity, delay
- [ ] Color palette + custom picker + theme tokens. Light/dark theme
- [ ] Context menu, floating contextual toolbar, keyboard shortcuts, shortcuts help (`?`)
- [ ] Diagram tabs (multiple diagrams per doc) with add/rename/reorder/delete
- [ ] Empty state + onboarding tour v1

**Done when:** you can recreate the fixture diagram by hand in under 15 minutes, styling works, and undo is reliable.

---

## Phase 2: Collaboration & projects (~5 pw) → internal alpha

**2a. Projects & sharing (2 pw)**
- [ ] Projects API (CRUD, archive, soft delete, duplicate) + dashboard UI (grid, search, sort, filters)
- [ ] Members & roles, email invites + share links (Mailpit in dev), accept flow
- [ ] `requireRole` guard. Collab-token endpoint
- [ ] Settings page (profile, theme, cursor color)

**2b. Real-time (3 pw)**
- [ ] Hocuspocus: JWT auth, readOnly by role, Postgres persistence (debounced), schema migration on load, size guards
- [ ] Client provider + y-indexeddb cache + connection state UI
- [ ] Awareness: user info, cursor, viewport, selection, current diagram, tool
- [ ] Remote cursors (interpolated, labels, idle dimming, off-screen indicators)
- [ ] Remote selection outlines + name chips. Avatar stack. Per-tab avatars
- [ ] Transient manipulation (move/resize/curve/draw-link ghosts) via awareness, commit on drop
- [ ] Soft-lock indicators. Follow mode
- [ ] Redis extension + revoke channel
- [ ] Thumbnail job (worker + pg-boss + resvg → MinIO)
- [ ] Playwright multi-user E2E suite (scenarios 1–6, 9 from 12)

**Done when:** 3 people on different machines build a diagram together with no glitches, and access revocation works.

---

## Phase 3: Vensim interop & export (~4 pw) → **MVP / public beta**

- [ ] Produce the PLE feature fixtures + screenshots, and resolve every **TBV** item in 07
- [ ] `@cld/mdl` parser (tolerant, warnings) + AST snapshots
- [ ] `mdlToDoc` mapping (views → diagrams, shadows, loops, styles, passthrough)
- [ ] `docToMdl` writer (renumbering, equations generation, degradation report)
- [ ] Round-trip tests (byte-identical where possible) + fuzzing
- [ ] Import UI: dashboard drop zone, preview dialog, "into existing project" options
- [ ] `@cld/render` `renderDiagramToSvg` (fonts, text layout, deterministic) + golden tests. Editor/export parity test
- [ ] Export dialog: PNG (scale/background), SVG, PDF (page size, all diagrams, legend), MDL (pre-flight), JSON
- [ ] Server export endpoint (sync + job). Signed URLs
- [ ] Manual Vensim PLE acceptance checklist

**Done when:** the fixture `.mdl` imports, can be edited collaboratively, and re-exports to `.mdl` that Vensim opens identically. PNG/PDF match the canvas.

**Beta launch checklist:** backups configured, error tracking on, rate limits, CSP, privacy policy/imprint (DE requirement), seed templates, feedback widget.

---

## Phase 4: Comments, layers, versions (~3.5 pw)

- [ ] Comment threads (Y.Doc) + commenter API path through the collab direct connection
- [ ] Comment pins on the canvas, thread popover, comments panel, resolve/reopen, @mentions + email notifications (worker)
- [ ] Layers panel: add/rename/reorder/visibility/lock/opacity, active layer, move selection to a layer. Export option for hidden layers
- [ ] Shadow variables across diagrams: autocomplete, "go to definition", rename propagates
- [ ] Version history: autosave cadence, named versions, preview (read-only render), restore, retention compaction job
- [ ] Activity feed

---

## Phase 5: CLD intelligence & polish (~3.5 pw)

- [ ] `@cld/analysis`: Johnson's algorithm for elementary cycles (capped, e.g. 500 loops, cycle length ≤ 12), R/B classification from the polarity product, unknown if any link lacks polarity
- [ ] Loops panel: list loops, highlight on hover, "place marker" (centroid + orientation → cw/ccw), warn when a marker's type contradicts its polarities
- [ ] Presentation mode: step through loops/diagrams full-screen, highlighting one loop at a time
- [ ] Templates: system archetypes (Limits to Growth, Fixes that Fail, Shifting the Burden, Tragedy of the Commons, Success to the Successful, Escalation, Eroding Goals, Growth & Underinvestment)
- [ ] Auto-layout (elkjs "stress"/"force") for a selection or a whole diagram, as one undoable step
- [ ] Command palette (⌘K), find variable (⌘F), cursor chat
- [ ] Public read-only links + embed iframe
- [ ] Polish pass: micro-interactions, empty states, accessibility audit, German translation

---

## Phase 6: Scale, organizations, hardening (ongoing)

- Organizations/teams (Better Auth organization plugin): shared project spaces, a lecturer view across groups, bulk "distribute template to groups"
- SSO/SAML, TOTP 2FA
- Horizontal collab scaling with sticky routing, load tests at 10× expected peak
- Helm chart / k8s manifests (optional)
- WAL-based PITR, restore drills, runbooks
- Yjs subdocuments per diagram if projects grow beyond about 5 MB
- Optional: stock & flow *visual* elements (non-simulated) for richer Vensim import
- Optional: AI assist ("suggest missing variables / explain this loop") through the Claude API, opt-in per project

---

## Milestone summary

| Milestone | Contents | Est. cumulative (1 dev) |
|-----------|----------|------------------------|
| M0 Skeleton | Phase 0 | week 2 |
| M1 Solo editor | Phase 1 | week 8 |
| M2 Alpha (collab) | Phase 2 | week 13 |
| M3 Beta / MVP | Phase 3 | week 17 |
| M4 Team features | Phase 4 | week 21 |
| M5 v1.0 | Phase 5 + hardening | week 25–26 |

## Suggested first sprint (2 weeks)

1. Phase 0 entirely.
2. Spike (2 days): an SVG canvas prototype with 200 nodes, arc links with drag-curving, connected to a Hocuspocus dev server with two browser windows, live cursors and live drag through awareness. **This validates D1 and D2 early.** If the spike shows unexpected pain, re-evaluate React Flow as the fallback (see 14).
3. Spike (1 day): parse the fixture `.mdl` sketch section and render it with the prototype canvas.
