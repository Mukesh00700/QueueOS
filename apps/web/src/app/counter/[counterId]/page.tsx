'use client';

import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import {
  BellRing,
  Check,
  ChevronRight,
  SkipForward,
  UserRound,
} from 'lucide-react';
import { PAYMENT_METHODS } from '@queueos/core';
import { api, type CounterView } from '@/lib/api';
import { useLive } from '@/lib/use-live';
import { useTheme } from '@/lib/theme';
import { AnimatedNumber, Button, Card, Pill, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * The counter tablet.
 *
 * Used standing up, at arm's length, dozens of times an hour. Four buttons,
 * nothing else competing for the tap: NEXT, RECALL, NO-SHOW, COMPLETE.
 */
export default function CounterPage({ params }: { params: Promise<{ counterId: string }> }) {
  const { counterId } = use(params);
  const router = useRouter();

  // Counter screens are the one part of the product behind a login. `null`
  // while unresolved so nothing — not even a skeleton tied to live data —
  // renders before the check settles; without this the shell could flash
  // real queue content for an instant ahead of the redirect.
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    api
      .me()
      .then(() => setAuthed(true))
      .catch(() => {
        setAuthed(false);
        router.replace(`/login?next=/counter/${counterId}`);
      });
  }, [counterId, router]);

  const [queueId, setQueueId] = useState<string | null>(null);
  const { data, error, refresh, live } = useLive(
    counterId,
    () => api.counter(counterId),
    queueId ? { queueIds: [queueId] } : {},
  );

  useEffect(() => {
    if (data && data.queue.id !== queueId) setQueueId(data.queue.id);
  }, [data, queueId]);

  if (authed !== true) {
    return <div className="min-h-screen bg-surface" />;
  }
  if (error) {
    return <div className="grid min-h-screen place-items-center bg-surface p-6 text-danger">{error}</div>;
  }
  if (!data) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-16" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  return <CounterConsole view={data} onChange={refresh} live={live} />;
}

