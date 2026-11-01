# 07: Vensim MDL Format & Mapping

Vensim `.mdl` is a text format with two parts: an **equations section** and a **sketch section**. Below is what we know from Vensim's documentation and from the fixtures in this repo.

> **Update (implemented):** the second fixture (`servitization.mdl`) resolved several TBV items: loop shape `4` = clockwise, `5` = counter-clockwise; comment text follows when `bits & 4`; sizes are half extents; text colour lives in the font field. See [15](15-implementation-notes.md#vensim-format-resolved-questions). Lines marked **(observed)** come from the fixture, and **(TBV)** means *to be verified* against more fixtures saved from Vensim PLE before we rely on it.

> **Fixture strategy:** before writing the codec, produce a fixture set in Vensim PLE (free): one file per feature (box/ellipse variables, colored text, every polarity type, delay marks, both loop directions, multiple views, shadow variables, comments with text, fonts). Store them in `packages/mdl/test/fixtures/` with a screenshot of each. Those screenshots become our visual-regression goldens.

## 1. File structure

```
{UTF-8}                                   ← encoding marker (observed)
<equations…>                              ← one block per variable, '|' terminated
********************************************************
	.Control                              ← group marker
********************************************************~
		Simulation Control Parameters
	|
FINAL TIME = 100 ~ Month ~ … |            ← control variables
INITIAL TIME = 0 …|
SAVEPER = TIME STEP …|
TIME STEP = 1 …|
\\\---/// Sketch information - do not modify anything except names
V300  Do not put anything below this section - it will be ignored
*View 1                                   ← one block per view
$-1--1--1,0,|12||-1--1--1|…|96,96,130,2  ← view default style/zoom line
<sketch object lines…>
///---\\\                                 ← end of sketch
:L<%^E!@                                  ← settings block marker
5:"…"                                     ← numbered settings (key:value)
…
```

## 2. Equations section

Each variable:

```
"Name with (special) chars"  = A FUNCTION OF( Cause one,"Cause (two)"\
		,Cause three)
	~	<units>
	~	<comment/documentation>
	|
```

- `A FUNCTION OF(...)` is how Vensim writes a "placeholder" equation for a CLD variable, listing its causes (observed). The list **must match the incoming arrows** in the sketch, or Vensim reports inconsistencies on open.
- A name is quoted when it contains characters outside `[A-Za-z0-9 _$]` (observed: parentheses, `/`, `-`). Inside quotes, `"` is escaped as `\"`.
- `\` + newline is a line continuation (observed). The parser joins lines before tokenizing.
- Units go after the first `~`, documentation after the second `~` (maps to `variables[].units` / `notes`).
- Real equations (non-CLD models: numbers, `INTEG`, lookups, subscripts) are **kept verbatim** in `variables[].mdlExtra.equation`. We don't interpret them, but we write them back unchanged unless the variable's causes changed. In that case we warn the user that the equation may no longer match.
- The `.Control` group and the four control variables are kept in `meta.vensim.control` and written back (with defaults if the file had none).

## 3. Sketch section: object lines

Comma-separated records. The first field is the **object type**.

### 3.1 View header
- `*View 1`: view name → `diagram.name`. Several `*Name` blocks → several diagrams (**TBV** with a multi-view fixture).
- `$r-g-b,0,font|size|style|color|…|zoomX,zoomY,zoomPct,?`: view defaults. Stored verbatim per diagram in `diagram.mdl.header`, with zoom and default font extracted.

### 3.2 Variable: type `10`
```
10,id,name,x,y,w,h,shape,bits,hidden,hasfont,textpos,boxwidth,nav1,nav2[,box_color,fill_color,font…]
10,1,"Investment in sharing equipment between farmers (5)",521,341,74,36,8,3,0,0,-1,0,0,0,0,0,0,0,0,0   (observed)
```
| Field | Meaning | Maps to |
|-------|---------|---------|
| id | local integer, unique per view | id map → nanoid |
| name | variable name (quoted if needed) | `variables[].name` (deduped) |
| x, y | **center** coordinates | `x, y` |
| w, h | **half**-width / half-height (TBV: observed values like 74×36 for a 2-line label suggest half extents) | `w = 2*w`, `h = 2*h` |
| shape | observed `8` for plain-text CLD variables. Other values encode box/ellipse/etc. (TBV) | `form` |
| bits | flags (observed `3`). Includes the shadow/ghost flag (TBV) | `isShadow`, passthrough |
| hidden | 0/1 | n/a |
| hasfont | 1 means font/color fields follow | `style` |
| rest | text position, box width, nav links, colors, font | `style` + `mdl` passthrough |

Shadow variables (the same name appearing in a second view) are written with a flag in `bits` and possibly `<>` rendering (TBV).

### 3.3 Arrow (link): type `1`
```
1,id,from,to,shape,hidden,polarity,thickness,hasfont,dtype,reserved,color,font,np|(x,y)|
1,13,6,12,1,0,43,0,0,192,0,-1--1--1,,1|(1509,324)|     (observed, curved, '+')
1,32,5,30,0,0,43,0,0,192,0,-1--1--1,,1|(0,0)|          (observed, straight)
1,55,54,3,1,0,0,0,0,192,0,-1--1--1,,1|(1099,266)|      (observed, no polarity)
```
| Field | Meaning | Maps to |
|-------|---------|---------|
| from, to | sketch ids of the endpoint objects | `link.from/to` via id map |
| shape | `0` = straight (point is `(0,0)`), `1` = arc through the point (observed) | `control` null vs `{x,y}` |
| polarity | **ASCII code** of the sign: `43` = `+`, `45` = `-`, `0` = none (observed). Other letters (`S`, `O`, `?`, `P`/`N`?) (TBV) | `polarity` |
| thickness | line thickness (observed 0 = default) | `style.width` |
| dtype | flags (observed `192`). Arrowhead / delay-mark bits likely live here or in `shape` (**TBV**: create a delay fixture) | `delay`, `style.head` |
| color | `r-g-b` or `-1--1--1` = default (observed) | `style.color` |
| np | number of points, then `|(x,y)|…` | `control` |

**Arc geometry:** Vensim draws a circular arc through *from-center → control point → to-center*, clipped at the node bounds. We use exactly the same definition, which is why the model stores `control` instead of Bézier handles. `@cld/geometry.arcThrough(p0, c, p1)` returns the circle (center, radius, sweep flag), and degenerate (collinear) input falls back to a straight line.

### 3.4 Comment / loop marker: type `12`
```
12,id,0,x,y,w,h,shape,bits,hidden,hasfont,textpos,boxwidth,nav1,nav2,colors…
<text on next line>
12,22,0,879,311,30,30,4,7,0,4,-1,0,0,0,0-0-0,255-255-255,|||0-0-0,0,0,0,0,0,0   (observed)
R
```
- The third field `0` means the text sits on the **following line** (observed: `R` / `B`).
- `shape = 4` together with `bits = 7` is observed for all four loop markers. Vensim offers "loop clockwise" and "loop counter-clockwise" comment shapes, so direction is encoded in `shape` (**TBV**: all observed markers use 4, so we need a counter-clockwise fixture).
- Text `R` / `B` (optionally `R1`, `Reinforcing: …`) → `loop.kind` and `loop.label`. Any other text with a non-loop shape → a `text` or `shape` element.
- Colors: `0-0-0` (text), `255-255-255` (fill), `|||0-0-0` font section.

### 3.5 Other types (pass through)
Valves (`11`), stocks/flows, and images (`30`) are kept as raw lines in `diagram.mdl.unknownObjects`. We render them as grey placeholders, and write them back unchanged as long as the objects they reference still exist.

## 4. Settings block

After `///---\\\` comes `:L<%^E!@` followed by `key:value` lines (e.g. `5:` last-selected variable, `19:130,0` zoom, `104:Vensim Sans|12||0-0-0|…` default font). We store it **verbatim** in `meta.vensim.settings` and write it back. If it's missing, we write a minimal default block copied from a PLE-generated empty model.

## 5. Mapping summary

| MDL | Our model |
|-----|-----------|
| File | Project |
| `*View` | Diagram (+ one default layer "Base") |
| Variable equation | `variables[id]` (name, units, notes, raw equation) |
| `10` object | `variable` element (`isShadow` from bits) |
| `1` object | `link` element |
| `12` with loop shape | `loop` element |
| `12` other | `text` / `shape` element |
| Colors / fonts | `style` |
| Unknown lines / fields | `mdl` passthrough on the closest owner |

## 6. Export rules (writer)

1. **Flatten layers** in fractional order. Hidden layers are included by default (an option excludes them).
2. **Renumber** sketch ids from 1 per view, in z-order. Links must come after both of their endpoints (Vensim requirement, TBV), so emit nodes first, then links, then comments, or keep the original order when it is still valid.
3. **Equations:** for each variable, `A FUNCTION OF( <causes> )`, where causes are the distinct source variables of all incoming links across **all** diagrams, sorted for stable diffs. If the variable has a raw equation and its causes didn't change, keep it.
4. Elements with no Vensim equivalent (`shape` rectangles, rich text, dashes, custom arrowheads, layer opacity) are **degraded**: shapes become comment boxes with a border, and rich text becomes plain text. Before export, the user sees a summary: "3 elements will be simplified".
5. Line endings `\r\n` (Vensim on Windows writes CRLF, TBV; the parser accepts both).
6. Encoding: UTF-8 with the `{UTF-8}` header.
7. **Round-trip guarantee:** `write(parse(file))` must equal `file` semantically. Byte-identity is the goal when nothing was edited, and is enforced by tests on all fixtures.

## 7. Parser design (`@cld/mdl`)

- `parseMdl(text): MdlAst` is a tolerant, line-based state machine (equations → sketch views → settings). It never throws on unknown content; it collects `warnings[]` with line numbers instead.
- `mdlToDoc(ast, opts): DocSnapshot` produces the plain JSON model, and the `@cld/model` import command applies it to a Y.Doc in one transaction.
- `docToMdl(snapshot, opts): { text, warnings }`.
- Pure functions with no DOM, so they run in the browser, in Node, and in a Web Worker for large files.
- Hardening: file-size cap of 5 MB, line-count cap, and no regex catastrophic backtracking (hand-written tokenizer).
