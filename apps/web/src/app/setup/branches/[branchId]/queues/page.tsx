'use client';

import { use, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ListOrdered, Plus, Trash2 } from 'lucide-react';
import { ROLE_RANK, STAGE_TYPES, STAGE_TYPE_LABELS } from '@queueos/core';
import {
  api,
  type AuthUser,
  type BranchSummary,
  type QueueDetail,
  type QueueInput,
  type ServiceTypeRow,
} from '@/lib/api';
import { SetupShell } from '@/components/setup-shell';
import { Button, Card, CardHeader, EmptyState, Select, Skeleton } from '@/components/ui';

const INPUT =
  'h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-sm outline-none transition-colors focus:border-accent';

export default function QueuesSetupPage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [branch, setBranch] = useState<BranchSummary | null>(null);
  const [queues, setQueues] = useState<QueueDetail[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    try {
      const [branches, qs] = await Promise.all([api.branches(), api.branchQueueConfig(branchId)]);
      setBranch(branches.find((b) => b.id === branchId) ?? null);
      setQueues(qs);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load queues');
    }
  }

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => router.replace(`/login?next=/setup/branches/${branchId}/queues`));
    load();
  }, [branchId]);

  if (user === undefined || (!loadError && !queues)) {
    return (
      <SetupShell title="Queues">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </SetupShell>
    );
  }
  if (!user) return null;

  const canManage = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK.ADMIN;
  if (!canManage) {
    return (
      <SetupShell title="Queues">
        <Card>
          <EmptyState title="You don't have access to business setup" />
        </Card>
      </SetupShell>
    );
  }

  return (
    <SetupShell title={branch ? `${branch.name} · Queues` : 'Queues'}>
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

      <CreateQueueCard branchId={branchId} siblings={queues ?? []} onCreated={load} />

      {(queues ?? []).length === 0 ? (
        <Card>
          <EmptyState title="No queues yet" detail="Create your first queue above." />
        </Card>
      ) : (
        (queues ?? []).map((q) => <QueueCard key={q.id} queue={q} siblings={queues ?? []} onSaved={load} />)
      )}
    </SetupShell>
  );
}

function CreateQueueCard({
  branchId,
  siblings,
  onCreated,
}: {
  branchId: string;
  siblings: QueueDetail[];
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
      await api.createQueue(branchId, readQueueForm(form));
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create queue');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus size={15} /> New queue
      </Button>
    );
  }

  return (
    <Card className="p-5">
      <CardHeader title="New queue" className="px-0 pt-0" />
      <QueueFields
        siblings={siblings}
        onSubmit={submit}
        onCancel={() => setOpen(false)}
        busy={busy}
        error={error}
        submitLabel="Create queue"
      />
    </Card>
  );
}

