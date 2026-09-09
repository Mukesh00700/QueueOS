'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Activity } from 'lucide-react';
import { api, setStoredToken } from '@/lib/api';
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
  const next = params.get('next') ?? '/';

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
      setBusy(false);
    }
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
