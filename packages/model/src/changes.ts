import type { CommentThread, Diagram, DiagramElement, ProjectSnapshot, Style } from './types.js';

/**
 * Human-readable changelog entries for one transaction (the difference between two snapshots).
 * Moves and reorderings become a single `layout` entry (merged across transactions by the server);
 * everything else is listed individually, except bulk operations (e.g. pasting 20 elements),
 * which are summarised. Every entry carries the `ops` needed to undo exactly that change.
 */
export type ChangeKind =
  | 'add'
  | 'delete'
  | 'rename'
  | 'edit'
  | 'style'
  | 'layout'
  | 'comment'
  | 'structure'
  | 'restore'
  | 'undo';

/** Marker for "this key did not exist". */
export const ABSENT = { $absent: true } as const;
export type Absent = typeof ABSENT;

/**
 * An inverse-able change of one object, addressed by path:
 * `['variables', id]`, `['diagrams', id]`, `['diagrams', id, 'layers', id]`,
 * `['diagrams', id, 'elements', id]`, `['diagrams', id, 'elements', id, 'style']`, `['comments', id]`.
 */
export type ChangeOp =
  /** Whole object created (`before` null) or deleted (`after` null). */
  | { t: 'put'; path: string[]; before: unknown; after: unknown }
  /** Some keys of an object changed. */
  | {
      t: 'fields';
      path: string[];
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };

export interface ChangeEntry {
  kind: ChangeKind;
  /** Sentence without the actor, e.g. `renamed “Births” to “Birth rate”`. */
  summary: string;
  diagramId?: string;
  elementIds?: string[];
  ops: ChangeOp[];
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
  underline: 'underline',
  strike: 'strike-through',
  align: 'alignment',
  color: 'color',
  width: 'line width',
  head: 'arrowhead',
  polaritySide: 'polarity side',
};
const FORM_WORDS: Record<string, string> = {
  none: 'plain text',
  rect: 'box',
  rounded: 'rounded box',
  ellipse: 'oval',
  diamond: 'diamond',
  hexagon: 'hexagon',
};
const json = (v: unknown) => JSON.stringify(v ?? null);
const list = (words: string[]) =>
  words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

// ---------------------------------------------------------------- ops

const valueOf = (o: unknown, k: string): unknown => {
  const rec = o as Record<string, unknown> | undefined;
  return rec && rec[k] !== undefined ? rec[k] : ABSENT;
};

function fieldsOp(path: string[], prev: unknown, next: unknown, keys: string[]): ChangeOp {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of keys) {
    before[k] = valueOf(prev, k);
    after[k] = valueOf(next, k);
  }
  return { t: 'fields', path, before, after };
}

const elPath = (d: string, e: string) => ['diagrams', d, 'elements', e];

/** Merge op lists (later ops win for `after`, earlier ops win for `before`), e.g. for grouped moves. */
export function mergeOps(older: ChangeOp[], newer: ChangeOp[]): ChangeOp[] {
  const out = older.map((o) => structuredClone(o));
  for (const op of newer) {
    const key = op.path.join('/');
    const existing = out.find((o) => o.path.join('/') === key && o.t === op.t);
    if (existing && existing.t === 'fields' && op.t === 'fields') {
      for (const k of Object.keys(op.after)) {
        if (!(k in existing.before)) existing.before[k] = op.before[k];
        existing.after[k] = op.after[k];
      }
    } else if (existing && existing.t === 'put' && op.t === 'put') {
      existing.after = op.after;
    } else out.push(structuredClone(op));
  }
  return out;
}

// ---------------------------------------------------------------- labels

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

interface Line {
  kind: 'edit' | 'style';
  text: string;
  keys: string[];
  style?: boolean;
}

