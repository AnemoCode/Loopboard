import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { nanoid } from 'nanoid';

export const newId = (): string => nanoid(12);

/** Fractional-index key after the largest of `keys`. Ties are broken by id when sorting. */
export function keyAfter(keys: Iterable<string>): string {
  let max: string | null = null;
  for (const k of keys) if (max === null || k > max) max = k;
  return generateKeyBetween(max, null);
}

export function keyBefore(keys: Iterable<string>): string {
  let min: string | null = null;
  for (const k of keys) if (min === null || k < min) min = k;
  return generateKeyBetween(null, min);
}

/** `n` ascending keys (for bulk inserts such as imports). */
export const nKeys = (n: number): string[] => generateNKeysBetween(null, null, n);

export const keyBetween = (a: string | null, b: string | null): string => generateKeyBetween(a, b);

/** Sort comparator for things with a fractional `order`/`z` key plus an id tiebreaker. */
export function byKey<T extends { id: string }>(key: (t: T) => string) {
  return (a: T, b: T) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

/** Normalised variable name used for uniqueness checks (Vensim is case/whitespace-insensitive). */
export const normName = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();
