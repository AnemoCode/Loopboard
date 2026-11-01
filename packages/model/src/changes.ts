import type { Diagram, DiagramElement, ProjectSnapshot, Style } from './types.js';

/**
 * Human-readable changelog entries for one transaction (the difference between two snapshots).
 * Moves and reorderings become a single `layout` entry (merged across transactions by the server);
 * everything else is listed individually, except bulk operations (e.g. pasting 20 elements),
 * which are summarised.
 */
export type ChangeKind =
  'add' | 'delete' | 'rename' | 'edit' | 'style' | 'layout' | 'comment' | 'structure' | 'restore';

export interface ChangeEntry {
  kind: ChangeKind;
  /** Sentence without the actor, e.g. `renamed “Births” to “Birth rate”`. */
  summary: string;
  diagramId?: string;
  elementIds?: string[];
}

const BULK = 3;
const q = (s: string) => `“${s.length > 40 ? `${s.slice(0, 39)}…` : s}”`;
const TYPE_WORD: Record<DiagramElement['type'], string> = {
  variable: 'variable',
  link: 'link',
  loop: 'loop marker',
  shape: 'shape',
  text: 'text',
};
const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? '' : word.endsWith('s') ? 'es' : 's'}`;
const POLARITY_WORD: Record<string, string> = { '+': '+', '-': '–', '?': '?' };
const STYLE_WORDS: Record<keyof Style, string> = {
  fill: 'fill',
  stroke: 'border',
  strokeWidth: 'border width',
  dash: 'line style',
  textColor: 'text color',
  fontFamily: 'font',
  fontSize: 'font size',
  bold: 'bold',
  italic: 'italic',
  align: 'alignment',
  color: 'color',
  width: 'line width',
  head: 'arrowhead',
};
const FORM_WORDS: Record<string, string> = {
  none: 'plain text',
  rect: 'box',
  rounded: 'rounded box',
  ellipse: 'oval',
  diamond: 'diamond',
};
const json = (v: unknown) => JSON.stringify(v ?? null);
const list = (words: string[]) =>
  words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

function label(
  el: DiagramElement,
  d: Diagram,
  snap: ProjectSnapshot,
  other?: ProjectSnapshot,
): string {
  const varName = (id: string) => snap.variables[id]?.name ?? other?.variables[id]?.name ?? '?';
  const nodeName = (elementId: string) => {
    const n = d.elements[elementId];
    return n?.type === 'variable' ? varName(n.variableId) : '?';
  };
  switch (el.type) {
    case 'variable':
      return q(varName(el.variableId));
    case 'link':
      return q(`${nodeName(el.from)} → ${nodeName(el.to)}`);
    case 'loop':
      return `loop marker ${q(el.label || el.kind)}`;
    case 'text':
      return `text ${q(el.text.replace(/\s+/g, ' ').trim() || '…')}`;
    case 'shape':
      return el.text ? `shape ${q(el.text)}` : FORM_WORDS[el.shape]!;
  }
}

function describeAdd(el: DiagramElement, d: Diagram, snap: ProjectSnapshot): string {
  const extra = el.type === 'link' && el.polarity ? ` (${POLARITY_WORD[el.polarity]})` : '';
  if (el.type === 'variable')
    return `added ${el.isShadow ? 'a copy of ' : ''}variable ${label(el, d, snap)}`;
  if (el.type === 'link') return `added link ${label(el, d, snap)}${extra}`;
  return `added ${label(el, d, snap)}`;
}

function elementChanges(
  prevEl: DiagramElement,
  el: DiagramElement,
  d: Diagram,
  prevD: Diagram,
  next: ProjectSnapshot,
  prev: ProjectSnapshot,
  movedNodes: Set<string>,
): { layout: boolean; entries: { kind: 'edit' | 'style'; text: string }[] } {
  const lines: string[] = [];
  const out: { kind: 'edit' | 'style'; text: string }[] = [];
  let layout = false;
  const name = label(el, d, next, prev);
  const p = prevEl as unknown as Record<string, unknown>;
  const n = el as unknown as Record<string, unknown>;
  const changed = (k: string) => json(p[k]) !== json(n[k]);

  if (el.type !== 'link' && (changed('x') || changed('y'))) layout = true;
  if (changed('z') || changed('layerId')) layout = true;
  if (changed('w') || changed('h') || changed('r')) lines.push(`resized ${name}`);
  if (el.type === 'link' && prevEl.type === 'link') {
    if (changed('from') || changed('to'))
      lines.push(`reconnected link ${label(prevEl, prevD, prev, next)} to ${name}`);
    else if (changed('control') && !movedNodes.has(el.from) && !movedNodes.has(el.to)) {
      lines.push(el.control ? `curved link ${name}` : `straightened link ${name}`);
    }
    if (changed('polarity'))
      lines.push(
        el.polarity
          ? `set polarity of ${name} to ${POLARITY_WORD[el.polarity]}`
          : `removed polarity from ${name}`,
      );
    if (changed('delay'))
      lines.push(
        el.delay ? `added a delay mark to ${name}` : `removed the delay mark from ${name}`,
      );
    if (changed('label'))
      lines.push(el.label ? `labelled ${name} ${q(el.label)}` : `removed the label of ${name}`);
  }
  if (el.type === 'loop' && prevEl.type === 'loop') {
    if (changed('label')) lines.push(`renamed loop marker ${q(prevEl.label)} to ${q(el.label)}`);
    if (changed('kind'))
      lines.push(
        `marked ${name} as ${el.kind === 'R' ? 'reinforcing' : el.kind === 'B' ? 'balancing' : 'custom'}`,
      );
    if (changed('direction'))
      lines.push(`made ${name} ${el.direction === 'cw' ? 'clockwise' : 'counter-clockwise'}`);
    if (changed('name'))
      lines.push(el.name ? `named ${name} ${q(el.name)}` : `removed the name of ${name}`);
  }
  if ((el.type === 'text' || el.type === 'shape') && changed('text')) {
    lines.push(
      el.type === 'text'
        ? `edited ${name}`
        : `changed the text of ${FORM_WORDS[(el as { shape: string }).shape]} to ${q(String(n.text ?? ''))}`,
    );
  }
  if (changed('form')) lines.push(`changed ${name} to ${FORM_WORDS[String(n.form)]}`);
  if (changed('shape')) lines.push(`changed shape to ${FORM_WORDS[String(n.shape)]}`);
  if (changed('locked')) lines.push(`${el.locked ? 'locked' : 'unlocked'} ${name}`);
  const ps = (prevEl.style ?? {}) as Record<string, unknown>;
  const ns = (el.style ?? {}) as Record<string, unknown>;
  const styleKeys = [...new Set([...Object.keys(ps), ...Object.keys(ns)])].filter(
    (k) => json(ps[k]) !== json(ns[k]),
  );
  for (const text of lines) out.push({ kind: 'edit', text });
  if (styleKeys.length)
    out.push({
      kind: 'style',
      text: `changed ${list(styleKeys.map((k) => STYLE_WORDS[k as keyof Style] ?? k))} of ${name}`,
    });
  return { layout, entries: out };
}

export function describeChanges(prev: ProjectSnapshot, next: ProjectSnapshot): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  const diagramIds = new Set([...Object.keys(prev.diagrams), ...Object.keys(next.diagrams)]);
  let diagramOrderChanged = false;

  for (const id of diagramIds) {
    const pd = prev.diagrams[id];
    const nd = next.diagrams[id];
    if (!pd && nd) {
      const count = Object.keys(nd.elements).length;
      entries.push({
        kind: 'structure',
        summary: `added diagram ${q(nd.name)}${count ? ` with ${plural(count, 'element')}` : ''}`,
        diagramId: id,
      });
      continue;
    }
    if (pd && !nd) {
      entries.push({ kind: 'delete', summary: `deleted diagram ${q(pd.name)}` });
      continue;
    }
    if (!pd || !nd) continue;
    if (pd.name !== nd.name)
      entries.push({
        kind: 'rename',
        summary: `renamed diagram ${q(pd.name)} to ${q(nd.name)}`,
        diagramId: id,
      });
    if (pd.order !== nd.order) diagramOrderChanged = true;

    // Layers
    let layerOrderChanged = false;
    for (const lid of new Set([...Object.keys(pd.layers), ...Object.keys(nd.layers)])) {
      const pl = pd.layers[lid];
      const nl = nd.layers[lid];
      if (!pl && nl)
        entries.push({ kind: 'structure', summary: `added layer ${q(nl.name)}`, diagramId: id });
      else if (pl && !nl)
        entries.push({ kind: 'delete', summary: `deleted layer ${q(pl.name)}`, diagramId: id });
      else if (pl && nl) {
        if (pl.name !== nl.name)
          entries.push({
            kind: 'rename',
            summary: `renamed layer ${q(pl.name)} to ${q(nl.name)}`,
            diagramId: id,
          });
        if (pl.visible !== nl.visible)
          entries.push({
            kind: 'edit',
            summary: `${nl.visible ? 'showed' : 'hid'} layer ${q(nl.name)}`,
            diagramId: id,
          });
        if (pl.locked !== nl.locked)
          entries.push({
            kind: 'edit',
            summary: `${nl.locked ? 'locked' : 'unlocked'} layer ${q(nl.name)}`,
            diagramId: id,
          });
        if (pl.order !== nl.order) layerOrderChanged = true;
      }
    }
    if (layerOrderChanged)
      entries.push({ kind: 'layout', summary: 'reordered layers', diagramId: id });

    // Elements
    const added: DiagramElement[] = [];
    const removed: DiagramElement[] = [];
    const movedNodes = new Set<string>();
    const changedPairs: [DiagramElement, DiagramElement][] = [];
    for (const eid of new Set([...Object.keys(pd.elements), ...Object.keys(nd.elements)])) {
      const pe = pd.elements[eid];
      const ne = nd.elements[eid];
      if (!pe && ne) added.push(ne);
      else if (pe && !ne) removed.push(pe);
      else if (pe && ne && json(pe) !== json(ne)) {
        changedPairs.push([pe, ne]);
        if (ne.type !== 'link' && pe.type !== 'link' && (pe.x !== ne.x || pe.y !== ne.y))
          movedNodes.add(eid);
      }
    }

    // Additions (links whose endpoints were added together are part of the bulk count only).
    const addLines = added.map((el) => ({ el, text: describeAdd(el, nd, next) }));
    if (addLines.length > BULK) {
      const counts = new Map<string, number>();
      for (const { el } of addLines)
        counts.set(TYPE_WORD[el.type], (counts.get(TYPE_WORD[el.type]) ?? 0) + 1);
      entries.push({
        kind: 'add',
        summary: `added ${list([...counts].map(([w, c]) => plural(c, w)))}`,
        diagramId: id,
        elementIds: added.map((e) => e.id),
      });
    } else {
      for (const { el, text } of addLines)
        entries.push({ kind: 'add', summary: text, diagramId: id, elementIds: [el.id] });
    }

    // Deletions: links attached to a deleted node are folded into that node's entry.
    const removedIds = new Set(removed.map((e) => e.id));
    const attached = (nodeId: string) =>
      removed.filter((e) => e.type === 'link' && (e.from === nodeId || e.to === nodeId));
    const folded = new Set<string>();
    const delLines: string[] = [];
    for (const el of removed) {
      if (el.type === 'link') continue;
      const links = el.type === 'variable' ? attached(el.id).filter((l) => !folded.has(l.id)) : [];
      links.forEach((l) => folded.add(l.id));
      delLines.push(
        `deleted ${el.type === 'variable' ? 'variable ' : ''}${label(el, pd, prev, next)}${links.length ? ` and ${plural(links.length, 'attached link')}` : ''}`,
      );
    }
    for (const el of removed) {
      if (
        el.type === 'link' &&
        !folded.has(el.id) &&
        !(removedIds.has(el.from) || removedIds.has(el.to))
      )
        delLines.push(`deleted link ${label(el, pd, prev, next)}`);
    }
    if (delLines.length > BULK) {
      const counts = new Map<string, number>();
      for (const el of removed)
        counts.set(TYPE_WORD[el.type], (counts.get(TYPE_WORD[el.type]) ?? 0) + 1);
      entries.push({
        kind: 'delete',
        summary: `deleted ${list([...counts].map(([w, c]) => plural(c, w)))}`,
        diagramId: id,
      });
    } else for (const s of delLines) entries.push({ kind: 'delete', summary: s, diagramId: id });

    // Changes
    const layoutIds: string[] = [];
    const styleEntries: ChangeEntry[] = [];
    for (const [pe, ne] of changedPairs) {
      const { layout, entries: lines } = elementChanges(pe, ne, nd, pd, next, prev, movedNodes);
      if (layout) layoutIds.push(ne.id);
      for (const line of lines) {
        const e: ChangeEntry = {
          kind: line.kind,
          summary: line.text,
          diagramId: id,
          elementIds: [ne.id],
        };
        (e.kind === 'style' ? styleEntries : entries).push(e);
      }
    }
    if (styleEntries.length > BULK) {
      entries.push({
        kind: 'style',
        summary: `changed the style of ${plural(styleEntries.length, 'element')}`,
        diagramId: id,
        elementIds: styleEntries.flatMap((e) => e.elementIds ?? []),
      });
    } else entries.push(...styleEntries);
    if (layoutIds.length)
      entries.push({
        kind: 'layout',
        summary: layoutSummary(layoutIds.length),
        diagramId: id,
        elementIds: layoutIds,
      });
  }
  if (diagramOrderChanged) entries.push({ kind: 'layout', summary: 'reordered diagrams' });

  // Variables (names, units, notes)
  for (const [vid, nv] of Object.entries(next.variables)) {
    const pv = prev.variables[vid];
    if (!pv) continue;
    const where = Object.values(next.diagrams).find((d) =>
      Object.values(d.elements).some((e) => e.type === 'variable' && e.variableId === vid),
    );
    const nodes = where
      ? Object.values(where.elements)
          .filter((e) => e.type === 'variable' && e.variableId === vid)
          .map((e) => e.id)
      : [];
    const base = { diagramId: where?.id, elementIds: nodes };
    if (pv.name !== nv.name)
      entries.push({ kind: 'rename', summary: `renamed ${q(pv.name)} to ${q(nv.name)}`, ...base });
    if ((pv.units ?? '') !== (nv.units ?? ''))
      entries.push({ kind: 'edit', summary: `changed the units of ${q(nv.name)}`, ...base });
    if ((pv.notes ?? '') !== (nv.notes ?? ''))
      entries.push({ kind: 'edit', summary: `edited the notes of ${q(nv.name)}`, ...base });
  }

  // Comments
  for (const [tid, nt] of Object.entries(next.comments)) {
    const pt = prev.comments[tid];
    const d = next.diagrams[nt.diagramId];
    const anchor =
      nt.elementId && d?.elements[nt.elementId]
        ? ` on ${label(d.elements[nt.elementId]!, d, next)}`
        : '';
    const base = { diagramId: nt.diagramId, elementIds: nt.elementId ? [nt.elementId] : undefined };
    if (!pt)
      entries.push({
        kind: 'comment',
        summary: `commented${anchor}: ${q(nt.messages[0]?.body ?? '')}`,
        ...base,
      });
    else {
      if (nt.messages.length > pt.messages.length)
        entries.push({
          kind: 'comment',
          summary: `replied${anchor}: ${q(nt.messages[nt.messages.length - 1]!.body)}`,
          ...base,
        });
      if (pt.resolved !== nt.resolved)
        entries.push({
          kind: 'comment',
          summary: `${nt.resolved ? 'resolved' : 'reopened'} a comment${anchor}`,
          ...base,
        });
    }
  }
  for (const tid of Object.keys(prev.comments)) {
    if (!next.comments[tid])
      entries.push({
        kind: 'comment',
        summary: 'deleted a comment',
        diagramId: prev.comments[tid]!.diagramId,
      });
  }
  return entries;
}

export const layoutSummary = (count: number) =>
  count === 1 ? 'moved 1 element' : `rearranged ${count} elements`;
