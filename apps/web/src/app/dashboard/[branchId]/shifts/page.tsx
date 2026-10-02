'use client';

import { use, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Wallet } from 'lucide-react';
import { ROLE_RANK } from '@queueos/core';
import { api, ApiError, type AuthUser, type BranchSummary, type ShiftRow } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { Button, Card, CardHeader, EmptyState, Pill, Skeleton } from '@/components/ui';
import { formatClock, formatDate } from '@/lib/utils';
import { dayKey, mergeNonCash, nonCashSummary } from './shift-row';

const INPUT =
  'h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-sm outline-none transition-colors focus:border-accent';

/**
 * The cash drawer, open to close. One open shift per branch at a time —
 * start it with the float that's physically in the till, close it with
 * what's actually counted, and see the variance against what CASH sales
 * (minus CASH refunds) say should be there.
 */
export default function ShiftsPage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [branch, setBranch] = useState<BranchSummary | null>(null);
  const [current, setCurrent] = useState<ShiftRow | null | undefined>(undefined);
  const [history, setHistory] = useState<ShiftRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openingCash, setOpeningCash] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    try {
      const [branches, cur, hist] = await Promise.all([
        api.branches(),
        api.currentShift(branchId),
        api.shiftHistory(branchId),
      ]);
      setBranch(branches.find((b) => b.id === branchId) ?? null);
      setCurrent(cur);
      setHistory(hist);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load shifts');
    }
  }

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => router.replace(`/login?next=/dashboard/${branchId}/shifts`));
    load();
  }, [branchId]);

  async function submitOpen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.openShift(branchId, Number(openingCash) || 0);
      setOpeningCash('');
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not open a shift');
    } finally {
      setBusy(false);
    }
  }

  async function submitClose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const counted = Number(countedCash);
    if (countedCash === '' || Number.isNaN(counted) || counted < 0) {
      setFormError('Enter the counted cash amount');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await api.closeShift(branchId, counted);
      setCountedCash('');
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not close this shift');
    } finally {
      setBusy(false);
    }
  }

  if (user === undefined || (!loadError && (current === undefined || !history))) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!user) return null;

  const dayGroups = new Map<string, { displayDate: string; shifts: ShiftRow[] }>();
  for (const shift of history ?? []) {
    if (!shift.closedAt) continue;
    const key = dayKey(shift.closedAt);
    const group = dayGroups.get(key);
    if (group) group.shifts.push(shift);
    else dayGroups.set(key, { displayDate: formatDate(new Date(shift.closedAt)), shifts: [shift] });
  }

  const canManage = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK.ADMIN;
  if (!canManage) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <Card>
          <EmptyState title="You don't have access to shifts" />
        </Card>
      </div>
    );
  }

  return (
    <AppShell
      branchId={branchId}
      organizationName={branch?.organizationName ?? ''}
      branchName={branch?.name ?? ''}
    >
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shifts</h1>
          <p className="mt-1 text-sm text-muted">Cash drawer reconciliation for this branch.</p>
        </div>

        {loadError ? (
          <Card className="p-5">
            <p className="text-sm text-danger">{loadError}</p>
          </Card>
        ) : null}

        <Card className="p-5">
          {current ? (
            <>
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <Wallet size={15} /> Shift in progress
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Opened {formatClock(new Date(current.openedAt))} on {formatDate(new Date(current.openedAt))}
                  </p>
                </div>
                <Pill tone="success">Open</Pill>
              </div>
              <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-line bg-raised p-3">
                  <p className="text-[11px] uppercase tracking-wide text-subtle">Opening float</p>
                  <p className="tnum mt-1 text-lg font-semibold">₹{current.openingCash.toFixed(2)}</p>
                </div>
                <div className="rounded-xl border border-line bg-raised p-3">
                  <p className="text-[11px] uppercase tracking-wide text-subtle">Expected cash now</p>
                  <p className="tnum mt-1 text-lg font-semibold">₹{current.expectedCash.toFixed(2)}</p>
                </div>
              </div>
              {nonCashSummary(current.nonCash) ? (
                <div className="mb-4 rounded-xl border border-line bg-raised p-3 text-sm">
                  <p className="text-[11px] uppercase tracking-wide text-subtle">Non-cash today</p>
                  <p className="tnum mt-1">{nonCashSummary(current.nonCash)}</p>
                </div>
              ) : null}
              <form onSubmit={submitClose} className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">Counted cash</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="What's actually in the drawer"
                    value={countedCash}
                    onChange={(event) => setCountedCash(event.target.value)}
                    className={INPUT}
                  />
                </label>
                {formError ? <p className="text-sm font-medium text-danger">{formError}</p> : null}
                <Button type="submit" variant="danger" loading={busy}>
                  Close shift
                </Button>
              </form>
            </>
          ) : (
            <>
              <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
                <Wallet size={15} /> No shift open
              </p>
              <form onSubmit={submitOpen} className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">Opening float</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="Cash placed in the drawer to start"
                    value={openingCash}
                    onChange={(event) => setOpeningCash(event.target.value)}
                    className={INPUT}
                  />
                </label>
                {formError ? <p className="text-sm font-medium text-danger">{formError}</p> : null}
                <Button type="submit" loading={busy}>
                  Open shift
                </Button>
              </form>
            </>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Past shifts"
            subtitle={`${(history ?? []).length} closed`}
            icon={<Wallet size={16} />}
          />
          <div className="divide-y divide-line">
            {dayGroups.size === 0 ? (
              <EmptyState title="No shifts closed yet" detail="One appears here once a shift is closed out." />
            ) : (
              Array.from(dayGroups.entries()).map(([date, group]) => {
                const totalVariance = group.shifts.reduce((sum, s) => sum + (s.variance ?? 0), 0);
                const settled = Math.abs(totalVariance) < 0.01;
                const nonCash = nonCashSummary(mergeNonCash(group.shifts));
                return (
                  <Link
                    key={date}
                    href={`/dashboard/${branchId}/shifts/${date}`}
                    className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-raised"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{group.displayDate}</p>
                      <p className="truncate text-xs text-muted">
                        {group.shifts.length} shift{group.shifts.length === 1 ? '' : 's'}
                      </p>
                      {nonCash ? <p className="truncate text-xs text-subtle">{nonCash}</p> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-right">
                      <Pill tone={settled ? 'success' : totalVariance > 0 ? 'accent' : 'danger'}>
                        {settled ? 'Settled' : `${totalVariance > 0 ? '+' : '−'}₹${Math.abs(totalVariance).toFixed(2)}`}
                      </Pill>
                      <ChevronRight size={16} className="text-subtle" />
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
