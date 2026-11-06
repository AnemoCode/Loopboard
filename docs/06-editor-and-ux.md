# 06: Editor & UX

## Design principles

1. **The canvas is the product.** Chrome is minimal and floating, panels collapse, and nothing covers the diagram without a reason.
2. **CLD-native, not a generic whiteboard.** The fastest path to drawing *variable → arrow → polarity → loop* is a few keystrokes.
3. **Vensim users feel at home.** Double-click creates a variable, arrows are arcs you bend from the middle, and loop markers look the same.
4. **Collaboration is ambient.** Presence is visible but quiet, and never blocks you.
5. **Every action is discoverable** through the toolbar, the right-click menu, and the command palette (⌘K) with shortcuts shown.

## Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ◧ Loopboard / Coffee Agroforestry ▾   [Main ▾][Finance][+]   ●●● 👤👤 Share  ⤓ │  top bar
├──┬─────────────────────────────────────────────────────────────────┬───────┤
│▸ │                                                                 │Design │
│✥ │                                                                 │───────│
│▭ │                     (infinite canvas, dotted grid)              │Fill   │
│↗ │                                                                 │Border │
│⟳ │          ┌──────────────┐   +                                   │Text   │
│◇ │          │  Revenue for │──────►  Financial security            │Arrow  │
│T │          │   farmers    │            ↻ R1                       │Polarity│
│💬│          └──────────────┘                                       │───────│
│  │                                                                 │Layers │
│  │                                                                 │ ◉ Base│
│  │  [⊖ 100% ⊕] [minimap]                           Saved ● 3 online│ ◉ Notes│
└──┴─────────────────────────────────────────────────────────────────┴───────┘
 left toolbar                                                         right panel
