import { PanelRightOpen } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { byKey } from '@cld/model';
import { atLeast } from '@cld/shared';
import { IconButton, Spinner } from '../components/ui';
import { ApiError } from '../lib/api';
import { useMe, useProject } from '../lib/queries';
import { NotFoundPage } from '../pages/NotFoundPage';
import { Canvas } from './canvas/Canvas';
import { EditorContextMenu } from './ContextMenu';
import { EditorContext, useEditorCtx, type EditorCtx } from './context';
import { EditorDialogs } from './dialogs';
import { DocStore, useDocView } from './docView';
import { Inspector } from './Inspector';
import { createPresencePublisher, usePeers } from './presence';
import { createSession, type Session } from './session';
import { useEditor } from './store';
import { Toolbar } from './Toolbar';
import { TopBar } from './TopBar';
import { ZoomControls } from './ZoomControls';

export default function EditorPage() {
  const { projectId = '' } = useParams();
  const me = useMe().data!;
  const project = useProject(projectId);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!project.data) return;
    useEditor.getState().reset();
    const s = createSession(projectId, me);
    setSession(s);
    return () => {
      s.destroy();
      setSession(null);
    };
    // Recreate only when the project (not its metadata) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, me.id, !!project.data]);

  if (project.error) {
    const status = project.error instanceof ApiError ? project.error.status : 0;
    return (
      <NotFoundPage
        title={status === 404 ? 'Project not found' : 'Could not open project'}
        message={
          status === 404 ? "It doesn't exist or you don't have access." : project.error.message
        }
      />
    );
  }
  if (!project.data || !session) return <Loading label="Opening project…" />;
  return (
    <EditorWithSession
      key={session.doc.guid}
      session={session}
      projectId={projectId}
      projectName={project.data.name}
      role={project.data.role}
    />
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <Spinner />
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

function EditorWithSession({
  session,
  projectId,
  projectName,
  role,
}: {
  session: Session;
  projectId: string;
  projectName: string;
  role: EditorCtx['role'];
}) {
  const ready = useSyncExternalStore(session.subscribe, () => session.ready);
  const status = useSyncExternalStore(session.subscribe, () => session.status);
  const readOnly = useSyncExternalStore(session.subscribe, () => session.readOnly);
  const store = useMemo(() => new DocStore(session.doc), [session]);
  const peers = usePeers(session);

  useEffect(() => {
    const publish = createPresencePublisher(session);
    publish(
      { user: session.user, selection: [], gesture: null, cursor: null, editing: null },
      true,
    );
  }, [session]);

  const ctx: EditorCtx = useMemo(
    () => ({
      projectId,
      projectName,
      role,
      session,
      store,
      canEdit: ready && !readOnly && atLeast(role, 'editor'),
      canComment: atLeast(role, 'commenter'),
    }),
    [projectId, projectName, role, session, store, ready, readOnly],
  );

  if (status === 'denied')
    return <NotFoundPage title="No access" message="You no longer have access to this project." />;
  if (!ready)
    return <Loading label={status === 'offline' ? 'Waiting for connection…' : 'Syncing…'} />;
  return (
    <EditorContext.Provider value={ctx}>
      <EditorLayout peers={peers} />
    </EditorContext.Provider>
  );
}

function EditorLayout({ peers }: { peers: ReturnType<typeof usePeers> }) {
  const { store } = useEditorCtx();
  const view = useDocView(store);
  const [params, setParams] = useSearchParams();
  const { diagramId, layerId, panelOpen } = useEditor();
  const set = useEditor((s) => s.set);

  // Active diagram: URL ?d=…, else the first one. Keep the URL in sync so links can point at a diagram.
  useEffect(() => {
    const wanted = diagramId ?? params.get('d');
    const exists = wanted && view.snapshot.diagrams[wanted];
    const next = exists ? wanted : view.diagrams[0]?.id;
    if (next && next !== diagramId) set({ diagramId: next, selection: [] });
  }, [diagramId, view, params, set]);
  useEffect(() => {
    if (diagramId && params.get('d') !== diagramId) setParams({ d: diagramId }, { replace: true });
  }, [diagramId, params, setParams]);

  // Active layer must belong to the active diagram; default to the top-most visible layer.
  useEffect(() => {
    const d = diagramId ? view.snapshot.diagrams[diagramId] : undefined;
    if (!d) return;
    if (layerId && d.layers[layerId]) return;
    const top = Object.values(d.layers)
      .sort(byKey((l) => l.order))
      .reverse();
    set({ layerId: (top.find((l) => l.visible && !l.locked) ?? top[0])?.id ?? null });
  }, [diagramId, layerId, view, set]);

  // Drop selection of elements that disappeared (deleted by someone else, undo, …). Runs when the
  // document view changes — not when the selection changes, since a fresh selection may reference an
  // element the view hasn't caught up with yet.
  useEffect(() => {
    const { selection, diagramId: dId } = useEditor.getState();
    const d = dId ? view.snapshot.diagrams[dId] : undefined;
    if (d && selection.some((id) => !d.elements[id]))
      set({ selection: selection.filter((id) => d.elements[id]) });
  }, [view, set]);

  if (!diagramId || !view.snapshot.diagrams[diagramId]) return <Loading label="Loading diagram…" />;

  return (
    <div className="flex h-full flex-col">
      <TopBar peers={peers} />
      <div className="relative flex min-h-0 flex-1">
        <EditorContextMenu>
          <div className="relative min-w-0 flex-1">
            <Canvas peers={peers} />
            <div className="pointer-events-none absolute left-3 top-3">
              <Toolbar />
            </div>
            <div className="pointer-events-none absolute bottom-3 left-3">
              <ZoomControls onFit={() => set({ fitNonce: Date.now() })} />
            </div>
            {!panelOpen && (
              <div className="absolute right-3 top-3">
                <IconButton
                  label="Show side panel"
                  shortcut="⌘."
                  className="border border-app bg-surface shadow-lg"
                  onClick={() => set({ panelOpen: true })}
                >
                  <PanelRightOpen className="size-4" />
                </IconButton>
              </div>
            )}
          </div>
        </EditorContextMenu>
        {panelOpen && <Inspector />}
      </div>
      <EditorDialogs />
    </div>
  );
}
