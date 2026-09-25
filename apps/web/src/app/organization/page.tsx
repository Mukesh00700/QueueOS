'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Building2 } from 'lucide-react';
import { ROLE_RANK } from '@queueos/core';
import { api, ApiError, type AuthUser, type BranchSummaryRow } from '@/lib/api';
import { Card, CardHeader, EmptyState, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

const WINDOWS = [
  { label: 'Today', days: 0 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
] as const;

function sinceFor(days: number): string {
  const d = new Date();
  if (days === 0) d.setHours(0, 0, 0, 0);
  else d.setDate(d.getDate() - days);
  return d.toISOString();
}

/**
 * Every branch's revenue side by side — the one cross-branch view in the
 * product, since Invoices/Shifts/Staff-performance are all deliberately
 * scoped to a single branch. Not nested under AppShell: it spans every
 * branch, so it has no single branchId to render that chrome around.
 */
export default function OrganizationSummaryPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [rows, setRows] = useState<BranchSummaryRow[] | null>(null);
  const [windowDays, setWindowDays] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => router.replace('/login?next=/organization'));
  }, [router]);

  useEffect(() => {
    if (!user) return;
    setRows(null);
    api
      .branchesSummary(sinceFor(windowDays))
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the org summary'));
  }, [user, windowDays]);

  if (user === undefined) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (!user) return null;

  const isOwner = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK.OWNER;
  if (!isOwner) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface p-6">
        <Card>
          <EmptyState title="Only an Owner can see the cross-branch summary" />
        </Card>
      </div>
    );
  }

  const totals = (rows ?? []).reduce(
    (acc, r) => ({
      invoiceCount: acc.invoiceCount + r.invoiceCount,
      revenue: acc.revenue + r.revenue,
      discountGiven: acc.discountGiven + r.discountGiven,
      refunded: acc.refunded + r.refunded,
      netRevenue: acc.netRevenue + r.netRevenue,
    }),
    { invoiceCount: 0, revenue: 0, discountGiven: 0, refunded: 0, netRevenue: 0 },
  );

  return (
    <div className="min-h-screen bg-surface text-fg">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <Link href="/" className="flex items-center gap-1.5 text-sm text-muted hover:text-fg">
          <ArrowLeft size={14} /> Back
        </Link>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Organization summary</h1>
            <p className="mt-1 text-sm text-muted">Every branch's revenue, side by side.</p>
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

        {error ? (
          <Card className="p-5">
            <p className="text-sm text-danger">{error}</p>
          </Card>
        ) : !rows ? (
          <Skeleton className="h-64" />
        ) : (
          <Card>
            <CardHeader
              title="Branches"
              subtitle={`${rows.length} branch${rows.length === 1 ? '' : 'es'}`}
              icon={<Building2 size={16} />}
            />
            {rows.length === 0 ? (
              <EmptyState title="No branches yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-subtle">
                      <th className="px-5 py-3 font-medium">Branch</th>
                      <th className="px-3 py-3 text-right font-medium">Invoices</th>
                      <th className="px-3 py-3 text-right font-medium">Revenue</th>
                      <th className="px-3 py-3 text-right font-medium">Discounts given</th>
                      <th className="px-3 py-3 text-right font-medium">Refunded</th>
                      <th className="px-5 py-3 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((r) => (
                      <tr key={r.branchId}>
                        <td className="px-5 py-3 font-medium">{r.branchName}</td>
                        <td className="tnum px-3 py-3 text-right text-muted">{r.invoiceCount}</td>
                        <td className="tnum px-3 py-3 text-right">₹{r.revenue.toFixed(2)}</td>
                        <td className="tnum px-3 py-3 text-right text-muted">₹{r.discountGiven.toFixed(2)}</td>
                        <td className="tnum px-3 py-3 text-right text-muted">₹{r.refunded.toFixed(2)}</td>
                        <td className="tnum px-5 py-3 text-right font-semibold">₹{r.netRevenue.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-line font-semibold">
                      <td className="px-5 py-3">Total</td>
                      <td className="tnum px-3 py-3 text-right">{totals.invoiceCount}</td>
                      <td className="tnum px-3 py-3 text-right">₹{totals.revenue.toFixed(2)}</td>
                      <td className="tnum px-3 py-3 text-right text-muted">₹{totals.discountGiven.toFixed(2)}</td>
                      <td className="tnum px-3 py-3 text-right text-muted">₹{totals.refunded.toFixed(2)}</td>
                      <td className="tnum px-5 py-3 text-right">₹{totals.netRevenue.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
