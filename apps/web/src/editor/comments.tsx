import { Check, CornerDownLeft, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { CommentThread } from '@cld/model';
import { atLeast, colorForUser } from '@cld/shared';
import { Avatar, Button, IconButton, Textarea } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { timeAgo } from '../lib/time';
import { useEditorCtx } from './context';
import { useEditor } from './store';

/** Comment writes go through the API for every role; the server applies them to the shared document. */
export const commentApi = {
  create: (
    projectId: string,
    body: { diagramId: string; elementId?: string; x: number; y: number; body: string },
  ) => api<{ id: string }>(`/projects/${projectId}/comments`, { body }),
  reply: (projectId: string, threadId: string, body: string) =>
    api(`/projects/${projectId}/comments/${threadId}/messages`, { body: { body } }),
  resolve: (projectId: string, threadId: string, resolved: boolean) =>
    api(`/projects/${projectId}/comments/${threadId}`, { method: 'PATCH', body: { resolved } }),
  remove: (projectId: string, threadId: string, messageId: string) =>
    api(`/projects/${projectId}/comments/${threadId}/messages/${messageId}`, { method: 'DELETE' }),
};

function Composer({
  placeholder,
  onSubmit,
  autoFocus,
  onCancel,
}: {
  placeholder: string;
  onSubmit: (body: string) => Promise<void>;
  autoFocus?: boolean;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(body.trim());
      setBody('');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <Textarea
        autoFocus={autoFocus}
        rows={2}
        value={body}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key === 'Escape') onCancel?.();
        }}
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button size="sm" variant="primary" disabled={!body.trim()} loading={busy} onClick={submit}>
          <CornerDownLeft className="size-3.5" /> Send
        </Button>
      </div>
    </div>
  );
}

export function ThreadView({ thread }: { thread: CommentThread }) {
  const { projectId, canComment, role, session } = useEditorCtx();
  const moderate = atLeast(role, 'editor');
  return (
    <div className="w-72 space-y-3" data-overlay>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">
          {thread.resolved ? 'Resolved' : 'Comment'}
        </span>
        {canComment && (
          <IconButton
            size="sm"
            label={thread.resolved ? 'Reopen' : 'Resolve'}
            onClick={() =>
              commentApi
                .resolve(projectId, thread.id, !thread.resolved)
                .catch((e) => toast.error(errorMessage(e)))
            }
          >
            {thread.resolved ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
          </IconButton>
        )}
      </div>
      <ul className="max-h-72 space-y-3 overflow-y-auto">
        {thread.messages.map((m) => (
          <li key={m.id} className="group flex gap-2">
            <Avatar name={m.authorName} color={colorForUser(m.authorId)} size={24} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium text-app">{m.authorName}</span>
                <span className="shrink-0 text-xs text-muted">{timeAgo(m.createdAt)}</span>
                {(m.authorId === session.user.id || moderate) && canComment && (
                  <button
                    aria-label="Delete comment"
                    className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    onClick={() =>
                      commentApi
                        .remove(projectId, thread.id, m.id)
                        .catch((e) => toast.error(errorMessage(e)))
                    }
                  >
                    <Trash2 className="size-3.5 text-muted hover:text-red-600" />
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap break-words text-sm text-app">{m.body}</p>
            </div>
          </li>
        ))}
      </ul>
      {canComment && (
        <Composer
          placeholder="Reply…"
          onSubmit={async (body) => void (await commentApi.reply(projectId, thread.id, body))}
        />
      )}
    </div>
  );
}

export function NewCommentForm({ diagramId }: { diagramId: string }) {
  const { projectId } = useEditorCtx();
  const draft = useEditor((s) => s.draftComment);
  const set = useEditor((s) => s.set);
  if (!draft) return null;
  return (
    <div className="w-72" data-overlay>
      <Composer
        autoFocus
        placeholder="Add a comment…"
        onCancel={() => set({ draftComment: null })}
        onSubmit={async (body) => {
          const { id } = await commentApi.create(projectId, {
            diagramId,
            ...draft,
            x: Math.round(draft.x),
            y: Math.round(draft.y),
            body,
          });
          set({ draftComment: null, openThread: id });
        }}
      />
    </div>
  );
}
