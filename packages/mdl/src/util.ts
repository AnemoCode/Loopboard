/** Split a sketch line on commas, keeping double-quoted names (with `\"` escapes) intact. */
export function splitFields(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      cur += ch;
      if (ch === '\\' && i + 1 < line.length) cur += line[++i];
      else if (ch === '"') quoted = false;
    } else if (ch === '"') {
      quoted = true;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Split on a separator outside double quotes. */
export function splitOutsideQuotes(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      cur += ch;
      if (ch === '\\' && i + 1 < s.length) cur += s[++i];
      else if (ch === '"') quoted = false;
    } else if (ch === '"') {
      quoted = true;
      cur += ch;
    } else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function unquote(name: string): string {
  const t = name.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/\\(.)/g, '$1');
  return t;
}

/** Vensim requires quotes around names containing anything but letters, digits, spaces and `_`. */
export function quoteName(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9 _]*$/.test(name) && !name.endsWith(' ')) return name;
  return `"${name.replace(/(["\\])/g, '\\$1')}"`;
}

/** Vensim treats names case-insensitively and `_` like a space. */
export const vensimKey = (name: string): string => name.trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase();

/** `r-g-b` → `#rrggbb`; `-1--1--1` (default) → null. */
export function rgbToHex(rgb: string | undefined): string | null {
  const m = rgb?.trim().match(/^(\d{1,3})-(\d{1,3})-(\d{1,3})$/);
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('')}`;
}

export function hexToRgb(hex: string | null | undefined): string {
  const m = hex?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return '-1--1--1';
  return [m[1], m[2], m[3]].map((v) => parseInt(v!, 16)).join('-');
}

/** Text color stored in a sketch font field `name|size|style|r-g-b`. */
export function fontFieldColor(fields: string[]): string | null {
  const font = fields.find((f, i) => i > 8 && f.startsWith('|'));
  if (!font) return null;
  return rgbToHex(font.split('|')[3]);
}
