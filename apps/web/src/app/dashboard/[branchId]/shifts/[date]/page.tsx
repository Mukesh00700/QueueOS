'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Wallet } from 'lucide-react';
import { ROLE_RANK } from '@queueos/core';
import { api, type AuthUser, type BranchSummary, type ShiftRow } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, EmptyState, Skeleton } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import { ShiftHistoryRow, dayKey } from '../shift-row';

export default function ShiftDayPage({ params }: { params: Promise<{ branchId: string; date: string }> }) {
  const { branchId, date } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [branch, setBranch] = useState<BranchSummary | null>(null);
  const [history, setHistory] = useState<ShiftRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => router.replace(`/login?next=/dashboard/${branchId}/shifts/${date}`));
    Promise.all([api.branches(), api.shiftHistory(branchId)])
      .then(([branches, hist]) => {
        setBranch(branches.find((b) => b.id === branchId) ?? null);
        setHistory(hist);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Could not load shifts'));
  }, [branchId, date]);

  if (user === undefined || (!loadError && !history)) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!user) return null;

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

  const dayShifts = (history ?? []).filter((shift) => shift.closedAt && dayKey(shift.closedAt) === date);
  const displayDate = dayShifts[0]?.closedAt ? formatDate(new Date(dayShifts[0].closedAt)) : date;

  return (
    <AppShell
      branchId={branchId}
      organizationName={branch?.organizationName ?? ''}
      branchName={branch?.name ?? ''}
    >
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <Link
            href={`/dashboard/${branchId}/shifts`}
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-fg"
          >
            <ArrowLeft size={15} /> All shifts
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">{displayDate}</h1>
          <p className="mt-1 text-sm text-muted">
            {dayShifts.length} shift{dayShifts.length === 1 ? '' : 's'} closed this day.
          </p>
        </div>

        {loadError ? (
          <Card className="p-5">
            <p className="text-sm text-danger">{loadError}</p>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Shifts" subtitle={`${dayShifts.length} closed`} icon={<Wallet size={16} />} />
          <div className="divide-y divide-line">
            {dayShifts.length === 0 ? (
              <EmptyState title="No shifts found for this day" />
            ) : (
              dayShifts.map((shift) => <ShiftHistoryRow key={shift.id} shift={shift} />)
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
