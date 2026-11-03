import type { Link, NodeForm, NodeStyle } from '@cld/model';
import { hexToRgb, rgbToHex } from './util.js';

/**
 * Appearance of sketch objects: variable shapes, colors and fonts, and arrow colors and polarity
 * placement.
 *
 * Variable line: `10,id,name,x,y,w,h,sh,bits,hid,hasf,tpos,bw,nav1,nav2[,box,fill,font],…`
 * (Vensim reference, "Sketch Object Detail"). `hasf` flags which formatting fields apply:
 * 1 box (outline) color, 2 word color, 4 fill color, 8 font size, 16 font attributes, 32 font face.
 * The font field is `face|size|attributes|color`, attributes being any of B, U, S, I.
 */

const F = { shape: 7, hasf: 10, bw: 12, box: 15, fill: 16, font: 17 } as const;
const HASF = { box: 1, word: 2, fill: 4, size: 8, attrs: 16, face: 32 } as const;

/**
 * Low 5 bits of `sh`. Box = 3 (Vensim's default for levels), clear box = 8 (default for
 * everything else); circle (2) and diamond (11) were confirmed with a model saved from Vensim.
 * Hexagon = 6 is inferred from ~900 public models: the only unassigned code that, like circle and
 * diamond, is always square. The triangles (likely 9 and 10) are not known yet: they import without
 * an outline and are written back unchanged.
 */
const SHAPE_FORM: Record<number, NodeForm> = {
  2: 'ellipse',
  3: 'rect',
  6: 'hexagon',
  11: 'diamond',
};
const FORM_SHAPE: Record<Exclude<NodeForm, 'none'>, number> = {
  rect: 3,
  rounded: 3,
  ellipse: 2,
  diamond: 11,
  hexagon: 6,
};
/** None (0) and clear box (8) draw no outline. */
const NO_OUTLINE = new Set([0, 8]);

/** Arrow `dtype` bit that puts the polarity sign outside the curve (cleared: inside). */
const POLARITY_OUTSIDE = 128;

interface FontField {
  face: string;
  size: string;
  attrs: string;
  color: string;
}

function parseFont(field: string | undefined): FontField {
  const [face = '', size = '', attrs = '', color = ''] = (field ?? '').split('|');
  return { face, size, attrs, color };
}

const formatFont = (f: FontField) => `${f.face}|${f.size}|${f.attrs}|${f.color}`;

/** Our three font families, guessed from a Vensim font face. */
function familyOf(face: string): NodeStyle['fontFamily'] {
  if (/sans/i.test(face)) return 'sans';
  if (/courier|mono|consolas|menlo|code/i.test(face)) return 'mono';
  if (/times|serif|georgia|garamond|palatino|cambria|roman|baskerville/i.test(face)) return 'serif';
  return 'sans';
}
const DEFAULT_FACE = { serif: 'Times New Roman', mono: 'Courier New' } as const;

/** Black is Vensim's default text and outline color, so it maps to our theme default. */
const isBlack = (rgb: string) => rgb.trim() === '0-0-0';

const STYLE_KEYS = [
  'stroke',
  'fill',
  'strokeWidth',
  'textColor',
  'fontFamily',
  'fontSize',
  'bold',
  'italic',
  'underline',
  'strike',
] as const;

/** The part of a variable's look that Vensim can store, in a canonical form for comparisons. */
export function canonicalAppearance(form: NodeForm, style: NodeStyle | undefined) {
  const s: Record<string, unknown> = {};
  for (const k of STYLE_KEYS) {
    const v = style?.[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'fontFamily' && v === 'sans') continue;
    if ((k === 'stroke' || k === 'textColor') && v === '#000000') continue;
    // Vensim has no outline color or width on shapes without an outline.
    if ((k === 'stroke' || k === 'strokeWidth') && form === 'none') continue;
    s[k] = v;
  }
  return JSON.stringify({ form, ...s });
}

/** Read a variable's form and style from its sketch fields. */
export function readVariableAppearance(f: string[]): {
  form: NodeForm;
  style?: NodeStyle;
  unknownShape?: number;
} {
  const code = Number(f[F.shape]) & 31;
  const form = SHAPE_FORM[code] ?? 'none';
  const unknownShape = SHAPE_FORM[code] || NO_OUTLINE.has(code) ? undefined : code;
  const hasf = Number(f[F.hasf]) || 0;
  const style: NodeStyle = {};
  if (hasf) {
    const font = parseFont(f[F.font]);
    const box = f[F.box] ?? '';
    if (hasf & HASF.box && form !== 'none' && !isBlack(box)) {
      const c = rgbToHex(box);
      if (c) style.stroke = c;
    }
    if (hasf & HASF.fill) {
      const c = rgbToHex(f[F.fill]);
      if (c) style.fill = c;
    }
    if (hasf & HASF.word && !isBlack(font.color)) {
      const c = rgbToHex(font.color);
      if (c) style.textColor = c;
    }
    if (hasf & HASF.size && Number(font.size) >= 6) style.fontSize = Number(font.size);
    if (hasf & HASF.attrs) {
      const a = font.attrs.toUpperCase();
      if (a.includes('B')) style.bold = true;
      if (a.includes('I')) style.italic = true;
      if (a.includes('U')) style.underline = true;
      if (a.includes('S')) style.strike = true;
    }
    if (hasf & HASF.face && font.face) {
      const family = familyOf(font.face);
      if (family !== 'sans') style.fontFamily = family;
    }
  }
  const bw = Number(f[F.bw]) || 0;
  if (bw > 0 && form !== 'none') style.strokeWidth = Math.min(12, bw);
  return {
    form,
    ...(Object.keys(style).length ? { style } : {}),
    ...(unknownShape !== undefined ? { unknownShape } : {}),
  };
}