function elementChanges(
  prevEl: DiagramElement,
  el: DiagramElement,
  d: Diagram,
  prevD: Diagram,
  next: ProjectSnapshot,
  prev: ProjectSnapshot,
  movedNodes: Set<string>,
): { layoutKeys: string[]; lines: Line[] } {
  const lines: Line[] = [];
  const name = label(el, d, next, prev);
  const p = prevEl as unknown as Record<string, unknown>;
  const n = el as unknown as Record<string, unknown>;
  const changed = (k: string) => json(p[k]) !== json(n[k]);
  const edit = (text: string, ...keys: string[]) => lines.push({ kind: 'edit', text, keys });

  const layoutKeys = (el.type === 'link' ? ['z', 'layerId'] : ['x', 'y', 'z', 'layerId']).filter(
    changed,
  );
  const resized = ['w', 'h', 'r'].filter(changed);
  if (resized.length) edit(`resized ${name}`, ...resized);
  if (el.type === 'link' && prevEl.type === 'link') {
    if (changed('from') || changed('to'))
      edit(
        `reconnected link ${label(prevEl, prevD, prev, next)} to ${name}`,
        'from',
        'to',
        'control',
      );
    else if (changed('control')) {
      // A curve that only followed a moved endpoint is part of the move.
      if (movedNodes.has(el.from) || movedNodes.has(el.to)) layoutKeys.push('control');
      else edit(el.control ? `curved link ${name}` : `straightened link ${name}`, 'control');
    }
    if (changed('polarity'))
      edit(
        el.polarity
          ? `set polarity of ${name} to ${POLARITY_WORD[el.polarity]}`
          : `removed polarity from ${name}`,
        'polarity',
      );
    if (changed('delay'))
      edit(
        el.delay ? `added a delay mark to ${name}` : `removed the delay mark from ${name}`,
        'delay',
      );
    if (changed('label'))
      edit(el.label ? `labelled ${name} ${q(el.label)}` : `removed the label of ${name}`, 'label');
  }
  if (el.type === 'loop' && prevEl.type === 'loop') {
    if (changed('label')) edit(`renamed loop marker ${q(prevEl.label)} to ${q(el.label)}`, 'label');
    if (changed('kind'))
      edit(
        `marked ${name} as ${el.kind === 'R' ? 'reinforcing' : el.kind === 'B' ? 'balancing' : 'custom'}`,
        'kind',
      );
    if (changed('direction'))
      edit(
        `made ${name} ${el.direction === 'cw' ? 'clockwise' : 'counter-clockwise'}`,
        'direction',
      );
    if (changed('name'))
      edit(el.name ? `named ${name} ${q(el.name)}` : `removed the name of ${name}`, 'name');
  }
  if ((el.type === 'text' || el.type === 'shape') && changed('text')) {
    edit(
      el.type === 'text'
        ? `edited ${name}`
        : `changed the text of ${FORM_WORDS[(el as { shape: string }).shape]} to ${q(String(n.text ?? ''))}`,
      'text',
    );
  }
  if (changed('form')) edit(`changed ${name} to ${FORM_WORDS[String(n.form)]}`, 'form');
  if (changed('shape')) edit(`changed shape to ${FORM_WORDS[String(n.shape)]}`, 'shape');
  if (changed('locked')) edit(`${el.locked ? 'locked' : 'unlocked'} ${name}`, 'locked');
  const ps = (prevEl.style ?? {}) as Record<string, unknown>;
  const ns = (el.style ?? {}) as Record<string, unknown>;
  const styleKeys = [...new Set([...Object.keys(ps), ...Object.keys(ns)])].filter(
    (k) => json(ps[k]) !== json(ns[k]),
  );
  if (styleKeys.length) {
    lines.push({
      kind: 'style',
      text: `changed ${list(styleKeys.map((k) => STYLE_WORDS[k as keyof Style] ?? k))} of ${name}`,
      keys: styleKeys,
      style: true,
    });
  }
  return { layoutKeys, lines };
}

// ---------------------------------------------------------------- describe

