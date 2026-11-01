import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { addElement, addVariableNode, deleteElements, renameVariable, updateElement, type DiagramElement } from '@cld/model';
import { FONT_STACKS, LINE_HEIGHT, measureText, type Font, type DiagramLayout } from '@cld/render';
import { useEditorCtx } from '../context';
import { LOCAL } from '../session';
import { editor, useEditor } from '../store';

const DEFAULT_FONT: Font = { family: 'sans', size: 12, bold: false, italic: false };

/** Inline text editing overlay, positioned over the element in screen space with matching font metrics. */
export function TextEditor({ layout, elements }: { layout: DiagramLayout; elements: Record<string, DiagramElement> }) {
  const ctx = useEditorCtx();
  const { editing, viewport } = useEditor();
  const set = useEditor((s) => s.set);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  const el = editing?.kind === 'element' ? elements[editing.id] : undefined;
  const lay = editing?.kind === 'element' ? layout.byId.get(editing.id) : undefined;
  const initial =
    el?.type === 'variable' ? (ctx.store.get().variables[el.variableId]?.name ?? '') : el?.type === 'text' ? el.text : el?.type === 'shape' ? (el.text ?? '') : '';
  const [value, setValue] = useState(initial);
  const multiline = editing?.kind === 'new-text' || el?.type === 'text' || el?.type === 'shape';

  useEffect(() => {
    done.current = false;
    setValue(initial);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const font = lay?.text?.font ?? DEFAULT_FONT;
  const align = lay?.text?.align ?? 'center';
  let box: { x: number; y: number; w: number };
  if (lay?.text) box = lay.text.box;
  else if (editing && editing.kind !== 'element') {
    const w = editing.kind === 'new-text' ? Math.max(160, measureText(value, font) + 8) : Math.max(100, Math.min(220, measureText(value, font) + 8));
    box = { x: editing.x - w / 2, y: editing.y - (font.size * LINE_HEIGHT) / 2, w };
  } else box = { x: 0, y: 0, w: 100 };

  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = '0px';
    t.style.height = `${t.scrollHeight}px`;
  }, [value, viewport.zoom, box.w]);

  if (!editing || (editing.kind === 'element' && (!el || !lay))) return null;

  const close = () => set({ editing: null });

  const commit = () => {
    if (done.current) return;
    done.current = true;
    const st = editor();
    const doc = ctx.session.doc;
    const dId = st.diagramId!;
    const text = value.replace(/\s+$/g, '');
    if (editing.kind === 'new-variable') {
      const layerId = st.layerId;
      if (text.trim() && layerId) doc.transact(() => {
        const id = addVariableNode(doc, dId, { name: text, x: editing.x, y: editing.y, layerId, w: Math.max(80, Math.min(140, measureText(text, font) + 8)) }, LOCAL);
        if (editing.linkFrom) {
          const linkId = addElement(doc, dId, { type: 'link', layerId, from: editing.linkFrom, to: id, control: null, polarity: null }, LOCAL);
          set({ selection: [linkId] });
        } else set({ selection: [id] });
      }, LOCAL);
    } else if (editing.kind === 'new-text') {
      if (text.trim() && st.layerId) {
        const w = Math.round(Math.min(320, Math.max(60, ...text.split('\n').map((l) => measureText(l, { ...font, size: 12 }) + 8))));
        const id = addElement(doc, dId, { type: 'text', layerId: st.layerId, x: Math.round(editing.x), y: Math.round(editing.y), w, h: 18, text }, LOCAL);
        set({ selection: [id] });
      }
    } else if (el?.type === 'variable') {
      if (text.trim() && text !== initial) {
        const res = renameVariable(doc, el.variableId, text, LOCAL);
        if (!res.ok && res.reason === 'duplicate') toast.error(`A variable called “${text.trim()}” already exists`, { description: 'Variable names must be unique within a project.' });
      }
    } else if (el?.type === 'text') {
      if (!text.trim()) deleteElements(doc, dId, [el.id], LOCAL);
      else if (text !== initial) updateElement(doc, dId, el.id, { text }, LOCAL);
    } else if (el?.type === 'shape') {
      if (text !== initial) updateElement(doc, dId, el.id, { text: text || undefined }, LOCAL);
    }
    close();
  };

  const z = viewport.zoom;
  const left = box.x * z + viewport.x;
  const top = box.y * z + viewport.y;
  return (
    <textarea
      ref={ref}
      data-overlay
      aria-label={editing.kind === 'new-variable' || el?.type === 'variable' ? 'Variable name' : 'Text content'}
      value={value}
      placeholder={editing.kind === 'new-variable' ? 'Variable name' : editing.kind === 'new-text' ? 'Type something' : undefined}
      onChange={(e) => setValue(multiline ? e.target.value : e.target.value.replace(/\n/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          done.current = true;
          close();
        } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey) && !e.shiftKey) {
          e.preventDefault();
          commit();
        }
      }}
      rows={1}
      spellCheck
      className="absolute z-10 resize-none overflow-hidden rounded-sm bg-[var(--canvas)] p-0 outline-none ring-2 ring-accent-500/70 ring-offset-2 ring-offset-[var(--canvas)] placeholder:text-[var(--muted)]"
      style={{
        left,
        top,
        width: box.w * z,
        fontFamily: FONT_STACKS[font.family],
        fontSize: font.size * z,
        fontWeight: font.bold ? 700 : 400,
        fontStyle: font.italic ? 'italic' : 'normal',
        lineHeight: LINE_HEIGHT,
        textAlign: align,
        color: 'var(--text)',
      }}
    />
  );
}
