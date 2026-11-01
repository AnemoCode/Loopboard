import type { FontFamily } from '@cld/model';
import { METRICS } from './metrics.js';

export interface Font {
  family: FontFamily;
  size: number;
  bold: boolean;
  italic: boolean;
}

export const LINE_HEIGHT = 1.25;

/** CSS font stacks. Each stack is metric-compatible with the PDF base font it is measured with. */
export const FONT_STACKS: Record<FontFamily, string> = {
  sans: 'Helvetica, Arial, "Liberation Sans", "Nimbus Sans", sans-serif',
  serif: 'Times, "Times New Roman", "Liberation Serif", serif',
  mono: 'Courier, "Courier New", "Liberation Mono", monospace',
};

/** Names of the matching jsPDF base-14 fonts (used for PDF export). */
export const PDF_FONTS: Record<FontFamily, string> = {
  sans: 'helvetica',
  serif: 'times',
  mono: 'courier',
};

const FALLBACK = 600;

export function measureText(text: string, font: Font): number {
  const table = METRICS[`${font.family}-${font.bold ? 'bold' : 'normal'}`]!;
  let units = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    units += c >= 32 && c < 256 ? table[c - 32]! : FALLBACK;
  }
  return (units * font.size) / 1000;
}

/** Greedy word wrap. Honours explicit newlines; breaks words longer than the line. */
export function wrapText(text: string, font: Font, maxWidth: number): string[] {
  const out: string[] = [];
  const width = Math.max(maxWidth, font.size);
  for (const para of text.split('\n')) {
    const words = para.split(/ +/).filter((w, i, arr) => w !== '' || arr.length === 1);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measureText(candidate, font) <= width) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      if (measureText(word, font) <= width) {
        line = word;
        continue;
      }
      // Hard-break an overlong word.
      let chunk = '';
      for (const ch of word) {
        if (measureText(chunk + ch, font) > width && chunk) {
          out.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    }
    out.push(line);
  }
  return out;
}