function CounterConsole({
  view,
  onChange,
  live,
}: {
  view: CounterView;
  onChange: () => void;
  live: boolean;
}) {
  const { t, setVertical } = useTheme();
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');

  useEffect(() => {
    setVertical(view.vertical);
  }, [view.vertical, setVertical]);

  const { counter, queue, current, upNext } = view;
  const holding = current !== null;
  const isPaymentStage = view.stageType === 'PAYMENT';

  // A stale confirm/amount should never carry over onto whichever token comes next.
  useEffect(() => {
    setConfirmingSkip(false);
    setPaymentAmount('');
  }, [current?.id]);

  async function run(action: 'next' | 'recall' | 'skip' | 'complete') {
    setPending(action);
    setActionError(null);
    try {
      await api.counterAction(counter.id, action);
      onChange();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setPending(null);
    }
  }

  async function recordPayment(method: string) {
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) {
      setActionError('Enter an amount first');
      return;
    }
    setPending('payment');
    setActionError(null);
    try {
      await api.recordPayment(counter.id, amount, method);
      setPaymentAmount('');
      onChange();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not record payment');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="min-h-screen bg-surface text-fg">
      <header className="flex items-center gap-4 border-b border-line bg-card px-6 py-4">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold tracking-tight">{counter.name}</p>
          <p className="truncate text-xs text-muted">
            {queue.name}
            {counter.providerName ? ` · ${counter.providerName}` : ''}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Pill tone={counter.status === 'SERVING' ? 'success' : 'neutral'}>{counter.status}</Pill>
          <span
            className={cn('h-2.5 w-2.5 rounded-full', live ? 'bg-success live-dot' : 'bg-subtle')}
            title={live ? 'Live' : 'Reconnecting'}
          />
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 p-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <Card className="relative overflow-hidden px-6 py-10 text-center">
            <div
              className="pointer-events-none absolute inset-0 opacity-50"
              style={{ background: 'radial-gradient(circle at 50% 30%, var(--glow), transparent 65%)' }}
            />
            <p className="relative text-[11px] font-medium uppercase tracking-[0.25em] text-muted">
              {t.nowServing}
            </p>
            <p className="tnum relative mt-2 text-7xl font-extrabold leading-none tracking-tight text-accent">
              {current?.code ?? '—'}
            </p>
            <p className="relative mt-3 text-sm text-muted">
              {current
                ? [current.customerName, current.priority !== 'NORMAL' ? current.priority : null]
                    .filter(Boolean)
                    .join(' · ')
                : `Press NEXT to call the first ${t.customer.toLowerCase()}`}
            </p>
          </Card>

          {actionError ? (
            <p className="text-center text-sm font-medium text-danger">{actionError}</p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              size="xl"
              onClick={() => run('next')}
              loading={pending === 'next'}
              disabled={pending !== null}
              className="sm:col-span-2"
            >
              <ChevronRight size={26} /> Next {t.customer.toLowerCase()}
            </Button>
            {isPaymentStage ? (
              <div className="sm:col-span-2 space-y-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="Amount"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  disabled={!holding || pending !== null}
                  className="h-14 w-full rounded-2xl border border-line bg-raised px-4 text-xl font-semibold tabular-nums outline-none transition-colors focus:border-accent disabled:opacity-50"
                />
                <div className="grid grid-cols-4 gap-2">
                  {PAYMENT_METHODS.map((method) => (
                    <Button
                      key={method}
                      size="lg"
                      variant="success"
                      onClick={() => recordPayment(method)}
                      loading={pending === 'payment'}
                      disabled={pending !== null || !holding}
                    >
                      {method}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <Button
                size="xl"
                variant="success"
                onClick={() => run('complete')}
                loading={pending === 'complete'}
                disabled={pending !== null || !holding}
              >
                <Check size={24} /> Complete
              </Button>
            )}
            <Button
              size="xl"
              variant="warning"
              onClick={() => run('recall')}
              loading={pending === 'recall'}
              disabled={pending !== null || !holding}
            >
              <BellRing size={24} /> Recall
            </Button>
            {confirmingSkip ? (
              <div className="flex gap-3 sm:col-span-2">
                <Button
                  size="xl"
                  variant="danger"
                  onClick={() => {
                    setConfirmingSkip(false);
                    run('skip');
                  }}
                  loading={pending === 'skip'}
                  disabled={pending !== null}
                  className="flex-1"
                >
                  <SkipForward size={24} /> Confirm no-show
                </Button>
                <Button
                  size="xl"
                  variant="secondary"
                  onClick={() => setConfirmingSkip(false)}
                  disabled={pending !== null}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="xl"
                variant="danger"
                onClick={() => setConfirmingSkip(true)}
                disabled={pending !== null || !holding}
                className="sm:col-span-2"
              >
                <SkipForward size={24} /> No-show
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <Card className="grid grid-cols-3 divide-x divide-line text-center">
            <Stat label="Waiting" value={queue.waiting} />
            <Stat label="Done today" value={queue.completedToday} />
            <Stat label="Avg service" value={queue.averageServiceMinutes} suffix="m" />
          </Card>

          <Card className="p-5">
            <p className="mb-3 text-sm font-semibold">Up next</p>
            <div className="space-y-2">
              {upNext.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">
                  No one waiting in {queue.name}
                </p>
              ) : (
                upNext.map((token, index) => (
                  <div
                    key={token.id}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border border-line px-4 py-3',
                      index === 0 ? 'bg-accent/10' : 'bg-raised',
                    )}
                  >
                    <span className={cn('tnum text-xl font-bold', index === 0 && 'text-accent')}>
                      {token.code}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        <UserRound size={12} className="mr-1 inline text-subtle" />
                        {token.customerName ?? 'Walk-in'}
                      </p>
                    </div>
                    {token.status === 'RECALL_PENDING' ? (
                      <Pill tone="warning">Recalled</Pill>
                    ) : token.priority !== 'NORMAL' ? (
                      <Pill tone="accent">{token.priority.toLowerCase()}</Pill>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="px-2 py-4">
      <p className="text-[10px] uppercase tracking-wide text-subtle">{label}</p>
      <p className="mt-1 flex items-baseline justify-center gap-0.5 text-2xl font-bold">
        <AnimatedNumber value={value} />
        {suffix ? <span className="text-sm text-muted">{suffix}</span> : null}
      </p>
    </div>
  );
}
