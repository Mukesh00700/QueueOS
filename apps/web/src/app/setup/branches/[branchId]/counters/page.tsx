'use client';

import { use, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Monitor, Plus } from 'lucide-react';
import { ROLE_RANK } from '@queueos/core';
import { api, type AuthUser, type BranchSummary, type CounterRow, type QueueDetail } from '@/lib/api';
import { SetupShell } from '@/components/setup-shell';
import { Button, Card, CardHeader, EmptyState, Pill, Select, Skeleton } from '@/components/ui';

const INPUT =
  'h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-sm outline-none transition-colors focus:border-accent';

export default function CountersSetupPage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [branch, setBranch] = useState<BranchSummary | null>(null);
  const [queues, setQueues] = useState<QueueDetail[]>([]);
  const [counters, setCounters] = useState<CounterRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    try {
      const [branches, qs, cs] = await Promise.all([
        api.branches(),
        api.branchQueueConfig(branchId),
        api.branchCounters(branchId),
      ]);
      setBranch(branches.find((b) => b.id === branchId) ?? null);
      setQueues(qs);
      setCounters(cs);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load counters');
    }
  }

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => router.replace(`/login?next=/setup/branches/${branchId}/counters`));
    load();
  }, [branchId]);

  if (user === undefined || (!loadError && !counters)) {
    return (
      <SetupShell title="Counters">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </SetupShell>
    );
  }
  if (!user) return null;

  const canManage = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK.ADMIN;
  if (!canManage) {
    return (
      <SetupShell title="Counters">
        <Card>
          <EmptyState title="You don't have access to business setup" />
        </Card>
      </SetupShell>
    );
  }

  return (
    <SetupShell title={branch ? `${branch.name} · Counters` : 'Counters'}>
      <Link href="/setup/branches" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft size={14} /> Back to branches
      </Link>

      {loadError ? (
        <Card className="p-5">
          <p className="text-sm text-danger">{loadError}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={load}>
            Retry
          </Button>
        </Card>
      ) : null}

      <CreateCounterCard branchId={branchId} queues={queues} onCreated={load} />

      <Card>
        <CardHeader
          title="Counters"
          subtitle={`${(counters ?? []).length} counter${(counters ?? []).length === 1 ? '' : 's'}`}
          icon={<Monitor size={16} />}
        />
        <div className="divide-y divide-line">
          {(counters ?? []).length === 0 ? (
            <EmptyState title="No counters yet" detail="Create your first counter above." />
          ) : (
            (counters ?? []).map((c) => (
              <CounterRowItem key={c.id} counter={c} queues={queues} onSaved={load} />
            ))
          )}
        </div>
      </Card>
    </SetupShell>
  );
}

function CreateCounterCard({
  branchId,
  queues,
  onCreated,
}: {
  branchId: string;
  queues: QueueDetail[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.createCounter(branchId, {
        name: String(form.get('name') ?? ''),
        queueId: String(form.get('queueId') ?? '') || undefined,
      });
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create counter');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus size={15} /> New counter
      </Button>
    );
  }

  return (
    <Card className="p-5">
      <CardHeader title="New counter" className="px-0 pt-0" />
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Counter name</span>
            <input name="name" required placeholder="e.g. Counter 3" className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Queue (optional)</span>
            <Select name="queueId" defaultValue="">
              <option value="">Unassigned</option>
              {queues.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
        <div className="flex items-center gap-2">
          <Button type="submit" loading={busy}>
            Create counter
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function CounterRowItem({
  counter,
  queues,
  onSaved,
}: {
  counter: CounterRow;
  queues: QueueDetail[];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const queueId = String(form.get('queueId') ?? '');
      await api.updateCounter(counter.id, {
        name: String(form.get('name') ?? ''),
        queueId: queueId || null,
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update counter');
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Counter name</span>
            <input name="name" required defaultValue={counter.name} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Queue</span>
            <Select name="queueId" defaultValue={counter.queueId ?? ''}>
              <option value="">Unassigned</option>
              {queues.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
        <div className="flex items-center gap-2">
          <Button type="submit" loading={busy}>
            Save changes
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{counter.name}</p>
        <p className="text-xs text-muted">
          {counter.queue?.name ?? 'Unassigned'}
          {counter.providerName ? ` · ${counter.providerName}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Pill tone={counter.status === 'SERVING' ? 'success' : counter.status === 'CLOSED' ? 'danger' : 'neutral'}>
          {counter.status.toLowerCase()}
        </Pill>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
    </div>
  );
}
