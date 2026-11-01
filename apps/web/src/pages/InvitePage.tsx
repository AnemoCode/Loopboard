import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ROLE_LABELS, type InvitePreview } from '@cld/shared';
import { LogoMark } from '../components/Logo';
import { Button, Field, Input, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { keys } from '../lib/queries';
import { NotFoundPage } from './NotFoundPage';

const NAME_KEY = 'guestName';
const readName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
};

/**
 * Share link landing page. Works without an account: guests type a name and join;
 * signed-in users join with one click.
 */
export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState(readName);
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<InvitePreview>(`/invites/${token}`),
    retry: false,
  });
  const done = async (projectId: string) => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: keys.me }),
      qc.invalidateQueries({ queryKey: keys.projects }),
    ]);
    navigate(`/p/${projectId}`, { replace: true });
  };
  const accept = useMutation({
    mutationFn: () => api<{ projectId: string }>(`/invites/${token}/accept`, { method: 'POST' }),
    onSuccess: ({ projectId }) => done(projectId),
  });
  const joinAsGuest = useMutation({
    mutationFn: (n: string) =>
      api<{ projectId: string }>(`/invites/${token}/guest`, { body: { name: n } }),
    onSuccess: ({ projectId }) => done(projectId),
  });

  if (preview.isLoading)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  if (preview.error)
    return <NotFoundPage title="Link not available" message={errorMessage(preview.error)} />;
  const p = preview.data!;
  const viewer = p.viewer;
  const next = encodeURIComponent(`/invite/${token}`);
  const error = accept.error ?? joinAsGuest.error;

  const submitGuest = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      /* storage unavailable */
    }
    joinAsGuest.mutate(n);
  };

  // Signed in with an account (or a guest following a link that requires one is handled below).
  const accountUser = viewer && !viewer.isGuest;
  // A returning guest on a guest-enabled link joins with their existing identity.
  const returningGuest = viewer?.isGuest && p.allowGuests;

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-app bg-surface p-8 shadow-sm">
        <div className="flex justify-center">
          <LogoMark size={40} />
        </div>
        <h1 className="mt-4 text-center text-lg font-semibold text-app">
          {p.invitedBy} invited you to
        </h1>
        <p className="mt-1 text-center text-sm text-muted">
          <span className="font-medium text-app">{p.projectName}</span> ·{' '}
          {ROLE_LABELS[p.role].toLowerCase()}
        </p>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"
          >
            {errorMessage(error)}
          </p>
        )}

        {accountUser || returningGuest ? (
          <>
            <Button
              variant="primary"
              className="mt-6 w-full"
              loading={accept.isPending}
              onClick={() => accept.mutate()}
            >
              {viewer!.alreadyMember ? 'Open project' : `Join as ${viewer!.name}`}
            </Button>
            {returningGuest && (
              <p className="mt-3 text-center text-xs text-muted">
                You're joining as a guest on this device.
              </p>
            )}
          </>
        ) : p.allowGuests ? (
          <form onSubmit={submitGuest} className="mt-6 space-y-4">
            <Field label="Your name" hint="Shown to others next to your cursor and comments.">
              <Input
                autoFocus
                required
                maxLength={50}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Jonas"
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={!name.trim()}
              loading={joinAsGuest.isPending}
            >
              Join as guest
            </Button>
          </form>
        ) : (
          <p className="mt-6 text-center text-sm text-muted">This link requires an account.</p>
        )}

        {!accountUser && (
          <p className="mt-6 text-center text-sm text-muted">
            {p.allowGuests ? 'Have an account? ' : ''}
            <Link
              to={`/signin?next=${next}`}
              className="font-medium text-accent-600 hover:underline dark:text-accent-300"
            >
              Sign in
            </Link>
            {' · '}
            <Link
              to={`/signup?next=${next}`}
              className="font-medium text-accent-600 hover:underline dark:text-accent-300"
            >
              Create account
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
