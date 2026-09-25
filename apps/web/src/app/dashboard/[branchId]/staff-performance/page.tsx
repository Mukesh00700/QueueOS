'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';
import { ROLE_RANK } from '@queueos/core';
import { api, type AuthUser, type BranchSummary, type StaffPerformanceRow } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, EmptyState, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

const WINDOWS = [
  { label: 'Today', days: 0 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
] as const;

function sinceFor(days: number): string {
  const d = new Date();
  if (days === 0) {
    d.setHours(0, 0, 0, 0);
  } else {
    d.setDate(d.getDate() - days);
  }
  return d.toISOString();
}

/**
 * Per-staff activity, not a computed payout — items rung up, payments
 * personally recorded, refunds personally processed. See InvoiceService
 * .staffPerformance for why refunds aren't netted against the original
 * seller's revenue.
 */
export default function StaffPerformancePage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [branch, setBranch] = useState<BranchSummary | null>(null);
  const [rows, setRows] = useState<StaffPerformanceRow[] | null>(null);
  const [windowDays, setWindowDays] = useState<number>(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load(days: number) {
    try {
      const [branches, performance] = await Promise.all([
        api.branches(),
        api.staffPerformance(branchId, sinceFor(days)),
      ]);
      setBranch(branches.find((b) => b.id === branchId) ?? null);
      setRows(performance);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load staff performance');
    }
  }

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => router.replace(`/login?next=/dashboard/${branchId}/staff-performance`));
  }, [branchId]);

  useEffect(() => {
    setRows(null);
    load(windowDays);
  }, [branchId, windowDays]);

  if (user === undefined || (!loadError && !rows)) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (!user) return null;

  const canManage = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK.ADMIN;
  if (!canManage) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <Card>
          <EmptyState title="You don't have access to staff performance" />
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
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Staff performance</h1>
            <p className="mt-1 text-sm text-muted">Who rang up what, and who's handling the till.</p>
          </div>
          <div className="flex gap-1.5 rounded-xl border border-line bg-raised p-1">
            {WINDOWS.map((w) => (
              <button
                key={w.label}
                type="button"
                onClick={() => setWindowDays(w.days)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  windowDays === w.days ? 'bg-accent text-white' : 'text-muted hover:text-fg',
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        {loadError ? (
          <Card className="p-5">
            <p className="text-sm text-danger">{loadError}</p>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title="Activity"
            subtitle={`${(rows ?? []).length} staff member${(rows ?? []).length === 1 ? '' : 's'} active`}
            icon={<Users size={16} />}
          />
          {(rows ?? []).length === 0 ? (
            <EmptyState
              title="No activity in this window"
              detail="Rings up, payments, and refunds attributed to staff show up here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-subtle">
                    <th className="px-5 py-3 font-medium">Staff</th>
                    <th className="px-3 py-3 text-right font-medium">Items sold</th>
                    <th className="px-3 py-3 text-right font-medium">Revenue</th>
                    <th className="px-3 py-3 text-right font-medium">Payments</th>
                    <th className="px-3 py-3 text-right font-medium">Cash handled</th>
                    <th className="px-5 py-3 text-right font-medium">Refunds</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(rows ?? []).map((row) => (
                    <tr key={row.staffId}>
                      <td className="px-5 py-3 font-medium">{row.name}</td>
                      <td className="tnum px-3 py-3 text-right text-muted">{row.itemsSold}</td>
                      <td className="tnum px-3 py-3 text-right font-semibold">₹{row.revenue.toFixed(2)}</td>
                      <td className="tnum px-3 py-3 text-right text-muted">{row.paymentsRecorded}</td>
                      <td className="tnum px-3 py-3 text-right text-muted">₹{row.cashHandled.toFixed(2)}</td>
                      <td className="tnum px-5 py-3 text-right text-muted">
                        {row.refundsProcessed > 0 ? `${row.refundsProcessed} · −₹${row.refundAmount.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