/**
 * Write a variable's form and style into its sketch fields (in place). Fields are left untouched
 * while they still describe the same look, so unedited objects round-trip byte-for-byte.
 */
export function writeVariableAppearance(
  f: string[],
  form: NodeForm,
  style: NodeStyle | undefined,
  warnings: Set<string>,
): void {
  if (style?.dash && style.dash !== 'solid')
    warnings.add('Dashed outlines are not exported to Vensim.');
  if (style?.align && style.align !== 'center')
    warnings.add('Text alignment is not exported to Vensim.');
  if (form === 'rounded') warnings.add('Rounded boxes are exported to Vensim as plain boxes.');
  if (form !== 'none' && style?.stroke === null)
    warnings.add('Vensim always draws an outline around boxes and other shapes.');
  const before = readVariableAppearance(f);
  if (canonicalAppearance(before.form, before.style) === canonicalAppearance(form, style)) return;

  const shape = Number(f[F.shape]) || 0;
  const code = form === 'none' ? (NO_OUTLINE.has(shape & 31) ? shape & 31 : 8) : FORM_SHAPE[form];
  f[F.shape] = String((shape & ~31) | code);

  const oldHasf = Number(f[F.hasf]) || 0;
  const oldFont = oldHasf ? parseFont(f[F.font]) : { face: '', size: '', attrs: '', color: '' };
  const tail = f.slice(oldHasf ? F.font + 1 : F.box);
  let hasf = 0;
  let box = '0-0-0';
  let fill = '0-0-0';
  const font: FontField = { face: '', size: '', attrs: '', color: '0-0-0' };

  if (form !== 'none' && style?.stroke && style.stroke !== '#000000') {
    hasf |= HASF.box;
    box = hexToRgb(style.stroke);
  } else if (form === 'none' && oldHasf & HASF.box) {
    // An outline color on a clear box is invisible in Vensim; keep it as it was.
    hasf |= HASF.box;
    box = f[F.box] ?? '0-0-0';
  }
  if (style?.fill) {
    hasf |= HASF.fill;
    fill = hexToRgb(style.fill);
  }
  if (style?.textColor && style.textColor !== '#000000') {
    hasf |= HASF.word;
    font.color = hexToRgb(style.textColor);
  }
  if (style?.fontSize) {
    hasf |= HASF.size;
    font.size = String(Math.round(style.fontSize));
  }
  const attrs =
    (style?.bold ? 'B' : '') +
    (style?.underline ? 'U' : '') +
    (style?.strike ? 'S' : '') +
    (style?.italic ? 'I' : '');
  if (attrs) {
    hasf |= HASF.attrs;
    font.attrs = attrs;
  }
  const family = style?.fontFamily ?? 'sans';
  const keepFace = oldFont.face && familyOf(oldFont.face) === family;
  const face = keepFace ? oldFont.face : family === 'sans' ? '' : DEFAULT_FACE[family];
  if (face) {
    hasf |= HASF.face;
    font.face = face;
  }

  f[F.hasf] = String(hasf);
  f[F.bw] = form !== 'none' && style?.strokeWidth ? String(Math.round(style.strokeWidth)) : '0';
  f.splice(F.box, f.length - F.box, ...(hasf ? [box, fill, formatFont(font)] : []), ...tail);
}

// ---------------------------------------------------------------- arrows

/** Arrow line: `1,id,from,to,shape,hid,pol,thick,hasf,dtype,res,color,font,np|points`. */
const A = { hasf: 8, dtype: 9, color: 11 } as const;

/** The arrow color, which Vensim only applies when the first `hasf` bit is set. */
export function readLinkColor(f: string[]): string | null {
  return Number(f[A.hasf]) & 1 ? rgbToHex(f[A.color]) : null;
}

export function readLinkPolaritySide(f: string[]): 'inside' | undefined {
  return Number(f[A.dtype]) & POLARITY_OUTSIDE ? undefined : 'inside';
}

/** Write arrow color and polarity placement (in place), keeping fields that already match. */
export function writeLinkAppearance(f: string[], el: Link): void {
  const color = el.style?.color ?? null;
  if (color !== readLinkColor(f)) {
    const hasf = Number(f[A.hasf]) || 0;
    f[A.hasf] = String(color ? hasf | 1 : hasf & ~1);
    f[A.color] = hexToRgb(color);
  }
  const inside = el.style?.polaritySide === 'inside';
  if (inside !== (readLinkPolaritySide(f) === 'inside')) {
    const dtype = Number(f[A.dtype]) || 0;
    f[A.dtype] = String(inside ? dtype & ~POLARITY_OUTSIDE : dtype | POLARITY_OUTSIDE);
  }
}
