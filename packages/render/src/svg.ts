import type { Dash, ProjectSnapshot } from '@cld/model';
import { layoutDiagram, type Prim } from './layout.js';
import { FONT_STACKS, PDF_FONTS } from './text.js';
import { lightTheme, type Theme } from './theme.js';

export const escapeXml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function dashArray(dash: Dash | undefined, width: number): string | undefined {
  if (dash === 'dashed') return `${width * 4} ${width * 3}`;
  if (dash === 'dotted') return `${width} ${width * 2.2}`;
  return undefined;
}

export type FontMode = 'web' | 'pdf';

function paintAttrs(p: { stroke?: string; fill?: string; width?: number; dash?: Dash }): string {
  const w = p.width ?? 1;
  let s = ` fill="${p.fill ? escapeXml(p.fill) : 'none'}"`;
  if (p.stroke) {
    s += ` stroke="${escapeXml(p.stroke)}" stroke-width="${w}"`;
    const da = dashArray(p.dash, w);
    if (da) s += ` stroke-dasharray="${da}"`;
  }
  return s;
}

export function primToSvg(p: Prim, fontMode: FontMode = 'web'): string {
  switch (p.t) {
    case 'path':
      return `<path d="${p.d}"${paintAttrs(p)}${p.cap ? ` stroke-linecap="${p.cap}" stroke-linejoin="round"` : ''}/>`;
    case 'rect':
      return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}"${p.rx ? ` rx="${p.rx}"` : ''}${paintAttrs(p)}/>`;
    case 'ellipse':
      return `<ellipse cx="${p.cx}" cy="${p.cy}" rx="${p.rx}" ry="${p.ry}"${paintAttrs(p)}/>`;
    case 'text': {
      const family = fontMode === 'pdf' ? PDF_FONTS[p.font.family] : FONT_STACKS[p.font.family];
      const attrs =
        ` font-family="${escapeXml(family)}" font-size="${p.font.size}"` +
        (p.font.bold ? ' font-weight="bold"' : '') +
        (p.font.italic ? ' font-style="italic"' : '') +
        ` fill="${escapeXml(p.fill)}" text-anchor="${p.anchor}"`;
      const spans = p.lines
        .map((l) => `<tspan x="${p.x}" y="${l.y}">${escapeXml(l.text)}</tspan>`)
        .join('');
      return `<text${attrs} xml:space="preserve">${spans}</text>`;
    }
  }
}

export interface SvgOptions {
  theme?: Theme;
  padding?: number;
  /** Background color; null = transparent. Defaults to the theme background. */
  background?: string | null;
  includeHidden?: boolean;
  /** Restrict to these element ids (plus links between them). */
  only?: Set<string>;
  fontMode?: FontMode;
  title?: string;
}

export interface SvgResult {
  svg: string;
  width: number;
  height: number;
}

/** Render one diagram of a project to a standalone SVG document. Pure and deterministic. */
export function renderDiagramSvg(
  snap: ProjectSnapshot,
  diagramId: string,
  opts: SvgOptions = {},
): SvgResult {
  const theme = opts.theme ?? lightTheme;
  const pad = opts.padding ?? 32;
  const diagram = snap.diagrams[diagramId];
  if (!diagram) throw new Error(`Unknown diagram ${diagramId}`);
  let elements = diagram.elements;
  if (opts.only) {
    const only = opts.only;
    elements = Object.fromEntries(
      Object.entries(elements).filter(
        ([id, el]) => only.has(id) || (el.type === 'link' && only.has(el.from) && only.has(el.to)),
      ),
    );
  }
  const layout = layoutDiagram(
    { elements, layers: diagram.layers, variableName: (id) => snap.variables[id]?.name ?? '' },
    theme,
    undefined,
    opts.includeHidden,
  );
  const b = layout.bbox ?? { x: 0, y: 0, w: 200, h: 120 };
  const x = Math.floor(b.x - pad);
  const y = Math.floor(b.y - pad);
  const width = Math.ceil(b.w + pad * 2);
  const height = Math.ceil(b.h + pad * 2);
  const bg = opts.background === undefined ? theme.background : opts.background;
  const body = layout.order
    .map((id) =>
      layout.byId
        .get(id)!
        .prims.map((p) => primToSvg(p, opts.fontMode))
        .join(''),
    )
    .join('\n');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}">\n` +
    (opts.title ? `<title>${escapeXml(opts.title)}</title>\n` : '') +
    (bg
      ? `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${escapeXml(bg)}"/>\n`
      : '') +
    body +
    '\n</svg>\n';
  return { svg, width, height };
}