export function describeChanges(prev: ProjectSnapshot, next: ProjectSnapshot): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  const diagramIds = new Set([...Object.keys(prev.diagrams), ...Object.keys(next.diagrams)]);
  const diagramOrderOps: ChangeOp[] = [];

  // Variables created/removed together with their nodes travel with the node's entry.
  const addedVars = new Set(Object.keys(next.variables).filter((v) => !prev.variables[v]));
  const removedVars = new Set(Object.keys(prev.variables).filter((v) => !next.variables[v]));
  const varOps = (els: DiagramElement[], set: Set<string>, added: boolean): ChangeOp[] => {
    const ops: ChangeOp[] = [];
    for (const el of els) {
      if (el.type !== 'variable' || !set.has(el.variableId)) continue;
      set.delete(el.variableId);
      ops.push({
        t: 'put',
        path: ['variables', el.variableId],
        before: added ? null : prev.variables[el.variableId],
        after: added ? next.variables[el.variableId] : null,
      });
    }
    return ops;
  };
  // Comments removed together with a diagram travel with the diagram's entry.
  const claimedComments = new Set<string>();
  const commentPut = (t: CommentThread, deleted: boolean): ChangeOp => ({
    t: 'put',
    path: ['comments', t.id],
    before: deleted ? t : null,
    after: deleted ? null : t,
  });

  for (const id of diagramIds) {
    const pd = prev.diagrams[id];
    const nd = next.diagrams[id];
    if (!pd && nd) {
      const els = Object.values(nd.elements);
      entries.push({
        kind: 'structure',
        summary: `added diagram ${q(nd.name)}${els.length ? ` with ${plural(els.length, 'element')}` : ''}`,
        diagramId: id,
        ops: [
          ...varOps(els, addedVars, true),
          { t: 'put', path: ['diagrams', id], before: null, after: nd },
        ],
      });
      continue;
    }
    if (pd && !nd) {
      const threads = Object.values(prev.comments).filter(
        (t) => t.diagramId === id && !next.comments[t.id],
      );
      threads.forEach((t) => claimedComments.add(t.id));
      entries.push({
        kind: 'delete',
        summary: `deleted diagram ${q(pd.name)}`,
        ops: [
          ...varOps(Object.values(pd.elements), removedVars, false),
          { t: 'put', path: ['diagrams', id], before: pd, after: null },
          ...threads.map((t) => commentPut(t, true)),
        ],
      });
      continue;
    }
    if (!pd || !nd) continue;
    if (pd.name !== nd.name)
      entries.push({
        kind: 'rename',
        summary: `renamed diagram ${q(pd.name)} to ${q(nd.name)}`,
        diagramId: id,
        ops: [fieldsOp(['diagrams', id], pd, nd, ['name'])],
      });
    if (pd.order !== nd.order) diagramOrderOps.push(fieldsOp(['diagrams', id], pd, nd, ['order']));

    // Layers
    const layerOrderOps: ChangeOp[] = [];
    for (const lid of new Set([...Object.keys(pd.layers), ...Object.keys(nd.layers)])) {
      const pl = pd.layers[lid];
      const nl = nd.layers[lid];
      const path = ['diagrams', id, 'layers', lid];
      if (!pl && nl)
        entries.push({
          kind: 'structure',
          summary: `added layer ${q(nl.name)}`,
          diagramId: id,
          ops: [{ t: 'put', path, before: null, after: nl }],
        });
      else if (pl && !nl)
        entries.push({
          kind: 'delete',
          summary: `deleted layer ${q(pl.name)}`,
          diagramId: id,
          ops: [{ t: 'put', path, before: pl, after: null }],
        });
      else if (pl && nl) {
        if (pl.name !== nl.name)
          entries.push({
            kind: 'rename',
            summary: `renamed layer ${q(pl.name)} to ${q(nl.name)}`,
            diagramId: id,
            ops: [fieldsOp(path, pl, nl, ['name'])],
          });
        if (pl.visible !== nl.visible)
          entries.push({
            kind: 'edit',
            summary: `${nl.visible ? 'showed' : 'hid'} layer ${q(nl.name)}`,
            diagramId: id,
            ops: [fieldsOp(path, pl, nl, ['visible'])],
          });
        if (pl.locked !== nl.locked)
          entries.push({
            kind: 'edit',
            summary: `${nl.locked ? 'locked' : 'unlocked'} layer ${q(nl.name)}`,
            diagramId: id,
            ops: [fieldsOp(path, pl, nl, ['locked'])],
          });
        if (pl.order !== nl.order) layerOrderOps.push(fieldsOp(path, pl, nl, ['order']));
      }
    }
    if (layerOrderOps.length)
      entries.push({
        kind: 'layout',
        summary: 'reordered layers',
        diagramId: id,
        ops: layerOrderOps,
      });

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
    const createOp = (el: DiagramElement): ChangeOp => ({
      t: 'put',
      path: elPath(id, el.id),
      before: null,
      after: el,
    });
    const deleteOp = (el: DiagramElement): ChangeOp => ({
      t: 'put',
      path: elPath(id, el.id),
      before: el,
      after: null,
    });

    if (added.length > BULK) {
      const counts = new Map<string, number>();
      for (const el of added)
        counts.set(TYPE_WORD[el.type], (counts.get(TYPE_WORD[el.type]) ?? 0) + 1);
      entries.push({
        kind: 'add',
        summary: `added ${list([...counts].map(([w, c]) => plural(c, w)))}`,
        diagramId: id,
        elementIds: added.map((e) => e.id),
        ops: [...varOps(added, addedVars, true), ...added.map(createOp)],
      });
    } else {
      for (const el of added)
        entries.push({
          kind: 'add',
          summary: describeAdd(el, nd, next),
          diagramId: id,
          elementIds: [el.id],
          ops: [...varOps([el], addedVars, true), createOp(el)],
        });
    }

    // Deletions: links attached to a deleted node are folded into that node's entry.
    const removedIds = new Set(removed.map((e) => e.id));
    const folded = new Set<string>();
    const delEntries: ChangeEntry[] = [];
    for (const el of removed) {
      if (el.type === 'link') continue;
      const links =
        el.type === 'variable'
          ? removed.filter(
              (e) => e.type === 'link' && !folded.has(e.id) && (e.from === el.id || e.to === el.id),
            )
          : [];
      links.forEach((l) => folded.add(l.id));
      delEntries.push({
        kind: 'delete',
        summary: `deleted ${el.type === 'variable' ? 'variable ' : ''}${label(el, pd, prev, next)}${links.length ? ` and ${plural(links.length, 'attached link')}` : ''}`,
        diagramId: id,
        ops: [...varOps([el], removedVars, false), deleteOp(el), ...links.map(deleteOp)],
      });
    }
    for (const el of removed) {
      if (el.type !== 'link' || folded.has(el.id)) continue;
      // Links between two deleted nodes are already covered by those nodes.
      const coveredBy = delEntries.find((e) =>
        e.ops.some((o) => o.path[3] === el.from || o.path[3] === el.to),
      );
      if (coveredBy && (removedIds.has(el.from) || removedIds.has(el.to))) {
        coveredBy.ops.push(deleteOp(el));
        continue;
      }
      delEntries.push({
        kind: 'delete',
        summary: `deleted link ${label(el, pd, prev, next)}`,
        diagramId: id,
        ops: [deleteOp(el)],
      });
    }
    if (delEntries.length > BULK) {
      const counts = new Map<string, number>();
      for (const el of removed)
        counts.set(TYPE_WORD[el.type], (counts.get(TYPE_WORD[el.type]) ?? 0) + 1);
      entries.push({
        kind: 'delete',
        summary: `deleted ${list([...counts].map(([w, c]) => plural(c, w)))}`,
        diagramId: id,
        ops: delEntries.flatMap((e) => e.ops),
      });
    } else entries.push(...delEntries);

    // Changes
    const layoutOps: ChangeOp[] = [];
    const layoutIds: string[] = [];
    const styleEntries: ChangeEntry[] = [];
    for (const [pe, ne] of changedPairs) {
      const { layoutKeys, lines } = elementChanges(pe, ne, nd, pd, next, prev, movedNodes);
      if (layoutKeys.length) {
        layoutOps.push(fieldsOp(elPath(id, ne.id), pe, ne, layoutKeys));
        if (ne.type !== 'link' || layoutKeys.some((k) => k !== 'control')) layoutIds.push(ne.id);
      }
      for (const line of lines) {
        const op = line.style
          ? fieldsOp([...elPath(id, ne.id), 'style'], pe.style ?? {}, ne.style ?? {}, line.keys)
          : fieldsOp(elPath(id, ne.id), pe, ne, line.keys);
        const e: ChangeEntry = {
          kind: line.kind,
          summary: line.text,
          diagramId: id,
          elementIds: [ne.id],
          ops: [op],
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
        ops: styleEntries.flatMap((e) => e.ops),
      });
    } else entries.push(...styleEntries);
    if (layoutOps.length) {
      if (layoutIds.length)
        entries.push({
          kind: 'layout',
          summary: layoutSummary(layoutIds.length),
          diagramId: id,
          elementIds: layoutIds,
          ops: layoutOps,
        });
      else entries[entries.length - 1]?.ops.push(...layoutOps);
    }
  }
  if (diagramOrderOps.length)
    entries.push({ kind: 'layout', summary: 'reordered diagrams', ops: diagramOrderOps });

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
    const path = ['variables', vid];
    if (pv.name !== nv.name)
      entries.push({
        kind: 'rename',
        summary: `renamed ${q(pv.name)} to ${q(nv.name)}`,
        ...base,
        ops: [fieldsOp(path, pv, nv, ['name'])],
      });
    if ((pv.units ?? '') !== (nv.units ?? ''))
      entries.push({
        kind: 'edit',
        summary: `changed the units of ${q(nv.name)}`,
        ...base,
        ops: [fieldsOp(path, pv, nv, ['units'])],
      });
    if ((pv.notes ?? '') !== (nv.notes ?? ''))
      entries.push({
        kind: 'edit',
        summary: `edited the notes of ${q(nv.name)}`,
        ...base,
        ops: [fieldsOp(path, pv, nv, ['notes'])],
      });
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
    const path = ['comments', tid];
    if (!pt)
      entries.push({
        kind: 'comment',
        summary: `commented${anchor}: ${q(nt.messages[0]?.body ?? '')}`,
        ...base,
        ops: [commentPut(nt, false)],
      });
    else {
      if (json(pt.messages) !== json(nt.messages)) {
        const text =
          nt.messages.length > pt.messages.length
            ? `replied${anchor}: ${q(nt.messages[nt.messages.length - 1]!.body)}`
            : `edited a comment${anchor}`;
        entries.push({
          kind: 'comment',
          summary: text,
          ...base,
          ops: [fieldsOp(path, pt, nt, ['messages'])],
        });
      }
      if (pt.resolved !== nt.resolved)
        entries.push({
          kind: 'comment',
          summary: `${nt.resolved ? 'resolved' : 'reopened'} a comment${anchor}`,
          ...base,
          ops: [fieldsOp(path, pt, nt, ['resolved'])],
        });
      // A comment detached because its element was deleted: undoing the deletion re-attaches it.
      const moved = ['x', 'y', 'elementId'].filter(
        (k) => json(valueOf(pt, k)) !== json(valueOf(nt, k)),
      );
      const owner = pt.elementId
        ? entries.find((e) => e.ops.some((o) => o.t === 'put' && o.path[3] === pt.elementId))
        : undefined;
      if (moved.length && owner) owner.ops.push(fieldsOp(path, pt, nt, moved));
    }
  }
  for (const [tid, pt] of Object.entries(prev.comments)) {
    if (!next.comments[tid] && !claimedComments.has(tid))
      entries.push({
        kind: 'comment',
        summary: 'deleted a comment',
        diagramId: pt.diagramId,
        ops: [commentPut(pt, true)],
      });
  }

  // Variables created/removed without a node change (e.g. garbage collection) go with the last entry.
  for (const vid of addedVars)
    entries[entries.length - 1]?.ops.push({
      t: 'put',
      path: ['variables', vid],
      before: null,
      after: next.variables[vid],
    });
  for (const vid of removedVars)
    entries[entries.length - 1]?.ops.push({
      t: 'put',
      path: ['variables', vid],
      before: prev.variables[vid],
      after: null,
    });
  return entries;
}

export const layoutSummary = (count: number) =>
  count === 1 ? 'moved 1 element' : `rearranged ${count} elements`;
