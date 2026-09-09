'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, Plus } from 'lucide-react';
import { ROLE_RANK, VERTICALS, VERTICAL_IDS, FLOW_TEMPLATES, type VerticalId } from '@queueos/core';
import { api, type AuthUser, type BranchInput, type BranchSummary } from '@/lib/api';
import { SetupShell } from '@/components/setup-shell';
import { Button, Card, CardHeader, EmptyState, Pill, Select, Skeleton } from '@/components/ui';
import { FlowTemplatePicker } from '@/components/flow-template-picker';

export default function BranchesSetupPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [branches, setBranches] = useState<BranchSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    try {
      setBranches(await api.branches());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load branches');
    }
  }

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => router.replace('/login?next=/setup/branches'));
    load();
  }, []);

  if (user === undefined || (!loadError && !branches)) {
    return (
      <SetupShell title="Branches">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </SetupShell>
    );
  }

  if (!user) return null; // redirecting

  const canManage = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK.OWNER;
  const canView = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK.ADMIN;

  if (!canView) {
    return (
      <SetupShell title="Branches">
        <Card>
          <EmptyState
            title="You don't have access to business setup"
            detail="Branch, queue and staff configuration is limited to branch managers and above."
          />
        </Card>
      </SetupShell>
    );
  }

  const ownBranches = (branches ?? []).filter((b) => b.organizationId === user.organizationId);

  return (
    <SetupShell title="Branches">
      {loadError ? (
        <Card className="p-5">
          <p className="text-sm text-danger">{loadError}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={load}>
            Retry
          </Button>
        </Card>
      ) : null}

      {canManage ? <CreateBranchCard onCreated={load} /> : null}

      <Card>
        <CardHeader
          title="Your branches"
          subtitle={`${ownBranches.length} branch${ownBranches.length === 1 ? '' : 'es'}`}
          icon={<Building2 size={16} />}
        />
        <div className="divide-y divide-line">
          {ownBranches.length === 0 ? (
            <EmptyState title="No branches yet" detail="Create your first branch above." />
          ) : (
            ownBranches.map((branch) => (
              <BranchRow key={branch.id} branch={branch} canManage={canManage} onSaved={load} />
            ))
          )}
        </div>
      </Card>
    </SetupShell>
  );
}

function CreateBranchCard({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flowTemplate, setFlowTemplate] = useState(FLOW_TEMPLATES[0].id);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.createBranch({ ...readBranchForm(form), flowTemplate });
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create branch');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus size={15} /> New branch
      </Button>
    );
  }

  return (
    <Card className="p-5">
      <CardHeader title="New branch" className="px-0 pt-0" />
      <BranchFields
        onSubmit={submit}
        onCancel={() => setOpen(false)}
        busy={busy}
        error={error}
        submitLabel="Create branch"
        flowPicker={<FlowTemplatePicker value={flowTemplate} onChange={setFlowTemplate} />}
      />
    </Card>
  );
}

function BranchRow({
  branch,
  canManage,
  onSaved,
}: {
  branch: BranchSummary;
  canManage: boolean;
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
      await api.updateBranch(branch.id, readBranchForm(form));
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update branch');
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="p-5">
        <BranchFields
          initial={{ name: branch.name, code: branch.code, vertical: branch.vertical }}
          onSubmit={submit}
          onCancel={() => setEditing(false)}
          busy={busy}
          error={error}
          submitLabel="Save changes"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{branch.name}</p>
        <p className="text-xs text-muted">
          {branch.code} · {VERTICALS[branch.vertical as VerticalId]?.label ?? branch.vertical} ·{' '}
          {branch.queueCount} {branch.queueCount === 1 ? 'queue' : 'queues'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link href={`/setup/branches/${branch.id}/queues`}>
          <Button variant="ghost" size="sm">
            Queues
          </Button>
        </Link>
        <Link href={`/setup/branches/${branch.id}/counters`}>
          <Button variant="ghost" size="sm">
            Counters
          </Button>
        </Link>
        {canManage ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : (
          <Pill>view only</Pill>
        )}
      </div>
    </div>
  );
}

function BranchFields({
  initial,
  onSubmit,
  onCancel,
  busy,
  error,
  submitLabel,
  flowPicker,
}: {
  initial?: { name: string; code: string; vertical: string | null };
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  /** Only passed when creating — re-provisioning a template on an existing branch would duplicate its queues. */
  flowPicker?: ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Branch name</span>
          <input
            name="name"
            required
            defaultValue={initial?.name}
            className="h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-sm outline-none transition-colors focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Branch code</span>
          <input
            name="code"
            required
            defaultValue={initial?.code}
            placeholder="e.g. MAIN"
            className="h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-sm outline-none transition-colors focus:border-accent"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Vertical</span>
          <Select name="vertical" defaultValue={initial?.vertical ?? VERTICAL_IDS[0]}>
            {VERTICAL_IDS.map((id) => (
              <option key={id} value={id}>
                {VERTICALS[id].label}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Opens</span>
          <input
            name="openTime"
            type="time"
            defaultValue="09:00"
            className="h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-sm outline-none transition-colors focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Closes</span>
          <input
            name="closeTime"
            type="time"
            defaultValue="18:00"
            className="h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-sm outline-none transition-colors focus:border-accent"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Address (optional)</span>
        <input
          name="address"
          className="h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-sm outline-none transition-colors focus:border-accent"
        />
      </label>

      {flowPicker ? (
        <div>
          <span className="mb-1.5 block text-sm font-medium">How does a customer move through this branch?</span>
          {flowPicker}
        </div>
      ) : null}

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

function readBranchForm(form: FormData): BranchInput {
  return {
    name: String(form.get('name') ?? ''),
    code: String(form.get('code') ?? ''),
    vertical: String(form.get('vertical') ?? ''),
    openTime: String(form.get('openTime') ?? ''),
    closeTime: String(form.get('closeTime') ?? ''),
    address: String(form.get('address') ?? '') || undefined,
  };
}
