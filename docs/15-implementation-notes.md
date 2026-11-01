# 15: Implementation Notes (as built)

This document records what was actually built, where it differs from the plan in docs 01–14, and why. Where this document and an earlier one disagree, **this one describes the code**.

## Architecture as built

```
Browser (React SPA) ──HTTP /api──┐
                    ──WS /collab─┤→ Caddy (web container: static SPA, reverse proxy, CSP/headers)
                                 └→ server container (Node 24, one process)
                                       ├─ Fastify REST API (+ Better Auth at /api/auth/*)
                                       ├─ Hocuspocus (Yjs sync + awareness) on /collab
                                       └─ Drizzle → PostgreSQL 18 (db container)
```

Three containers: `db`, `server`, `web`. Workspace packages:

| Package | Contents |
|---------|----------|
| `@cld/model` | Types, Yjs document schema, all editing commands, invariant repair, loop detection, Zod snapshot schema, arc geometry |
| `@cld/render` | Text metrics + wrapping, element layout, render primitives, deterministic SVG serialiser, themes/palettes |
| `@cld/mdl` | Vensim `.mdl` parser and writer |
| `@cld/shared` | Roles, API payload schemas and response types, presence colors |
| `apps/server` | Fastify + Better Auth + Hocuspocus + Drizzle |
| `apps/web` | React 19 + Vite + Tailwind v4 + Radix UI editor and dashboard |

## Deviations from the plan

| Plan | As built | Why |
|------|----------|-----|
| Separate `api` and `collab` services, Redis fan-out, MinIO, worker with pg-boss | **One `server` process** (Fastify + Hocuspocus), Postgres only | Much simpler to run and reason about. The API writes to live documents directly (`openDirectConnection`) with no internal tokens. Scaling out later means splitting collab out again and adding the Hocuspocus Redis extension. |
| Short-lived JWT for the WebSocket | The WebSocket is **authenticated by the same-origin session cookie** in `onAuthenticate` | One auth mechanism, nothing extra to issue or refresh. |
| Turborepo | pnpm workspaces only (`pnpm -r`) | The build graph is small; Turborepo added nothing. |
| TanStack Router | React Router (library mode) | Fewer concepts for a handful of routes. |
| shadcn/ui | Small hand-written component set on Radix primitives (`components/ui.tsx`) | Same accessibility, a fraction of the code. |
| Separate `geometry` / `editor` / `analysis` / `ui-tokens` packages | Folded into `model`, `render` and `apps/web/src/editor` | Fewer packages, same separation of concerns. |
| `y-indexeddb` offline cache | Not used | It can leave stale or diverged local state after version restores or for read-only users. Edits made during short disconnects still merge, because the provider buffers them in memory. |
| Diagram fonts embedded (Inter etc.) + opentype metrics | **PDF base-14 metric tables** (Helvetica / Times / Courier; Arial, Times New Roman and Courier New are metric-compatible) | Editor, SVG, PNG and PDF wrap text identically, PDF text stays vector without embedding fonts, and the renderer works with no DOM. |
| Server-side PNG/PDF export, thumbnails via worker + resvg | **Client-side exports**. Thumbnails are SVGs rendered on request by the server from the stored document (with a strict CSP header) | No native dependencies or job queue. Thumbnails always reflect the current state. |
| Activity feed, user-preferences table, soft-delete with 30-day restore, ownership transfer, archive | Not built. Delete is permanent (with a confirmation dialog); theme is stored in `localStorage` | Kept the scope focused. Listed under "next steps". |
| Email delivery for invites | **No email sending.** Inviting an existing user grants access immediately; inviting an unknown email stores a pending invite that turns into membership when someone signs up with that address. Invite links cover everything else | No SMTP needed to self-host. |
| Groups (⌘G) | Not built. Multi-selection, copy/paste and layers cover most needs | Scope. |
| Presentation mode, auto-layout (ELK), cursor chat, public anonymous links, i18n | Not built | Phase-5/6 items that remain future work. |

## Feature checklist (requested scope)

| Feature | Status |
|---------|--------|
| Multiple projects, dashboard, search/filter, rename, duplicate, delete/leave | ✅ |
| Real-time collaboration: live cursors with names, remote selections, live movement of dragged/resized/curved elements, links being drawn, presence avatars, follow mode | ✅ |
| Variables (text, box, rounded, oval), shapes (rect, rounded, ellipse, diamond), free text | ✅ |
| Causal links: straight/curved (Vensim arc model), polarity + / – / ?, delay mark, label, colour, width, dash, head style, re-attach endpoints, self-loops | ✅ |
| Loop markers R / B / custom, clockwise / counter-clockwise, label + name | ✅ |
| Automatic loop detection with R/B classification and "add marker" | ✅ |
| Colours, fills, borders, fonts, sizes, bold/italic, alignment, light/dark canvas | ✅ |
| Comments: threads anchored to elements or the canvas, replies, resolve, delete | ✅ (no @mentions/notifications) |
| Multiple diagrams per project (Vensim views) and layers per diagram (visibility, lock, order) | ✅ |
| Vensim `.mdl` import (byte-identical round-trip on both fixtures) | ✅ |
| Export PNG (1×/2×/4×, transparent), SVG, PDF (vector, all diagrams), `.mdl`, `.cld.json` | ✅ |
| Version history: autosave every 5 minutes while people edit (plus a trailing save), named versions, preview, restore | ✅ |
| Roles: owner / editor / commenter / viewer, enforced in the API and the collab server | ✅ |
| Templates: Fixes that Fail, Limits to Growth, Shifting the Burden | ✅ |
| Command palette (⌘K) with variable search across diagrams | ✅ |
| Undo/redo (your own changes only), copy/paste/duplicate across projects, snapping guides, keyboard shortcuts | ✅ |
| Guest access: join through a share link with only a name, upgrade to an account later ([16](16-guest-access.md)) | ✅ |
| Change history: who changed what, live, with moves grouped (see below) | ✅ |
| Docker (compose stack with Caddy), CI workflow | ✅ |

