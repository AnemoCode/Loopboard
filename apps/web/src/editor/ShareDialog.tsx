import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  atLeast,
  colorForUser,
  INVITABLE_ROLES,
  ROLE_LABELS,
  type InvitableRole,
  type ShareLink,
} from '@cld/shared';
import { Avatar, Button, Dialog, Input, Select, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { keys, useLinks, useMembers } from '../lib/queries';
import { useEditorCtx } from './context';

const roleOptions = INVITABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
const linkUrl = (token: string) => `${window.location.origin}/invite/${token}`;
const GuestBadge = () => (
  <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
    Guest
  </span>
);

export function ShareDialog({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const { projectId, projectName, role, session, isGuest } = useEditorCtx();
  const qc = useQueryClient();
  const members = useMembers(projectId);
  // Managing access needs an account and edit rights.
  const canManage = atLeast(role, 'editor') && !isGuest;
  const links = useLinks(projectId, canManage);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InvitableRole>('editor');
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<ShareLink | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.members(projectId) }),
      qc.invalidateQueries({ queryKey: keys.links(projectId) }),
    ]);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await refresh();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const invite = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      const res = await api<{ status: 'added' | 'invited' }>(`/projects/${projectId}/members`, {
        body: { email: email.trim(), role: inviteRole },
      });
      toast.success(
        res.status === 'added'
          ? `${email.trim()} now has access`
          : `Invite saved — ${email.trim()} gets access when they sign up with this email`,
      );
      setEmail('');
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={`Share “${projectName}”`}
      description="Everyone with access sees changes live."
      wide
    >
      {isGuest && role === 'owner' && (
        <div className="rounded-xl border border-accent-200 bg-accent-50 p-4 dark:border-accent-500/30 dark:bg-accent-500/10">
          <h3 className="font-medium text-app">Create a free account to share</h3>
          <p className="mt-1 text-sm text-muted">
            You're working as a guest. To invite others, this project needs an owner with an account,
            otherwise everyone would lose it if this browser's data is cleared.
          </p>
          <Button
            variant="primary"
            className="mt-3"
            onClick={() =>
              navigate(`/signup?next=${encodeURIComponent(location.pathname + location.search)}`)
            }
          >
            Create free account
          </Button>
        </div>
      )}

      {canManage && (
        <ShareLinks links={links.data} loading={links.isLoading} run={run} onRevoke={setRevoking} />
      )}

      {canManage && (
        <>
          <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted">
            Invite by email
          </h3>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void invite();
            }}
          >
            <Input
              type="email"
              required
              placeholder="Email address"
              aria-label="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1"
            />
            <Select
              ariaLabel="Role"
              value={inviteRole}
              onChange={setInviteRole}
              options={roleOptions}
              className="h-9"
            />
            <Button type="submit" loading={busy}>
              Invite
            </Button>
          </form>
        </>
      )}

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted">
        People with access
      </h3>
      {members.isLoading ? (
        <Spinner />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {members.data?.members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 py-2.5">
              <Avatar name={m.name} image={m.image} color={colorForUser(m.userId)} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 truncate text-sm font-medium text-app">
                  <span className="truncate">{m.name}</span>
                  {m.isGuest && <GuestBadge />}
                  {m.userId === session.user.id && (
                    <span className="font-normal text-muted">(you)</span>
                  )}
                </div>
                {m.email && <div className="truncate text-xs text-muted">{m.email}</div>}
              </div>
              {m.role === 'owner' || role !== 'owner' || isGuest ? (
                <span className="text-sm text-muted">{ROLE_LABELS[m.role]}</span>
              ) : (
                <>
                  <Select
                    ariaLabel={`Role of ${m.name}`}
                    value={m.role as InvitableRole}
                    onChange={(r) =>
                      run(() =>
                        api(`/projects/${projectId}/members/${m.userId}`, {
                          method: 'PATCH',
                          body: { role: r },
                        }),
                      )
                    }
                    options={roleOptions}
                  />
                  <button
                    aria-label={`Remove ${m.name}`}
                    className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-red-600"
                    onClick={() =>
                      run(
                        () =>
                          api(`/projects/${projectId}/members/${m.userId}`, { method: 'DELETE' }),
                        `${m.name} was removed`,
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </button>
                </>
              )}
            </li>
          ))}
          {members.data?.invites.map((inv) => (
            <li key={inv.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={inv.email} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-app">{inv.email}</div>
                <div className="text-xs text-muted">Invited · joins on sign-up</div>
              </div>
              <span className="text-sm text-muted">{ROLE_LABELS[inv.role]}</span>
              {canManage && (
                <button
                  aria-label={`Cancel invite for ${inv.email}`}
                  className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-red-600"
                  onClick={() =>
                    run(() => api(`/projects/${projectId}/invites/${inv.id}`, { method: 'DELETE' }))
                  }
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isGuest && role !== 'owner' && (
        <p className="mt-4 text-sm text-muted">
          You're a guest. Ask the project owner if you'd like to invite others.
        </p>
      )}

      {revoking && (
        <RevokeDialog
          link={revoking}
          onClose={() => setRevoking(null)}
          onConfirm={(removeGuests) =>
            run(
              () =>
                api(
                  `/projects/${projectId}/links/${revoking.id}${removeGuests ? '?removeGuests=true' : ''}`,
                  { method: 'DELETE' },
                ),
              removeGuests && revoking.guestCount
                ? `Link revoked and ${revoking.guestCount} guest(s) removed`
                : 'Link revoked',
            ).then(() => setRevoking(null))
          }
        />
      )}
    </Dialog>
  );
}

function ShareLinks({
  links,
  loading,
  run,
  onRevoke,
}: {
  links: ShareLink[] | undefined;
  loading: boolean;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  onRevoke: (l: ShareLink) => void;
}) {
  const { projectId } = useEditorCtx();
  const [role, setRole] = useState<InvitableRole>('editor');
  const [allowGuests, setAllowGuests] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  /** Best effort: the clipboard can be unavailable (permissions, insecure origin). */
  const copy = async (token: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(linkUrl(token));
    } catch {
      toast.error('Copying is blocked in this browser — select the link and copy it manually.');
      return false;
    }
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
    return true;
  };
  const patch = (l: ShareLink, body: Partial<Pick<ShareLink, 'role' | 'allowGuests'>>) =>
    run(() => api(`/projects/${projectId}/links/${l.id}`, { method: 'PATCH', body }));

  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Share link</h3>
      <p className="mb-3 text-sm text-muted">
        Send a link to your group. With guest access on, people only need to type their name — no
        account required.
      </p>
      {loading && <Spinner />}
      <ul className="space-y-2">
        {links?.map((l) => (
          <li key={l.id} className="rounded-xl border border-app p-3">
            <div className="flex items-center gap-2">
              <Link2 className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 select-all truncate font-mono text-xs text-muted">
                {linkUrl(l.token)}
              </span>
              <Button size="sm" variant="primary" onClick={() => copy(l.token)}>
                {copied === l.token ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied === l.token ? 'Copied' : 'Copy link'}
              </Button>
              <button
                aria-label="Revoke link"
                className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-red-600"
                onClick={() => onRevoke(l)}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 pl-6">
              <Select
                ariaLabel="Link role"
                value={l.role}
                onChange={(r) => patch(l, { role: r })}
                options={roleOptions}
                className="h-7 text-xs"
              />
              <label className="flex items-center gap-2 text-sm text-app">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--ring)]"
                  checked={l.allowGuests}
                  onChange={(e) => patch(l, { allowGuests: e.target.checked })}
                />
                Guests can join without an account
              </label>
              {l.guestCount > 0 && (
                <span className="text-xs text-muted">
                  {l.guestCount} guest{l.guestCount === 1 ? '' : 's'} joined
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select
          ariaLabel="New link role"
          value={role}
          onChange={setRole}
          options={roleOptions}
          className="h-9"
        />
        <label className="flex items-center gap-2 text-sm text-app">
          <input
            type="checkbox"
            className="size-4 accent-[var(--ring)]"
            checked={allowGuests}
            onChange={(e) => setAllowGuests(e.target.checked)}
          />
          No account needed
        </label>
        <Button
          className="ml-auto"
          onClick={() =>
            run(async () => {
              const l = await api<ShareLink>(`/projects/${projectId}/links`, {
                body: { role, allowGuests },
              });
              if (await copy(l.token)) toast.success('Link created and copied');
            })
          }
        >
          <Link2 className="size-4" /> {links?.length ? 'New link' : 'Create link'}
        </Button>
      </div>
    </section>
  );
}

function RevokeDialog({
  link,
  onClose,
  onConfirm,
}: {
  link: ShareLink;
  onClose: () => void;
  onConfirm: (removeGuests: boolean) => void;
}) {
  const [removeGuests, setRemoveGuests] = useState(true);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Revoke this link?"
      description="Nobody new can join with it. People who already joined keep access unless you remove them."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={() => onConfirm(removeGuests)}>
            Revoke link
          </Button>
        </>
      }
    >
      {link.guestCount > 0 && (
        <label className="flex items-center gap-2 text-sm text-app">
          <input
            type="checkbox"
            className="size-4 accent-[var(--ring)]"
            checked={removeGuests}
            onChange={(e) => setRemoveGuests(e.target.checked)}
          />
          Also remove the {link.guestCount} guest{link.guestCount === 1 ? '' : 's'} who joined with
          this link
        </label>
      )}
    </Dialog>
  );
}
