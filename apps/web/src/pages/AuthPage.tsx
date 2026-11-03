import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { LogoMark } from '../components/Logo';
import { RepoFooter } from '../components/RepoFooter';
import { Button, Field, Input } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { authClient } from '../lib/auth';
import { useConfig, useMe } from '../lib/queries';

/** Only allow same-site relative redirects. */
const safeNext = (next: string | null) =>
  next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

export function AuthPage({ mode }: { mode: 'signin' | 'signup' }) {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const me = useMe();
  const config = useConfig();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const guest = me.data?.isGuest ?? false;
  // Guests who started without a link are just called "Guest"; don't pre-fill that.
  const [name, setName] = useState(guest && me.data!.name !== 'Guest' ? me.data!.name : '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);

  // Guests may sign up / sign in: their projects and comments move to the account.
  if (me.data && !guest) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res =
      mode === 'signup'
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (res.error) {
      setError(res.error.message ?? 'Something went wrong. Please try again.');
      return;
    }
    await qc.invalidateQueries();
    if (guest) toast.success('Your projects are now saved to your account.');
    navigate(next, { replace: true });
  };

  /** "Start drawing — no account needed": a guest session, then straight to a new project. */
  const startAsGuest = async () => {
    setStarting(true);
    try {
      await api('/guest', { method: 'POST', body: {} });
      await qc.invalidateQueries();
      navigate(next === '/' ? '/?new=1' : next, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setStarting(false);
    }
  };

  const social = async (provider: 'google' | 'github') => {
    await authClient.signIn.social({ provider, callbackURL: next });
  };

  const other = mode === 'signin' ? '/signup' : '/signin';
  const otherHref = params.get('next') ? `${other}?next=${encodeURIComponent(next)}` : other;

  return (
    <div className="flex min-h-full flex-col items-center px-4">
      <div className="flex w-full max-w-sm flex-1 flex-col justify-center py-12">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark size={44} />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-app">
            {guest
              ? 'Keep your projects'
              : mode === 'signin'
                ? 'Welcome to Loopwise'
                : 'Create your account'}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {guest
              ? 'Your guest work only lives in this browser. With an account you keep your projects and comments on every device, and can share them.'
              : 'Draw causal loop diagrams together, in real time.'}
          </p>
        </div>
        {!guest && (
          <div className="mb-6">
            <Button
              variant="primary"
              className="h-11 w-full text-base"
              loading={starting}
              onClick={startAsGuest}
            >
              Start drawing — no account needed
            </Button>
            <p className="mt-2 text-center text-xs text-muted">
              Your work stays in this browser until you create an account.
            </p>
            <div className="mt-6 flex items-center gap-3 text-xs text-muted">
              <span className="h-px flex-1 bg-[var(--border)]" />
              {mode === 'signin' ? 'or sign in' : 'or create an account'}
              <span className="h-px flex-1 bg-[var(--border)]" />
            </div>
          </div>
        )}
        <div className="rounded-2xl border border-app bg-surface p-6 shadow-sm">
          {!!config.data?.socialProviders.length && (
            <>
              <div className="space-y-2">
                {config.data.socialProviders.map((p) => (
                  <Button key={p} className="w-full" onClick={() => social(p)}>
                    Continue with {p === 'google' ? 'Google' : 'GitHub'}
                  </Button>
                ))}
              </div>
              <div className="my-5 flex items-center gap-3 text-xs text-muted">
                <span className="h-px flex-1 bg-[var(--border)]" />
                or
                <span className="h-px flex-1 bg-[var(--border)]" />
              </div>
            </>
          )}
          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && (
              <Field label="Name">
                <Input
                  autoFocus
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ada Lovelace"
                />
              </Field>
            )}
            <Field label="Email">
              <Input
                autoFocus={mode === 'signin' && guest}
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@university.edu"
              />
            </Field>
            <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
              <Input
                required
                type="password"
                minLength={mode === 'signup' ? 8 : undefined}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"
              >
                {error}
              </p>
            )}
            <Button
              type="submit"
              variant={guest ? 'primary' : 'secondary'}
              className="w-full"
              loading={busy}
            >
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        </div>
        <p className="mt-6 text-center text-sm text-muted">
          {mode === 'signin' ? 'New here? ' : 'Already have an account? '}
          <Link
            to={otherHref}
            className="font-medium text-accent-600 hover:underline dark:text-accent-300"
          >
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </Link>
        </p>
      </div>
      <RepoFooter />
    </div>
  );
}
