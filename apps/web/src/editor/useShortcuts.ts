import { useEffect } from 'react';

import { deleteSelection, duplicateSelection, fitBox, nudge, reorder, selectionBox, setPolarity, toggleDelay, zoomTo, copyPayload, pastePayload } from './actions';
import type { EditorCtx } from './context';
import { editor, useEditor, type Tool } from './store';
import type { DiagramLayout } from '@cld/render';

const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'hand', n: 'variable', l: 'link', o: 'loop', r: 'shape', t: 'text', c: 'comment' };
const EDIT_TOOLS = new Set<Tool>(['variable', 'link', 'loop', 'shape', 'text']);

const isTyping = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');

/** Global keyboard shortcuts and clipboard handling for the editor. */
export function useShortcuts(ctx: EditorCtx, getLayout: () => DiagramLayout, canvasSize: () => { w: number; h: number }) {
  useEffect(() => {
    const set = useEditor.getState().set;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const st = editor();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'z') {
        e.preventDefault();
        if (!ctx.canEdit) return;
        if (e.shiftKey) ctx.session.undo.redo();
        else ctx.session.undo.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        if (ctx.canEdit) ctx.session.undo.redo();
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        const d = ctx.store.get().snapshot.diagrams[st.diagramId ?? ''];
        if (d) set({ selection: getLayout().order.filter((id) => d.elements[id]) });
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        if (ctx.canEdit) duplicateSelection(ctx);
        return;
      }
      if (mod && key === 'e') {
        e.preventDefault();
        set({ dialog: 'export' });
        return;
      }
      if (mod && key === '.') {
        e.preventDefault();
        set({ panelOpen: !st.panelOpen });
        return;
      }
      if (mod && (key === ']' || key === '[')) {
        e.preventDefault();
        reorder(ctx, key === ']' ? (e.shiftKey ? 'front' : 'forward') : e.shiftKey ? 'back' : 'backward');
        return;
      }
      if (mod && (key === '=' || key === '+' || key === '-' || key === '0')) {
        e.preventDefault();
        const { w, h } = canvasSize();
        const center = { x: w / 2, y: h / 2 };
        const z = key === '0' ? 1 : st.viewport.zoom * (key === '-' ? 1 / 1.25 : 1.25);
        set({ viewport: zoomTo(st.viewport, z, center), followClientId: null });
        return;
      }
      if (mod) return;

      if (e.shiftKey && (e.code === 'Digit1' || e.code === 'Digit2')) {
        e.preventDefault();
        const { w, h } = canvasSize();
        const layout = getLayout();
        const box = e.code === 'Digit1' ? layout.bbox : selectionBox(layout, st.selection) ?? layout.bbox;
        set({ viewport: fitBox(box, w, h, e.code === 'Digit1' ? 1.5 : 2), followClientId: null });
        return;
      }
      if (key === 'escape') {
        set({ selection: [], tool: 'select', draftComment: null, openThread: null, highlight: [], followClientId: null });
        return;
      }
      if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        deleteSelection(ctx);
        return;
      }
      if (key.startsWith('arrow')) {
        if (!st.selection.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        nudge(ctx, key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0, key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0);
        return;
      }
      if (key === 'enter' && st.selection.length === 1 && ctx.canEdit) {
        const el = ctx.store.get().snapshot.diagrams[st.diagramId ?? '']?.elements[st.selection[0]!];
        if (el && (el.type === 'variable' || el.type === 'text' || el.type === 'shape')) {
          e.preventDefault();
          set({ editing: { kind: 'element', id: el.id } });
        }
        return;
      }
      if (e.key === '+' || e.key === '=') {
        if (setPolarity(ctx, '+')) e.preventDefault();
        return;
      }
      if (e.key === '-' || e.key === '–') {
        if (setPolarity(ctx, '-')) e.preventDefault();
        return;
      }
      if (key === 'p') {
        setPolarity(ctx, 'cycle');
        return;
      }
      if (key === 'd') {
        toggleDelay(ctx);
        return;
      }
      if (e.key === '?') {
        set({ dialog: 'shortcuts' });
        return;
      }
      const tool = TOOL_KEYS[key];
      if (tool && !e.altKey) {
        if (EDIT_TOOLS.has(tool) && !ctx.canEdit) return;
        if (tool === 'comment' && !ctx.canComment) return;
        set({ tool, editing: null });
      }
    };

    const onCopy = (e: ClipboardEvent) => {
      if (isTyping(e.target) || window.getSelection()?.toString()) return;
      const payload = copyPayload(ctx);
      if (!payload) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', payload);
      if (e.type === 'cut') deleteSelection(ctx);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const text = e.clipboardData?.getData('text/plain');
      if (text && pastePayload(ctx, text)) e.preventDefault();
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCopy);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCopy);
      window.removeEventListener('paste', onPaste);
    };
  }, [ctx, getLayout, canvasSize]);
}