function QueueCard({
  queue,
  siblings,
  onSaved,
}: {
  queue: QueueDetail;
  siblings: QueueDetail[];
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
      await api.updateQueue(queue.id, readQueueForm(form));
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update queue');
    } finally {
      setBusy(false);
    }
  }

  const nextQueue = siblings.find((s) => s.id === queue.nextQueueId);
  const subtitle = [
    `${queue.tokenPrefix}-prefixed`,
    `${queue.baselineServiceMinutes} min baseline`,
    queue.status.toLowerCase(),
    STAGE_TYPE_LABELS[queue.stageType as keyof typeof STAGE_TYPE_LABELS] ?? queue.stageType,
    nextQueue ? `→ ${nextQueue.name}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card>
      <CardHeader
        title={queue.name}
        subtitle={subtitle}
        icon={<ListOrdered size={16} />}
        action={
          <Button variant="ghost" size="sm" onClick={() => setEditing((e) => !e)}>
            {editing ? 'Close' : 'Edit'}
          </Button>
        }
      />
      {editing ? (
        <div className="px-5 pb-5">
          <QueueFields
            initial={queue}
            siblings={siblings.filter((s) => s.id !== queue.id)}
            onSubmit={submit}
            onCancel={() => setEditing(false)}
            busy={busy}
            error={error}
            submitLabel="Save changes"
          />
        </div>
      ) : null}
      <div className="border-t border-line px-5 py-4">
        <ServiceTypesEditor queueId={queue.id} />
      </div>
    </Card>
  );
}

function QueueFields({
  initial,
  siblings,
  onSubmit,
  onCancel,
  busy,
  error,
  submitLabel,
}: {
  initial?: QueueDetail;
  siblings: QueueDetail[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
  submitLabel: string;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Queue name</span>
          <input name="name" required defaultValue={initial?.name} className={INPUT} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Department (optional)</span>
          <input name="department" defaultValue={initial?.department ?? ''} className={INPUT} />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Token prefix</span>
          <input name="tokenPrefix" maxLength={4} defaultValue={initial?.tokenPrefix ?? 'A'} className={INPUT} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Baseline (min)</span>
          <input
            name="baselineServiceMinutes"
            type="number"
            min={1}
            defaultValue={initial?.baselineServiceMinutes ?? 8}
            className={INPUT}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Recall grace (min)</span>
          <input
            name="recallGraceMinutes"
            type="number"
            min={1}
            defaultValue={initial?.recallGraceMinutes ?? 3}
            className={INPUT}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">No-show penalty (positions)</span>
          <input
            name="recallPenaltyPositions"
            type="number"
            min={0}
            defaultValue={initial?.recallPenaltyPositions ?? 5}
            className={INPUT}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 border-t border-line pt-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Stage type</span>
          <Select name="stageType" defaultValue={initial?.stageType ?? 'CUSTOM'}>
            {STAGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {STAGE_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Next stage (optional)</span>
          <Select name="nextQueueId" defaultValue={initial?.nextQueueId ?? ''}>
            <option value="">None — this is the last stage</option>
            {siblings.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="hasVisibleQueue"
          defaultChecked={initial?.hasVisibleQueue ?? true}
          className="h-4 w-4"
        />
        Show a live position/wait time for this stage
      </label>

      {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function readQueueForm(form: FormData): QueueInput {
  return {
    name: String(form.get('name') ?? ''),
    department: String(form.get('department') ?? '') || undefined,
    tokenPrefix: String(form.get('tokenPrefix') ?? '') || undefined,
    baselineServiceMinutes: Number(form.get('baselineServiceMinutes')) || undefined,
    recallGraceMinutes: Number(form.get('recallGraceMinutes')) || undefined,
    recallPenaltyPositions: form.get('recallPenaltyPositions') !== null ? Number(form.get('recallPenaltyPositions')) : undefined,
    stageType: String(form.get('stageType') ?? '') || undefined,
    nextQueueId: String(form.get('nextQueueId') ?? '') || null,
    hasVisibleQueue: form.get('hasVisibleQueue') === 'on',
  };
}

function ServiceTypesEditor({ queueId }: { queueId: string }) {
  const [types, setTypes] = useState<ServiceTypeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function load() {
    try {
      setTypes(await api.serviceTypes(queueId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load services');
    }
  }

  useEffect(() => {
    load();
  }, [queueId]);

  async function addService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    if (!name) return;
    try {
      await api.createServiceType(queueId, {
        name,
        durationMinutes: Number(form.get('durationMinutes')) || undefined,
      });
      (event.target as HTMLFormElement).reset();
      setAdding(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add service');
    }
  }

  async function removeService(id: string) {
    try {
      await api.deleteServiceType(queueId, id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove service');
    }
  }

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Services</p>
      {error ? <p className="mb-2 text-xs text-danger">{error}</p> : null}
      <div className="space-y-1.5">
        {(types ?? []).map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-raised px-3 py-2">
            <span className="text-sm">
              {s.name} <span className="text-xs text-muted">· {s.durationMinutes} min</span>
            </span>
            <button
              type="button"
              onClick={() => removeService(s.id)}
              className="text-subtle hover:text-danger"
              aria-label={`Remove ${s.name}`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {types !== null && types.length === 0 ? <p className="text-xs text-subtle">No services configured.</p> : null}
      </div>

      {adding ? (
        <form onSubmit={addService} className="mt-3 flex items-end gap-2">
          <label className="block flex-1">
            <span className="mb-1 block text-xs font-medium">Name</span>
            <input name="name" required className={INPUT} />
          </label>
          <label className="block w-28">
            <span className="mb-1 block text-xs font-medium">Minutes</span>
            <input name="durationMinutes" type="number" min={1} defaultValue={8} className={INPUT} />
          </label>
          <Button type="submit" size="sm">
            Add
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add service
        </Button>
      )}
    </div>
  );
}
