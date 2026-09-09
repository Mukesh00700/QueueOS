'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Activity } from 'lucide-react';
import { VERTICALS, VERTICAL_IDS, FLOW_TEMPLATES } from '@queueos/core';
import { api, setStoredToken } from '@/lib/api';
import { Button, Card, Select } from '@/components/ui';
import { FlowTemplatePicker } from '@/components/flow-template-picker';

const INPUT =
  'h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-sm outline-none transition-colors focus:border-accent';

/**
 * Self-service sign-up — the front door for a real business, replacing the
 * seed script as the only way an Organization + Branch + OWNER account come
 * into existence. See build-plan.md Phase 3.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flowTemplate, setFlowTemplate] = useState(FLOW_TEMPLATES[0].id);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const result = await api.register({
        businessName: String(form.get('businessName') ?? '').trim(),
        vertical: String(form.get('vertical') ?? VERTICAL_IDS[0]),
        flowTemplate,
        ownerName: String(form.get('ownerName') ?? '').trim(),
        email: String(form.get('email') ?? '').trim(),
        password: String(form.get('password') ?? ''),
      });
      setStoredToken(result.accessToken);
      router.replace(`/dashboard/${result.user.branchId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account');
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-surface px-5 py-10 text-fg">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-white">
            <Activity size={20} strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-base font-bold tracking-tight">QueueOS</p>
            <p className="text-xs text-muted">Register your business</p>
          </div>
        </div>

        <Card className="p-6">
          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Business name</span>
              <input name="businessName" required placeholder="e.g. Zudio" className={INPUT} />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Business type</span>
              <Select name="vertical" defaultValue={VERTICAL_IDS[0]}>
                {VERTICAL_IDS.map((id) => (
                  <option key={id} value={id}>
                    {VERTICALS[id].label}
                  </option>
                ))}
              </Select>
              <span className="mt-1 block text-xs text-subtle">Sets the wording and colours customers see.</span>
            </label>

            <div>
              <span className="mb-1.5 block text-sm font-medium">How does a customer move through your business?</span>
              <FlowTemplatePicker value={flowTemplate} onChange={setFlowTemplate} />
              <span className="mt-1.5 block text-xs text-subtle">
                Sets up your first branch&apos;s queues to match — fully editable after from Setup.
              </span>
            </div>

            <div className="border-t border-line pt-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Your name</span>
                <input name="ownerName" required autoComplete="name" className={INPUT} />
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Work email</span>
              <input name="email" type="email" required autoComplete="username" className={INPUT} />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Password</span>
              <input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className={INPUT}
              />
              <span className="mt-1 block text-xs text-subtle">At least 8 characters.</span>
            </label>

            {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}

            <Button type="submit" size="lg" loading={busy} className="w-full">
              Create your business
            </Button>
          </form>

          <p className="mt-4 border-t border-line pt-4 text-[11px] leading-relaxed text-subtle">
            You&apos;ll be signed in as the owner, with one branch already set up — add more or invite
            staff any time from Setup.
          </p>
        </Card>

        <div className="mt-4 flex items-center justify-center gap-4 text-xs text-muted">
          <Link href="/login" className="hover:text-fg">
            Already have an account? Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
