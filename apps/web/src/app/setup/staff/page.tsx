'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Plus, Users } from 'lucide-react';
import { ROLE_RANK } from '@queueos/core';
import { api, ASSIGNABLE_ROLES, type AuthUser, type BranchSummary, type StaffRow } from '@/lib/api';
import { SetupShell } from '@/components/setup-shell';
import { Button, Card, CardHeader, EmptyState, Pill, Select, Skeleton } from '@/components/ui';

const INPUT =
  'h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-sm outline-none transition-colors focus:border-accent';

export default function StaffSetupPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    try {
      const [s, b] = await Promise.all([api.staff(), api.branches()]);
      setStaff(s);
      setBranches(b);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load staff');
    }
  }

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => router.replace('/login?next=/setup/staff'));
    load();
  }, []);

  if (user === undefined || (!loadError && !staff)) {
    return (
      <SetupShell title="Staff">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </SetupShell>
    );
  }
  if (!user) return null;

  const canManage = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK.ADMIN;
  if (!canManage) {
    return (
      <SetupShell title="Staff">
        <Card>
          <EmptyState title="You don't have access to business setup" />
        </Card>
      </SetupShell>
    );
  }

  const ownBranches = branches.filter((b) => b.organizationId === user.organizationId);

  return (
    <SetupShell title="Staff">
      {loadError ? (
        <Card className="p-5">
          <p className="text-sm text-danger">{loadError}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={load}>
            Retry
          </Button>
        </Card>
      ) : null}

      <CreateStaffCard user={user} branches={ownBranches} onCreated={load} />

      <Card>
        <CardHeader
          title="Staff"
          subtitle={`${(staff ?? []).length} ${(staff ?? []).length === 1 ? 'person' : 'people'}`}
          icon={<Users size={16} />}
        />
        <div className="divide-y divide-line">
          {(staff ?? []).length === 0 ? (
            <EmptyState title="No staff yet" detail="Add your first colleague above." />
          ) : (
            (staff ?? []).map((s) => (
              <StaffRowItem key={s.id} member={s} user={user} branches={ownBranches} onSaved={load} />
            ))
          )}
        </div>
      </Card>
    </SetupShell>
  );
}

function assignableRolesFor(user: AuthUser) {
  const rank = ROLE_RANK[user.role as keyof typeof ROLE_RANK];
  const isOwner = rank >= ROLE_RANK.OWNER;
  return ASSIGNABLE_ROLES.filter((r) => isOwner || ROLE_RANK[r] < rank);
}

function CreateStaffCard({
  user,
  branches,
  onCreated,
}: {
  user: AuthUser;
  branches: BranchSummary[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roles = assignableRolesFor(user);
  const isOwner = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK.OWNER;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.createStaff({
        name: String(form.get('name') ?? ''),
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        role: String(form.get('role') ?? roles[0]),
        branchId: isOwner ? String(form.get('branchId') ?? '') || undefined : undefined,
      });
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add staff member');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus size={15} /> New staff member
      </Button>
    );
  }

  return (
    <Card className="p-5">
      <CardHeader title="New staff member" className="px-0 pt-0" />
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Full name</span>
            <input name="name" required className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Work email</span>
            <input name="email" type="email" required className={INPUT} />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Temporary password</span>
            <input name="password" type="password" required minLength={8} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Role</span>
            <Select name="role" defaultValue={roles[0]}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {isOwner ? (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Branch</span>
            <Select name="branchId" defaultValue={branches[0]?.id ?? ''}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}

        {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}

        <div className="flex items-center gap-2">
          <Button type="submit" loading={busy}>
            Add staff member
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function StaffRowItem({
  member,
  user,
  branches,
  onSaved,
}: {
  member: StaffRow;
  user: AuthUser;
  branches: BranchSummary[];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roles = assignableRolesFor(user);
  const isOwner = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK.OWNER;
  const canEditThis = ROLE_RANK[member.role as keyof typeof ROLE_RANK] < ROLE_RANK[user.role as keyof typeof ROLE_RANK] || isOwner;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.updateStaff(member.id, {
        name: String(form.get('name') ?? ''),
        role: String(form.get('role') ?? member.role),
        branchId: isOwner ? String(form.get('branchId') ?? '') || null : undefined,
        active: form.get('active') === 'on',
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update staff member');
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    const password = window.prompt(`New temporary password for ${member.name} (min 8 characters):`);
    if (!password) return;
    setError(null);
    try {
      await api.resetStaffPassword(member.id, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password');
    }
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Full name</span>
            <input name="name" required defaultValue={member.name} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Role</span>
            <Select name="role" defaultValue={member.role}>
              {roles.includes(member.role as (typeof roles)[number]) ? null : (
                <option value={member.role}>{member.role.replace('_', ' ')}</option>
              )}
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {isOwner ? (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Branch</span>
            <Select name="branchId" defaultValue={member.branchId ?? ''}>
              <option value="">Unassigned</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={member.active} className="h-4 w-4" />
          Active
        </label>

        {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}

        <div className="flex items-center gap-2">
          <Button type="submit" loading={busy}>
            Save changes
          </Button>
          <Button type="button" variant="ghost" onClick={resetPassword}>
            <KeyRound size={14} /> Reset password
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
        <p className="truncate text-sm font-semibold">{member.name}</p>
        <p className="truncate text-xs text-muted">{member.email}</p>
      </div>
      <div className="flex items-center gap-2">
        <Pill tone={member.active ? 'neutral' : 'danger'}>{member.role.replace('_', ' ').toLowerCase()}</Pill>
        {!member.active ? <Pill tone="warning">inactive</Pill> : null}
        {canEditThis ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : null}
      </div>
    </div>
  );
}
