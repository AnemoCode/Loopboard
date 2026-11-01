import * as RCM from '@radix-ui/react-context-menu';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Layers,
  MessageCircle,
  Scissors,
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { byKey, moveToLayer } from '@cld/model';
import {
  copyPayload,
  deleteSelection,
  duplicateSelection,
  editable,
  pastePayload,
  reorder,
} from './actions';
import { useEditorCtx } from './context';
import { useDocView } from './docView';
import { LOCAL } from './session';
import { useEditor } from './store';

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
let lastCopied: string | null = null;

function Item({
  children,
  onSelect,
  icon,
  shortcut,
  disabled,
  danger,
}: {
  children: ReactNode;
  onSelect: () => void;
  icon: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <RCM.Item
      disabled={disabled}
      onSelect={onSelect}
      className={`flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2 ${danger ? 'text-red-600 dark:text-red-400' : 'text-app'}`}
    >
      <span className="flex size-4 items-center justify-center text-muted">{icon}</span>
      <span className="flex-1">{children}</span>
      {shortcut && <span className="text-xs text-muted">{shortcut}</span>}
    </RCM.Item>
  );
}

const Sep = () => <RCM.Separator className="my-1 h-px bg-[var(--border)]" />;
const content = 'z-50 min-w-52 rounded-xl border border-app bg-surface p-1 shadow-xl animate-pop';

export function EditorContextMenu({ children }: { children: ReactNode }) {
  const ctx = useEditorCtx();
  const view = useDocView(ctx.store);
  const { selection, diagramId } = useEditor();
  const set = useEditor((s) => s.set);
  const diagram = diagramId ? view.snapshot.diagrams[diagramId] : undefined;
  const can = ctx.canEdit && editable(ctx, selection).length > 0;
  const layers = diagram
    ? Object.values(diagram.layers)
        .sort(byKey((l) => l.order))
        .reverse()
    : [];

  const copy = async () => {
    const payload = copyPayload(ctx);
    if (!payload) return;
    lastCopied = payload;
    await navigator.clipboard?.writeText(payload).catch(() => {});
  };
  const paste = async () => {
    const text = (await navigator.clipboard?.readText().catch(() => null)) ?? lastCopied;
    if (text) pastePayload(ctx, text);
  };

  return (
    <RCM.Root>
      <RCM.Trigger asChild>{children}</RCM.Trigger>
      <RCM.Portal>
        <RCM.Content className={content}>
          {ctx.canEdit && (
            <>
              <Item
                icon={<Scissors className="size-4" />}
                shortcut={`${mod}X`}
                disabled={!can}
                onSelect={async () => {
                  await copy();
                  deleteSelection(ctx);
                }}
              >
                Cut
              </Item>
              <Item
                icon={<Copy className="size-4" />}
                shortcut={`${mod}C`}
                disabled={!selection.length}
                onSelect={copy}
              >
                Copy
              </Item>
              <Item
                icon={<ClipboardPaste className="size-4" />}
                shortcut={`${mod}V`}
                onSelect={paste}
              >
                Paste
              </Item>
              <Item
                icon={<CopyPlus className="size-4" />}
                shortcut={`${mod}D`}
                disabled={!can}
                onSelect={() => duplicateSelection(ctx)}
              >
                Duplicate
              </Item>
              <Sep />
              <Item
                icon={<ArrowUpToLine className="size-4" />}
                shortcut={`${mod}⇧]`}
                disabled={!can}
                onSelect={() => reorder(ctx, 'front')}
              >
                Bring to front
              </Item>
              <Item
                icon={<ArrowDownToLine className="size-4" />}
                shortcut={`${mod}⇧[`}
                disabled={!can}
                onSelect={() => reorder(ctx, 'back')}
              >
                Send to back
              </Item>
              {layers.length > 1 && (
                <RCM.Sub>
                  <RCM.SubTrigger
                    disabled={!can}
                    className="flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-app outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2"
                  >
                    <span className="flex size-4 items-center justify-center text-muted">
                      <Layers className="size-4" />
                    </span>
                    Move to layer
                  </RCM.SubTrigger>
                  <RCM.Portal>
                    <RCM.SubContent className={content}>
                      {layers.map((l) => (
                        <Item
                          key={l.id}
                          icon={null}
                          onSelect={() =>
                            moveToLayer(
                              ctx.session.doc,
                              diagramId!,
                              editable(ctx, selection),
                              l.id,
                              LOCAL,
                            )
                          }
                        >
                          {l.name}
                        </Item>
                      ))}
                    </RCM.SubContent>
                  </RCM.Portal>
                </RCM.Sub>
              )}
            </>
          )}
          {ctx.canComment && (
            <>
              {ctx.canEdit && <Sep />}
              <Item
                icon={<MessageCircle className="size-4" />}
                shortcut="C"
                onSelect={() => set({ tool: 'comment' })}
              >
                Add comment
              </Item>
            </>
          )}
          {ctx.canEdit && (
            <>
              <Sep />
              <Item
                icon={<Trash2 className="size-4" />}
                shortcut="⌫"
                danger
                disabled={!can}
                onSelect={() => deleteSelection(ctx)}
              >
                Delete
              </Item>
            </>
          )}
        </RCM.Content>
      </RCM.Portal>
    </RCM.Root>
  );
}