```

- **Top bar:** project breadcrumb (rename inline), **diagram tabs** (add, rename, duplicate, reorder by drag, delete, and a mini avatar per tab), presence avatars, Share, Export, a menu (version history, import, settings, shortcuts).
- **Left toolbar** (vertical, floating): Select (V), Hand (H), Variable (N), Link (L), Loop marker (O), Shape (R, with a sub-menu for ellipse/diamond/line), Text (T), Comment (C).
- **Right panel**, context-sensitive, with tabs **Design | Layers | Comments | Loops**:
  - Design: properties of the current selection, with mixed values shown as "Mixed".
  - Layers: the layer list for the current diagram.
  - Comments: thread list with filters (open/resolved, mine).
  - Loops: loops found by analysis plus the placed markers (phase 2).
- **Bottom left:** zoom controls, fit-to-content, minimap toggle. **Bottom right:** sync status and the online count.
- **Floating contextual toolbar** above the selection, with quick actions: color swatches, polarity toggle for links, form for variables, delete.

## Tools and interactions

### Variables
- **Double-click** empty canvas → a new variable with its text field focused. Typing names it. Enter confirms, Esc cancels if the name is empty.
- With the Variable tool (N), click to place.
- Typing a name that already exists brings up an autocomplete: "Use existing *Brand reputation* (creates shadow)".
- Text auto-wraps. `w` is adjustable from the side handles, `h` follows the content unless set manually.
- **Forms:** none (Vensim default: text only), rectangle, rounded, ellipse, pill.

### Causal links (arrows)
- Hover a variable and a **connection handle** (small circle) appears at its edge. Drag from it onto another variable to create a link. With the Link tool (L), drag from any variable.
- **Quick polarity:** right after creating a link, a small popover offers `+` / `−` / `none`, with keys `+`/`=` and `-`. Pressing `P` on a selected link cycles +, −, ?, none.
- **Curving:** a selected link shows a **midpoint handle**. Dragging it sets `control` and the arc passes through that point (the Vensim model). Double-clicking the handle straightens the arrow.
- Endpoints are clipped to the node's boundary (box, ellipse or text bounds), with a gap of a few pixels.
- **Markings on arrows:**
  - Polarity sign at the head (default), tail or middle. Its side is chosen automatically (outside of the curve) or set manually.
  - **Delay mark** (`||`), perpendicular at the arc midpoint. Toggle with `D`.
  - Optional text label along the arc.
  - Head style: arrow / triangle / open / none. Line: solid / dashed / dotted, width, color.
  - Polarity coloring (optional theme setting): + green/blue, − red/orange.
- Self-loops (a link from a node to itself) are allowed and render as a small loop.
- Re-attaching: drag an endpoint to another node.

### Loop markers
- Loop tool (O): click to place. The popover offers **R / B / custom**, **clockwise / counter-clockwise**, label (auto-numbered: R1, R2, B1…) and an optional name shown under the label.
- Rendering: a circular arrow (about 300° arc with an arrowhead) in the chosen direction, with the label centered inside.
- **From analysis** (phase 2): Loops panel → select a detected loop → its links are highlighted → "Place marker". The marker goes at the cycle's centroid, its direction is computed from the cycle's orientation, and its type comes from the polarity product.

### Shapes, text, comments
- Shapes are for grouping and boundaries (e.g. a dashed rectangle "Farmer subsystem"). They render behind variables by default (a lower z within the layer).
- The text tool makes free annotations with lightweight rich text (bold, italic, link).
- The comment tool (C) drops a pin anywhere or on an element. A thread popover opens with Markdown-lite, @mentions, resolve/reopen, and a toggle to show resolved comments on the canvas.

### Selection and manipulation
- Click to select, Shift-click to add or remove, marquee drag on empty canvas. Alt while marquee-ing selects only fully-contained elements.
- Move by dragging. Arrow keys nudge 1 px, Shift+arrow nudges 10 px.
- **Snapping:** grid (toggle with `'`), smart guides (align centers and edges with nearby elements), equal spacing hints.
- Align and distribute (in the right panel and the contextual menu).
- Group (⌘G) and ungroup. Groups are stored as a `groupId` on elements: a light approach with no nested structures.
- Lock (⌘⇧L) stops elements being moved or selected by marquee.
- Copy/paste within and across projects. The clipboard holds native JSON plus an SVG/PNG fallback for pasting into other apps. Copy style ⌘⌥C / paste style ⌘⌥V.
- Duplicate (⌘D) with a smart offset.
- Delete / Backspace. Deleting a variable also removes its attached links (with a toast showing the count and an Undo).

### Navigation
- Pan: Space+drag, middle mouse, trackpad two-finger scroll, or the Hand tool.
- Zoom: ⌘/Ctrl + wheel, pinch, `⌘+`/`⌘-`, `⇧1` fit all, `⇧2` zoom to selection, `⌘0` reset to 100%.
- Minimap (optional).
- **Find** (⌘F): search variables by name in the current diagram or across the project, then jump to the result.

### Diagrams and layers
- **Diagrams** are pages and views (each becomes a Vensim `*View`). A variable can appear in several diagrams. Copies beyond the first are *shadows*: they render with a subtle angle-bracket style, like Vensim's `<Name>`, and "Go to definition" jumps to the primary.
- **Layers** within a diagram: add, rename, reorder (drag), toggle visibility, lock, set opacity. Elements go onto the active layer. Uses: an "Annotations" layer, a "Loop markers" layer, or a "Scenario B links" layer you switch on and off during a presentation. Exports can include or exclude hidden layers.

### Command palette (⌘K)
Searches every command ("Add diagram", "Export as PDF", "Toggle grid", "Find loops", "Go to diagram: Finance", "Insert template: Limits to Growth").

## Keyboard shortcuts (initial set)

