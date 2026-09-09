'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Activity } from 'lucide-react';
import { ROLE_RANK } from '@queueos/core';
import { api, setStoredToken, type MyCounter } from '@/lib/api';
import { Button, Card } from '@/components/ui';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Only set when something (an auth-guarded page) sent the user here for a
  // specific reason — that always wins over the role-based default below.
  const explicitNext = params.get('next');

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickCounter, setPickCounter] = useState<MyCounter[] | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const result = await api.login(
        String(form.get('email') ?? ''),
        String(form.get('password') ?? ''),
      );
      setStoredToken(result.accessToken);

      if (explicitNext) {
        router.replace(explicitNext);
        return;
      }

      // No specific destination requested. Floor staff (below Admin rank)
      // have no business on the admin-only branches list — send them
      // straight to whichever counter they're assigned to instead.
      const rank = ROLE_RANK[result.user.role as keyof typeof ROLE_RANK];
      if (rank < ROLE_RANK.ADMIN) {
        const counters = await api.myCounters();
        if (counters.length === 1) {
          router.replace(`/counter/${counters[0].id}`);
          return;
        }
        if (counters.length > 1) {
          setPickCounter(counters);
          setBusy(false);
          return;
        }
        // Zero assigned — nothing to route to yet; fall through to "/",
        // which shows a clear "ask your manager to assign you" message.
      }
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
      setBusy(false);
    }
  }

  if (pickCounter) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface px-5 text-fg">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-white">
              <Activity size={20} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-base font-bold tracking-tight">QueueOS</p>
              <p className="text-xs text-muted">Which counter are you working?</p>
            </div>
          </div>
          <Card className="p-3">
            <div className="space-y-1.5">
              {pickCounter.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => router.replace(`/counter/${c.id}`)}
                  className="flex w-full items-center justify-between rounded-xl border border-line bg-raised px-4 py-3 text-left text-sm transition-colors hover:border-accent"
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-muted">{c.queueName ?? 'Unassigned'}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center bg-surface px-5 text-fg">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-white">
            <Activity size={20} strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-base font-bold tracking-tight">QueueOS</p>
            <p className="text-xs text-muted">Staff sign in</p>
          </div>
        </div>

        <Card className="p-6">
          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Work email</span>
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
                defaultValue="counter@apollo.queueos.dev"
                className="h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-sm outline-none transition-colors focus:border-accent"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Password</span>
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                defaultValue="queueos123"
                className="h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-sm outline-none transition-colors focus:border-accent"
              />
            </label>

            {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}

            <Button type="submit" size="lg" loading={busy} className="w-full">
              Sign in
            </Button>
          </form>

          <p className="mt-4 border-t border-line pt-4 text-[11px] leading-relaxed text-subtle">
            Seeded accounts follow{' '}
            <code className="text-muted">role@org.queueos.dev</code> — owner, admin, reception and
            counter, all with the password <code className="text-muted">queueos123</code>.
          </p>
        </Card>

        <div className="mt-4 flex items-center justify-center gap-4 text-xs text-muted">
          <Link href="/register" className="hover:text-fg">
            Register a new business
          </Link>
          <Link href="/" className="hover:text-fg">
            Back
          </Link>
        </div>
      </div>
    </div>
  );
}
