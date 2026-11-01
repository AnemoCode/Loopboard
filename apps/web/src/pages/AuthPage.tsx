import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { LogoMark } from '../components/Logo';
import { Button, Field, Input } from '../components/ui';
import { authClient } from '../lib/auth';
import { keys, useConfig, useMe } from '../lib/queries';

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
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.data) return <Navigate to={next} replace />;

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
    await qc.invalidateQueries({ queryKey: keys.me });
    navigate(next, { replace: true });
  };

  const social = async (provider: 'google' | 'github') => {
    await authClient.signIn.social({ provider, callbackURL: next });
  };

  const other = mode === 'signin' ? '/signup' : '/signin';
  const otherHref = params.get('next') ? `${other}?next=${encodeURIComponent(next)}` : other;

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark size={44} />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-app">
            {mode === 'signin' ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Draw causal loop diagrams together, in real time.
          </p>
        </div>
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
                autoFocus={mode === 'signin'}
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
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
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
    </div>
  );
}
