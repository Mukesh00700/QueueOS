'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState, type FormEvent } from 'react';
import { Accessibility, Activity, ArrowLeft, Check, Clock, Users } from 'lucide-react';
import type { QueueSnapshot } from '@queueos/core';
import { api, type CheckinInfo } from '@/lib/api';
import { useLive } from '@/lib/use-live';
import { useTheme } from '@/lib/theme';
import { Button, Card, Pill, Skeleton } from '@/components/ui';
import { queueHeat } from '@/lib/utils';

/**
 * Self check-in.
 *
 * Runs on a lobby kiosk and on the phone behind a QR code, so it is one column,
 * large targets, and no authentication — requiring an account to join a line
 * would defeat the entire purpose of the product.
 */
export default function CheckinPage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = use(params);
  const { data, error, refresh } = useLive(branchId, () => api.checkinInfo(branchId), { branchId });

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface p-6">
        <Card className="max-w-sm p-6 text-center">
          <p className="text-sm font-medium text-danger">{error}</p>
          <div className="mt-3 flex items-center justify-center gap-4">
            <button onClick={refresh} className="text-xs font-medium text-accent hover:underline">
              Retry
            </button>
            <Link href="/" className="text-xs font-medium text-accent hover:underline">
              Back to branches
            </Link>
          </div>
        </Card>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        <Skeleton className="h-20" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  return <CheckinFlow data={data} />;
}

function CheckinFlow({ data }: { data: CheckinInfo }) {
  const { t, vertical, setVertical } = useTheme();
  const router = useRouter();

  useEffect(() => {
    setVertical(data.vertical);
  }, [data.vertical, setVertical]);
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Survives a refresh mid-form: the queue picked before is restored from the
  // URL rather than losing the customer back to step one.
  useEffect(() => {
    const queueId = new URLSearchParams(window.location.search).get('queue');
    if (queueId) setQueue((current) => current ?? data.queues.find((q) => q.id === queueId) ?? null);
  }, [data.queues]);

  function selectQueue(q: QueueSnapshot | null) {
    setQueue(q);
    const url = new URL(window.location.href);
    if (q) url.searchParams.set('queue', q.id);
    else url.searchParams.delete('queue');
    window.history.replaceState(null, '', url.toString());
  }

  const open = data.queues.filter((q) => q.status !== 'CLOSED');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!queue) return;
    const form = new FormData(event.currentTarget);

    setSubmitting(true);
    setFormError(null);
    try {
      const token = await api.join(queue.id, {
        name: String(form.get('name') ?? '').trim(),
        phone: String(form.get('phone') ?? '').trim(),
        priority: form.get('priority') || undefined,
        source: 'KIOSK',
        isSeniorCitizen: form.get('senior') === 'on',
        needsAssistance: form.get('assistance') === 'on',
      });
      router.push(`/t/${token.code}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not join the queue');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface text-fg">
      <div className="mx-auto max-w-xl px-5 py-10">
        <header className="mb-8 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-white">
            <Activity size={20} strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{data.organizationName}</p>
            <p className="truncate text-xs text-muted">{data.branchName}</p>
          </div>
          <Pill tone="accent" className="ml-auto">
            {vertical.label}
          </Pill>
        </header>

        {!queue ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight">
              Which {t.queue.toLowerCase()} do you need?
            </h1>
            <p className="mt-1 text-sm text-muted">
              Pick one and we will tell you exactly when to come back.
            </p>

            <div className="mt-6 space-y-3">
              {open.length === 0 ? (
                <Card className="p-6 text-center text-sm text-muted">
                  All {t.queuePlural.toLowerCase()} are closed right now.
                </Card>
              ) : (
                open.map((q) => {
                  const heat = queueHeat(q.waiting, q.openCounters, q.averageServiceMinutes);
                  return (
                    <button key={q.id} onClick={() => selectQueue(q)} className="w-full text-left">
                      <Card className="p-5 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)]">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-base font-semibold">{q.name}</p>
                            <p className="tnum mt-1 flex items-center gap-3 text-xs text-muted">
                              <span className="flex items-center gap-1">
                                <Users size={12} /> {q.waiting} ahead
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock size={12} /> ~{heat.tailMinutes} min
                              </span>
                            </p>
                          </div>
                          <Pill
                            tone={heat.level === 'fast' ? 'success' : heat.level === 'busy' ? 'warning' : 'danger'}
                          >
                            {heat.level === 'fast' ? 'Short wait' : heat.level === 'busy' ? 'Busy' : 'Long wait'}
                          </Pill>
                        </div>
                      </Card>
                    </button>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <button
              type="button"
              onClick={() => selectQueue(null)}
              className="mb-4 flex items-center gap-1.5 text-sm text-muted hover:text-fg"
            >
              <ArrowLeft size={15} /> Change {t.queue.toLowerCase()}
            </button>

            <h1 className="text-2xl font-bold tracking-tight">{queue.name}</h1>
            <p className="tnum mt-1 text-sm text-muted">
              {queue.waiting} {t.customerPlural.toLowerCase()} ahead of you
            </p>

            <Card className="mt-6 space-y-5 p-5">
              <Field label="Full name">
                <input
                  name="name"
                  required
                  autoComplete="name"
                  placeholder="Your name"
                  className={INPUT}
                />
              </Field>

              <Field label="Mobile number" hint="We send your live ETA here">
                <input
                  name="phone"
                  required
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+91 98765 43210"
                  className={INPUT}
                />
              </Field>

              {vertical.priorities.length > 1 ? (
                <Field label="Priority">
                  <div className="grid grid-cols-2 gap-2">
                    {vertical.priorities.map((p, i) => (
                      <label key={p} className="cursor-pointer">
                        <input type="radio" name="priority" value={p} defaultChecked={i === 0} className="peer sr-only" />
                        <span className="block rounded-xl border border-line bg-raised px-3 py-2.5 text-center text-sm capitalize transition-colors peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:font-medium peer-checked:text-accent">
                          {p.toLowerCase().replace('_', ' ')}
                        </span>
                      </label>
                    ))}
                  </div>
                </Field>
              ) : null}

              {/* These two flags earn a priority band on the server. Until the
                  DRISHTI camera layer exists, this is how accessibility needs
                  reach the queue engine. */}
              <div className="space-y-2">
                <Toggle name="senior" label="Senior citizen" />
                <Toggle name="assistance" label="Needs assistance" icon={<Accessibility size={14} />} />
              </div>

              {formError ? <p className="text-sm font-medium text-danger">{formError}</p> : null}

              <Button type="submit" size="lg" loading={submitting} className="w-full">
                {vertical.terminology.joinCta}
              </Button>
            </Card>
          </form>
        )}
      </div>
    </div>
  );
}

const INPUT =
  'h-12 w-full rounded-xl border border-line bg-raised px-4 text-base outline-none transition-colors placeholder:text-subtle focus:border-accent';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-2">
        <span className="text-sm font-medium">{label}</span>
        {hint ? <span className="text-xs text-subtle">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function Toggle({ name, label, icon }: { name: string; label: string; icon?: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3">
      <input type="checkbox" name={name} className="peer sr-only" />
      <span className="grid h-5 w-5 place-items-center rounded-md border border-line-strong text-white transition-colors peer-checked:border-accent peer-checked:bg-accent peer-checked:[&>svg]:opacity-100">
        <Check size={13} className="opacity-0 transition-opacity" />
      </span>
      <span className="flex items-center gap-1.5 text-sm">
        {icon}
        {label}
      </span>
    </label>
  );
}
