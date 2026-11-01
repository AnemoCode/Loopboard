# 08: Import & Export

## Formats

| Format | Import | Export | Fidelity | Where it runs |
|--------|:------:|:------:|----------|---------------|
| `.cld.json` (native) | ✓ | ✓ | Lossless (full doc snapshot + schema version) | Client; API |
| `.mdl` (Vensim) | ✓ | ✓ | Lossless for Vensim features. Our extras degrade (see 07 §6) | Client (Web Worker); API |
| `.png` | n/a | ✓ | Raster, 1×/2×/4×, optional transparent background | Client (canvas); API (resvg) |
| `.svg` | n/a | ✓ | Vector, fonts embedded as subset or converted to paths (option) | Client; API |
| `.pdf` | n/a | ✓ | Vector. One diagram, or all diagrams as pages | Client (jsPDF + svg2pdf.js); API |
| Clipboard | ✓ (JSON) | ✓ (JSON + SVG + PNG) | n/a | Client |

## Import flows

### Into a new project (dashboard)
1. The user drops a file on the dashboard or chooses "New → Import".
2. The client parses it in a Web Worker (`@cld/mdl`) and shows a preview dialog: diagram thumbnails rendered with `@cld/render`, counts (variables, links, loops, views), and any warnings ("2 stock objects will be shown as placeholders").
3. Confirm → `POST /api/projects` (name taken from the filename, the cleaned-up `Group 32 – …` part) → `POST /api/projects/:id/import` with the parsed snapshot. The server re-validates it with Zod, builds the initial Y.Doc, stores it as `project_documents.state` and as a version `kind='import'`, and stores the original file in MinIO for reference.
4. Redirect to the editor.

### Into an existing project
- Menu → Import → choose a file → options:
  - **Add as new diagram(s)**, the default. Variables are merged by name: if a name already exists, the new node becomes a shadow of the existing variable, or with the option "keep separate" it is renamed `Name (2)`.
  - **Replace project content**, which requires owner/editor and asks for confirmation. A version is saved first.
- Applied as one Y.Doc transaction, so it's one undo step for the importer, and every collaborator sees it immediately.

## Export flows

The Export dialog (⌘E) has:
- Format picker: PNG / SVG / PDF / MDL / JSON.
- Scope: current diagram / selected elements / all diagrams (PDF: one page per diagram; PNG/SVG: zip).
- Options:
  - PNG: scale (1×, 2×, 4×), background (theme / white / transparent), padding.
  - PDF: page size (Fit to content / A4 / A3 / Letter), orientation (auto), margins, include title and diagram name, include legend (R/B, +/−).
  - All visual formats: include hidden layers, include comments (as numbered pins plus an appendix page in PDF), light or dark theme.
  - MDL: a pre-flight list of elements that will be simplified.
- A live preview thumbnail.

### Rendering pipeline (shared)
```
Y.Doc → toSnapshot() → @cld/render.renderDiagramToSvg(snapshot, diagramId, {
          theme, scale, padding, layers, includeComments, fontMode })
       → SVG string
          ├── SVG export: as is (fonts embedded as base64 woff2 subset, or text→paths)
          ├── PNG (client): <img src=blob:svg> → OffscreenCanvas(scale) → toBlob('image/png')
          ├── PNG (server): resvg-js render with bundled fonts
          └── PDF: jsPDF + svg2pdf.js (vector), fonts registered from the same woff2/ttf
```
- **Fonts:** we ship the diagram fonts as files in `@cld/render/fonts`, with the same font files on client and server, so text metrics, wrapping and output are identical.
- **Text layout:** the renderer does its own line wrapping using measured glyph widths (`opentype.js`-based metrics cached per font). We avoid `foreignObject`, which svg2pdf and resvg don't support.
- **Determinism:** the same snapshot and options give byte-identical SVG. That makes golden-file snapshot tests possible.

### Server-side export API (for integrations and big jobs)
`POST /api/projects/:id/exports { format, scope, options }` → `202 { jobId }` → the worker renders the file and uploads it to MinIO → `GET /api/exports/:jobId` returns `{ status, url }` with a pre-signed URL valid for 10 min. Small exports (< 2 s of work) can return `200` with the file directly.

## Native JSON format (`.cld.json`)

```json
{
  "format": "cld",
  "version": 1,
  "exportedAt": "2026-11-01T10:00:00Z",
  "app": { "name": "loopwise", "version": "0.1.0" },
  "project": { "name": "Coffee Agroforestry" },
  "doc": { "meta": {…}, "variables": {…}, "diagrams": {…}, "comments": {…} }
}
```
Validated with the `@cld/shared` Zod schema on import, and migrated forward if `version` is older.