## Change history (changelog)

The **History** tab in the side panel shows a live timeline of everyone's changes, interleaved with saved versions.

- **How it's recorded:** the server listens to every committed transaction of a loaded document (`apps/server/src/changelog.ts`). It attributes the transaction to the collaborator whose connection sent it, or to the user an API action ran for (comments, restores). It then diffs the document before and after with the pure function `describeChanges` (`packages/model/src/changes.ts`). Server housekeeping (loading, repairs, migrations) is not logged.
- **Grouping rules:**
  - Moves, z-order changes, moves between layers, and reordering of diagrams or layers count as layout. One person's consecutive layout changes on the same diagram within 10 minutes merge into a single entry, e.g. "rearranged 12 elements".
  - Everything else is listed individually: adding or deleting, renames, polarity, delay marks, labels, curving or straightening, resizing, shape changes, colours and other styles, locks, layer visibility, notes and units, comments.
  - Within one transaction, links deleted together with their variable fold into that entry ("deleted variable “A” and 2 attached links"). More than 3 additions, deletions or style changes are summarised ("added 10 variables and 6 links").
  - A version restore is logged as a single entry.
- **Live updates:** after storing entries, the server sends a stateless message to connected clients, which refresh the panel. Saving a version does the same.
- **Navigation:** clicking an entry opens its diagram, selects the affected elements that still exist, and centres them. The panel can be filtered by person, and saved versions appear as bookmarks that open the Version history dialog.
- **Undo:** each entry stores the inverse of exactly what it changed (`ops`: field-level before/after values, or whole objects for additions and deletions). **Undo** in the History panel (`POST /api/projects/:id/changes/:id/undo`, editors) reverts only fields that still hold the value the change set, so later edits by others are never overwritten. Deleted objects are recreated (variable, node, attached links and detached comments together), and created objects are removed. The result is reported as done, partly done, or nothing to undo. The undo is logged as its own entry ("undid: …"), which can itself be undone, and the original entry is marked "Undone by …". Undo data larger than 256 KB isn't kept, so very large imports or restores can't be undone that way; restore an earlier version instead.
- **Storage:** entries are stored in `project_changes` (paged API `GET /api/projects/:id/changes?before=&limit=`). Names shown are each person's current name, falling back to the name at the time. When a guest creates an account, their entries move with them.

## Vensim format: resolved questions

Settled using the two fixtures (see [07](07-mdl-format.md)):

- **Loop direction:** comment `shape` `4` = clockwise and `5` = counter-clockwise. This was checked against the geometry of the loops the markers sit in.
- **Comment text:** a text line follows a type-12 object when `bits & 4` is set (bits `7` has text, `3` has none).
- **Sizes:** sketch `w`/`h` are half extents.
- **Text colour:** stored in the font field `|||r-g-b`. The writer emits `hasfont = 2` for a custom text colour.
- **Line endings:** files can be CRLF (coffee fixture) or LF (servitization), and both are preserved.

Still unverified (needs a Vensim installation): the encoding of delay marks, box/ellipse variable shapes, and shadow-variable flags. The exporter keeps any of these that came from an imported file, and warns in the Export dialog when new ones can't be represented.

## Testing as built

| Suite | Count | What it covers |
|-------|-------|----------------|
| `packages/model` | 16 | Commands, cascades, shadows, z-order, copy/paste, loop analysis, changelog descriptions, **property-based convergence of 3 concurrently editing replicas** (150 runs) |
| `packages/mdl` | 13 | Byte-identical round-trips (direct and through Yjs), semantics of both fixtures, edit-then-export, export of non-Vensim projects, 300-run corruption fuzzing |
| `packages/render` | 8 | Metrics and wrapping, arcs, link clipping, deterministic SVG, XML escaping |
| `apps/server` | 18 | Auth, CSRF, projects, import → live export, real WebSocket sync, presence, read-only enforcement, outsider refusal, revocation, persistence, commenter API, versions, duplicate/delete, pending invites, guest access (join, restrictions, revocation, upgrade/merge, cleanup), changelog (attribution, grouping, live notification, paging) |
| `e2e` (Playwright) | 14 | Editing flows, multi-user collaboration (cursors, selections, live drags, follow), comments, roles, invite links, byte-identical `.mdl` export from the browser, PNG/SVG/PDF/JSON downloads, versions, command palette, no console/CSP errors, guest join/upgrade/revocation, live History panel |

The end-to-end suite runs both against the dev servers and against the production Docker stack (`BASE_URL=http://localhost:8080`).

## Known limitations

- A collab server only scales vertically until it is split out with Redis (see the scaling path in 11).
- Text in PDF exports uses the PDF base fonts, so characters outside Windows-1252 (e.g. CJK) are not rendered in PDFs. SVG and PNG are fine.
- Touch devices can view, select and drag, but pinch-zoom isn't implemented.
- Exports render the diagram's styling; comment pins are not included in exports.