| Action | Mac | Win/Linux |
|--------|-----|-----------|
| Select / Hand | V / H | V / H |
| Variable / Link / Loop / Shape / Text / Comment | N / L / O / R / T / C | same |
| Toggle polarity on link | P (cycle), + / − | same |
| Toggle delay mark | D | D |
| Undo / Redo | ⌘Z / ⌘⇧Z | Ctrl+Z / Ctrl+Y |
| Duplicate / Group / Lock | ⌘D / ⌘G / ⌘⇧L | Ctrl+… |
| Bring forward / to front | ⌘] / ⌘⇧] | Ctrl+… |
| Fit / Zoom to selection | ⇧1 / ⇧2 | same |
| Command palette / Find | ⌘K / ⌘F | Ctrl+K / Ctrl+F |
| Show shortcuts | ? | ? |

## Visual design

- **Aesthetic:** clean, light and calm. A neutral canvas (off-white `#FAFAF9` light, `#141414` dark), a dotted grid at 8 px world units shown at ≥ 50% zoom, and one accent color.
- **Typography:** "Inter" for the UI, plus selectable diagram fonts (Inter, Source Serif, JetBrains Mono, and a hand-drawn option such as "Kalam" for workshop vibes).
- **Default diagram style:** variables as plain text (as in Vensim) in 14 px dark grey, arrows in 1.5 px `#3F3F46` with a filled triangle head, polarity signs in 13 px semibold. Loop markers draw in the accent color.
- **Color palettes:** 10 curated swatches (accessible on both themes) plus a custom hex/HSV picker and a "recent colors" row. The palette shifts with the theme: a swatch is stored as a token, so the same diagram reads well in dark mode.
- **Panels:** 12 px radius, subtle shadow, 1 px border, 240–280 px wide.
- **Motion:** 120–180 ms ease-out for panels and popovers. Canvas operations have no animation, except smooth zoom and remote cursor interpolation.
- **Accessibility:** WCAG AA contrast for the UI, full keyboard operation of panels and menus, visible focus rings, `prefers-reduced-motion`, screen-reader labels for tools. On the canvas, an "Outline" view (phase 3) lists variables and links as an accessible tree.

## Onboarding & empty states

- A new project opens with a one-time 4-step tour: double-click to add a variable, drag a handle to link, press + or − for polarity, add a loop marker.
- The empty canvas shows a centered hint: "Double-click to add a variable · or import a Vensim .mdl", with buttons.
- Templates gallery on the dashboard "New project" dialog: Blank, Import `.mdl`, plus system archetypes.

## Dashboard

- Grid or list of projects with thumbnail, name, last edited (time and who), member avatars, and a role badge.
- Search, sort (recent / name), filters (owned by me, shared with me, archived).
- Per-project actions: open, rename, duplicate, share, export, archive, delete.
- "New project" (blank, template, import `.mdl` / `.cld.json` by drag-and-drop anywhere on the dashboard).

## Editor engine internals (`@cld/editor`)

- **Scene graph:** derived read-only from the Y.Doc into an indexed store (`Map<id, ElementView>`) with precomputed geometry (link arcs, clipped endpoints, label positions). Updates are incremental: a Yjs `observeDeep` event recomputes only the affected elements plus the links attached to moved nodes.
- **Spatial index:** an `rbush` R-tree for hit-testing and marquee selection, updated incrementally.
- **Tools:** a state machine per tool (`idle → pressing → dragging → committing`), all speaking a common `PointerEvent` → world-coordinates interface.
- **Commands:** `execute(doc, args)` functions that wrap `transact(…, LOCAL_ORIGIN)`. Commands are also how the API mutates documents for imports.
- **Rendering:** React components per element type (memoized and keyed by id). They call the same geometry functions as `@cld/render`. Layers are SVG `<g>` elements in fractional order. Presence (cursors, remote selections, ghosts) renders in a separate overlay `<svg>` so updates don't disturb the diagram.
- **Performance:** CSS transform for pan/zoom on the root `<g>` (no re-render on pan); text measurement cached per (text, font, width); `requestAnimationFrame` batching for awareness renders.
