'use client';

import Link from 'next/link';
import { use, useEffect, useState, type FormEvent } from 'react';
import { ArrowRightLeft, Flag, Monitor, Pause, Play, TrendingUp, Users } from 'lucide-react';
import { PRIORITIES } from '@queueos/core';
import { api, type QueueDetail as QueueConfig, type QueueDisplay, type TokenSnapshotDto } from '@/lib/api';
import { useLive } from '@/lib/use-live';
import { useTheme } from '@/lib/theme';
import { AppShell } from '@/components/app-shell';
import { AnimatedNumber, Button, Card, CardHeader, EmptyState, Pill, Select, Skeleton } from '@/components/ui';
import { HEAT_COLORS, cn, queueHeat, timeAgo } from '@/lib/utils';

export default function QueueDetailPage({ params }: { params: Promise<{ queueId: string }> }) {
  const { queueId } = use(params);
  const { data, error, refresh, live } = useLive(queueId, () => api.queueDisplay(queueId), {
    queueIds: [queueId],
  });

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

  return <QueueDetail data={data} onChange={refresh} live={live} />;
}

function QueueDetail({
  data,
  onChange,
  live,
}: {
  data: QueueDisplay;
  onChange: () => void;
  live: boolean;
}) {
  const { t, vertical, setVertical } = useTheme();
  const { queue } = data;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [siblingQueues, setSiblingQueues] = useState<QueueConfig[]>([]);

  useEffect(() => {
    setVertical(data.vertical);
  }, [data.vertical, setVertical]);

  useEffect(() => {
    api
      .branchQueueConfig(data.branch.id)
      .then((qs) => setSiblingQueues(qs.filter((q) => q.id !== queue.id)))
      .catch(() => {});
  }, [data.branch.id, queue.id]);

  const heat = queueHeat(queue.waiting, queue.openCounters, queue.averageServiceMinutes);
  const colors = HEAT_COLORS[heat.level];
  const paused = queue.status === 'PAUSED';

  async function toggleStatus() {
    setBusy(true);
    setActionError(null);
    try {
      await api.setQueueStatus(queue.id, paused ? 'OPEN' : 'PAUSED');
      onChange();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not change the status of this queue',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      branchId={data.branch.id}
      organizationName={data.branch.organizationName}
      branchName={data.branch.name}
      live={live}
      right={
        <Link href={`/display/${queue.id}`} target="_blank">
          <Button variant="ghost" size="sm">
            <Monitor size={14} /> Display
          </Button>
        </Link>
      }
    >
      <div className="mx-auto max-w-[1400px] space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{queue.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {data.department ? `${data.department} · ` : ''}
              {queue.openCounters}{' '}
              {queue.openCounters === 1 ? t.counter.toLowerCase() : t.counterPlural.toLowerCase()} open
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Pill tone={paused ? 'warning' : heat.level === 'critical' ? 'danger' : 'success'} dot={!paused}>
              {paused ? 'Paused' : queue.status === 'CLOSED' ? 'Closed' : 'Open'}
            </Pill>
            <Button variant="secondary" size="sm" loading={busy} onClick={toggleStatus}>
              {paused ? <Play size={14} /> : <Pause size={14} />}
              {paused ? 'Resume' : 'Pause'}
            </Button>
          </div>
        </div>

        {actionError ? <p className="text-sm font-medium text-danger">{actionError}</p> : null}

        <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
          <div className="space-y-6">
            <Card className="relative overflow-hidden px-6 py-9 text-center">
              <div
                className="pointer-events-none absolute inset-0 opacity-50"
                style={{ background: 'radial-gradient(circle at 50% 30%, var(--glow), transparent 65%)' }}
              />
              <p className="relative text-[11px] font-medium uppercase tracking-[0.25em] text-muted">
                {t.nowServing}
              </p>
              <p className="tnum relative mt-2 text-6xl font-extrabold leading-none tracking-tight text-accent">
                {queue.currentToken?.code ?? '—'}
              </p>
              {queue.currentToken ? (
                <p className="relative mt-3 text-sm text-muted">
                  {[
                    queue.currentToken.counterName,
                    vertical.board.showProvider ? queue.currentToken.providerName : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
            </Card>

            <Card className="grid grid-cols-2 divide-x divide-y divide-line">
              <Stat label="Waiting" value={queue.waiting} />
              <Stat label="Tail wait" value={heat.tailMinutes} suffix="m" tone={colors.text} />
              <Stat label={`${t.visit}s today`} value={queue.completedToday} />
              <Stat label="No-shows" value={queue.noShowToday} />
            </Card>

            <Card className="p-5">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <TrendingUp size={15} className="text-muted" /> Service rhythm
              </p>
              <p className="tnum mt-3 text-sm text-muted">
                Averaging <span className="font-semibold text-fg">{queue.averageServiceMinutes} min</span>{' '}
                per {t.visit.toLowerCase()} across {queue.openCounters}{' '}
                {queue.openCounters === 1 ? t.counter.toLowerCase() : t.counterPlural.toLowerCase()},
                with a mean wait of{' '}
                <span className="font-semibold text-fg">{queue.averageWaitMinutes} min</span> today.
              </p>
            </Card>
          </div>

          <Card>
            <CardHeader
              title={`Next in line`}
              subtitle={`${queue.waiting} ${queue.waiting === 1 ? t.customer.toLowerCase() : t.customerPlural.toLowerCase()} waiting`}
              icon={<Users size={16} />}
              action={
                <Link
                  href={`/checkin/${data.branch.id}`}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  Add walk-in
                </Link>
              }
            />
            <div className="px-5 pb-5">
              {queue.nextTokens.length === 0 ? (
                <EmptyState title="Nobody is waiting" detail="The line is completely clear." />
              ) : (
                <ol className="space-y-2">
                  {queue.nextTokens.map((token) => (
                    <TokenRow key={token.id} token={token} siblingQueues={siblingQueues} onChange={onChange} />
                  ))}
                </ol>
              )}
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

const INPUT =
  'h-9 rounded-lg border border-line bg-card px-2.5 text-xs outline-none transition-colors focus:border-accent';

/**
 * A row in the "next in line" list, with the two out-of-band overrides —
 * transfer and priority change — tucked behind a toggle rather than shown as
 * standing buttons. Chapter 38 rejects "complicated staff interfaces" for the
 * counter tablet; this manager-facing list is the deliberate exception, and
 * even here the overrides stay one tap away rather than always-on.
 */
function TokenRow({
  token,
  siblingQueues,
  onChange,
}: {
  token: TokenSnapshotDto;
  siblingQueues: QueueConfig[];
  onChange: () => void;
}) {
  const [mode, setMode] = useState<'none' | 'transfer' | 'priority'>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetQueueId = String(new FormData(event.currentTarget).get('targetQueueId') ?? '');
    if (!targetQueueId) return;
    setBusy(true);
    setError(null);
    try {
      await api.transferToken(token.id, targetQueueId);
      setMode('none');
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not transfer this token');
    } finally {
      setBusy(false);
    }
  }

  async function submitPriority(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const priority = String(form.get('priority') ?? '');
    const reason = String(form.get('reason') ?? '').trim();
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.changeTokenPriority(token.id, priority, reason);
      setMode('none');
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change priority');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-line bg-raised">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="tnum grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-card text-xs font-semibold text-muted">
          {token.position}
        </span>
        <div className="min-w-0 flex-1">
          <p className="tnum truncate text-sm font-semibold">
            {token.code}
            {token.customerName ? <span className="ml-2 font-normal text-muted">{token.customerName}</span> : null}
          </p>
          <p className="text-[11px] text-subtle">joined {timeAgo(token.joinedAt)}</p>
        </div>
        {token.status === 'RECALL_PENDING' ? <Pill tone="warning">Recalled</Pill> : null}
        {token.priority !== 'NORMAL' ? <Pill tone="accent">{token.priority.toLowerCase()}</Pill> : null}
        <span
          className={cn(
            'tnum w-14 shrink-0 text-right text-sm font-semibold',
            token.etaMinutes !== null && token.etaMinutes <= 5 ? 'text-success' : 'text-muted',
          )}
        >
          {token.etaMinutes !== null ? `${token.etaMinutes}m` : '—'}
        </span>
        <button
          type="button"
          onClick={() => setMode(mode === 'none' ? 'transfer' : 'none')}
          className="rounded-lg p-1.5 text-subtle hover:bg-card hover:text-fg"
          aria-label="Transfer"
          title="Transfer to another queue"
        >
          <ArrowRightLeft size={14} />
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === 'priority' ? 'none' : 'priority')}
          className="rounded-lg p-1.5 text-subtle hover:bg-card hover:text-fg"
          aria-label="Change priority"
          title="Change priority"
        >
          <Flag size={14} />
        </button>
      </div>

      {mode === 'transfer' ? (
        <form onSubmit={submitTransfer} className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <Select name="targetQueueId" className={cn(INPUT, 'w-auto flex-1')} defaultValue="">
            <option value="" disabled>
              Move to…
            </option>
            {siblingQueues.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" loading={busy}>
            Transfer
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setMode('none')}>
            Cancel
          </Button>
          {error ? <p className="w-full text-xs font-medium text-danger">{error}</p> : null}
        </form>
      ) : null}

      {mode === 'priority' ? (
        <form onSubmit={submitPriority} className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <Select name="priority" className={cn(INPUT, 'w-auto')} defaultValue={token.priority}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <input name="reason" required placeholder="Reason (required)" className={cn(INPUT, 'flex-1')} />
          <Button type="submit" size="sm" loading={busy}>
            Apply
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setMode('none')}>
            Cancel
          </Button>
          {error ? <p className="w-full text-xs font-medium text-danger">{error}</p> : null}
        </form>
      ) : null}
    </li>
  );
}

function Stat({
  label,
  value,
  suffix,
  tone,
}: {
  label: string;
  value: number;
  suffix?: string;
  tone?: string;
}) {
  return (
    <div className="px-5 py-5">
      <p className="text-[11px] uppercase tracking-wide text-subtle">{label}</p>
      <p className={cn('mt-1 flex items-baseline gap-0.5 text-2xl font-bold', tone)}>
        <AnimatedNumber value={value} />
        {suffix ? <span className="text-sm font-medium text-muted">{suffix}</span> : null}
      </p>
    </div>
  );
}
