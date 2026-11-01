import { createContext, useContext } from 'react';
import type { Role } from '@cld/shared';
import type { DocStore } from './docView';
import type { Session } from './session';

export interface EditorCtx {
  projectId: string;
  projectName: string;
  role: Role;
  session: Session;
  store: DocStore;
  /** Server-confirmed write access (false while read-only or before sync). */
  canEdit: boolean;
  canComment: boolean;
}

export const EditorContext = createContext<EditorCtx | null>(null);

export function useEditorCtx(): EditorCtx {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditorCtx outside of editor');
  return ctx;
}
