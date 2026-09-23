'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Receipt } from 'lucide-react';
import { ROLE_RANK } from '@queueos/core';
import { api, type AuthUser, type BranchSummary, type InvoiceSummary } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, EmptyState, Pill, Skeleton } from '@/components/ui';
import { timeAgo } from '@/lib/utils';

/**
 * The read side of a chain that, until now, only ever got written to —
 * `recordPayment` has always issued a real numbered Invoice, nothing ever
 * showed one back to a human. One list, newest first; click through to the
 * printable receipt.
 */
export default function InvoicesPage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [branch, setBranch] = useState<BranchSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    try {
      const [branches, list] = await Promise.all([api.branches(), api.invoices(branchId)]);
      setBranch(branches.find((b) => b.id === branchId) ?? null);
      setInvoices(list);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load invoices');
    }
  }

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => router.replace(`/login?next=/dashboard/${branchId}/invoices`));
    load();
  }, [branchId]);

  if (user === undefined || (!loadError && !invoices)) {
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
          <EmptyState title="You don't have access to invoices" />
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
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="mt-1 text-sm text-muted">Every sale this branch has recorded, newest first.</p>
        </div>

        {loadError ? (
          <Card className="p-5">
            <p className="text-sm text-danger">{loadError}</p>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title="Recent invoices"
            subtitle={`${(invoices ?? []).length} ${(invoices ?? []).length === 1 ? 'invoice' : 'invoices'}`}
            icon={<Receipt size={16} />}
          />
          <div className="divide-y divide-line">
            {(invoices ?? []).length === 0 ? (
              <EmptyState
                title="No invoices yet"
                detail="One appears here the first time a counter records a payment."
              />
            ) : (
              (invoices ?? []).map((inv) => (
                <Link
                  key={inv.id}
                  href={`/invoices/${inv.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-raised"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{inv.number}</p>
                    <p className="truncate text-xs text-muted">
                      {inv.customerName ?? 'Walk-in'} · {timeAgo(inv.createdAt)}
                      {inv.methods.length > 0 ? ` · ${inv.methods.join(', ').toLowerCase()}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {inv.status === 'VOID' ? (
                      <Pill tone="danger">Void</Pill>
                    ) : inv.refunded > 0 ? (
                      <Pill tone="warning">
                        {inv.refunded >= inv.total - 0.01 ? 'Refunded' : 'Partially refunded'}
                      </Pill>
                    ) : null}
                    <span className="tnum text-sm font-semibold">₹{inv.total.toFixed(2)}</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
