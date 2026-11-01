# 01: Vision & Scope

## Problem

Vensim is the de-facto tool for causal loop diagrams in teaching and research. For *qualitative* CLD work, though:

- It is single-user and desktop-only. Groups pass `.mdl` files around by email ("Group 32 … _1.mdl").
- The UI is dated: arrow curving, styling and loop labelling are fiddly.
- Nobody can see who changed what, comment on it, or watch a teammate edit live.
- Export options are limited, and presentation-quality images take extra work.

## Vision

A modern, browser-based CLD editor in which a group of students, consultants or researchers can **build one diagram together in real time**. It should feel as natural as Figma or Miro, and it must stay **file-compatible with Vensim**, so nobody gets locked in and existing coursework still opens.

## Target users

| Persona | Needs |
|---------|-------|
| **Student group** (primary) | Co-edit during a workshop, import the lecturer's `.mdl`, export a PNG/PDF for the report, hand an `.mdl` back |
| **Lecturer / facilitator** | Create a template project, share it with groups, comment on loops, view many projects |
| **Consultant / researcher** | Polished visuals, several views of one model, comments with stakeholders, PDF export |

## Core features (requested scope)

1. **Projects:** create, rename, duplicate, archive, delete; a dashboard with thumbnails; sharing.
2. **Multiple diagrams per project** (pages/views, which map to Vensim views) and **layers within a diagram** (visibility, lock, opacity, ordering).
3. **Real-time collaboration:** live cursors with names, remote selections, live movement of objects others are dragging, presence avatars, follow mode.
4. **Diagram elements:**
   - Variables (text with an optional box/ellipse/rounded form)
   - Causal links (straight or curved arrows) with polarity (+/−, and other markers), delay marks and labels
   - Loop markers (clockwise or counter-clockwise circular arrow plus label **R**/**B**, numbered and optionally named)
   - Free shapes (rectangle, rounded rectangle, ellipse, diamond, line), text boxes
   - Comments (threaded, anchored to an element or a canvas point, resolvable, @mentions)
5. **Styling:** fill color, border color/width/style (solid/dashed/dotted/none), text color/size/weight/alignment, arrow color/thickness/dash, theme palettes, copy/paste style.
6. **Import:** Vensim `.mdl` and native `.cld.json`.
7. **Export:** PNG (scale, transparent background), SVG, PDF (one or all diagrams, vector), `.mdl`, native `.cld.json`.
8. **UX:** simple, modern, keyboard-friendly, discoverable; light and dark themes.

## Value-adds (planned, after the MVP)

- **Automatic loop detection:** find every feedback cycle, classify it as R or B from link polarities, and offer to place loop markers.
- Version history with named versions and restore.
- Templates (archetypes: "Limits to Growth", "Fixes that Fail", "Shifting the Burden" …).
- Auto-layout (ELK) for imported or messy diagrams.
- Presentation mode: step through loops by highlighting them one at a time.
- Read-only public share links and embeds.

## Non-goals (for now)

- **Simulation.** No stock-and-flow equations and no numerical integration. We are a sketching tool. Stocks and flows *may* be drawn later as visual elements, but they won't be simulated.
- Native mobile apps. The web app should still be usable on a tablet.
- Full Vensim feature parity: subscripts, lookups, macros and similar are kept verbatim on import but are not editable.
- An offline-first desktop app. Short disconnects are tolerated (see 05).

## Success criteria

| Area | Target |
|------|--------|
| MDL round-trip | Import → export the fixture → re-open in Vensim PLE with identical layout, polarity and loop markers |
| Collaboration latency | Remote cursor / move visible in < 150 ms p95 within one region |
| Concurrency | 25 simultaneous editors on one diagram without visible lag |
| Diagram size | 500 elements at 60 fps pan/zoom on a mid-range laptop |
| Onboarding | A new user creates a 5-variable loop with polarities in < 2 minutes without help |
| Export fidelity | PNG/PDF look pixel-identical to the canvas (same renderer) |
