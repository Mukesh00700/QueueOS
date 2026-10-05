'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Receipt, Users } from 'lucide-react';
import { ROLE_RANK } from '@queueos/core';
import { api, type AuthUser, type BranchSummary, type CustomerDetail } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, EmptyState, Pill, Skeleton } from '@/components/ui';
import { formatDate, timeAgo } from '@/lib/utils';

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ branchId: string; customerId: string }>;
}) {
  const { branchId, customerId } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [branch, setBranch] = useState<BranchSummary | null>(null);
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => router.replace(`/login?next=/dashboard/${branchId}/customers/${customerId}`));
    Promise.all([api.branches(), api.customer(branchId, customerId)])
      .then(([branches, cust]) => {
        setBranch(branches.find((b) => b.id === branchId) ?? null);
        setCustomer(cust);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Could not load this customer'));
  }, [branchId, customerId]);

  if (user === undefined || (!loadError && !customer)) {
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
          <EmptyState title="You don't have access to customers" />
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
          <Link
            href={`/dashboard/${branchId}/customers`}
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-fg"
          >
            <ArrowLeft size={15} /> All customers
          </Link>

          {loadError ? (
            <Card className="p-5">
              <p className="text-sm text-danger">{loadError}</p>
            </Card>
          ) : customer ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">{customer.name}</h1>
                {customer.isSeniorCitizen ? <Pill tone="accent">Senior citizen</Pill> : null}
                {customer.needsAssistance ? <Pill tone="warning">Needs assistance</Pill> : null}
              </div>
              <p className="mt-1 text-sm text-muted">
                {customer.phone}
                {customer.email ? ` · ${customer.email}` : ''} · customer since{' '}
                {formatDate(new Date(customer.customerSince))}
              </p>
            </>
          ) : null}
        </div>

        {customer ? (
          <>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-xl border border-line bg-raised p-3">
                <p className="text-[11px] uppercase tracking-wide text-subtle">Visits here</p>
                <p className="tnum mt-1 text-lg font-semibold">{customer.visitCount}</p>
              </div>
              <div className="rounded-xl border border-line bg-raised p-3">
                <p className="text-[11px] uppercase tracking-wide text-subtle">Total spent</p>
                <p className="tnum mt-1 text-lg font-semibold">₹{customer.totalSpent.toFixed(2)}</p>
              </div>
              <div className="rounded-xl border border-line bg-raised p-3">
                <p className="text-[11px] uppercase tracking-wide text-subtle">Loyalty points</p>
                <p className="tnum mt-1 text-lg font-semibold">{customer.loyaltyPoints}</p>
              </div>
            </div>

            <Card>
              <CardHeader
                title="Visit history"
                subtitle={`${customer.visits.length} at this branch`}
                icon={<Users size={16} />}
              />
              <div className="divide-y divide-line">
                {customer.visits.length === 0 ? (
                  <EmptyState title="No visits at this branch yet" />
                ) : (
                  customer.visits.map((visit) => (
                    <div key={visit.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{formatDate(new Date(visit.createdAt))}</p>
                        <p className="truncate text-xs text-muted">
                          {timeAgo(visit.createdAt)}
                          {visit.tokens.length > 0
                            ? ` · ${visit.tokens.map((t) => `${t.queueName} (${t.code})`).join(', ')}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {visit.invoices.length === 0 ? (
                          <Pill tone={visit.status === 'CLOSED' ? 'neutral' : 'success'}>
                            {visit.status === 'CLOSED' ? 'No sale' : 'In progress'}
                          </Pill>
                        ) : (
                          visit.invoices.map((inv) => (
                            <Link
                              key={inv.id}
                              href={`/invoices/${inv.id}`}
                              className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-fg"
                            >
                              <Receipt size={12} />
                              {inv.number} · ₹{inv.total.toFixed(2)}
                              {inv.status === 'VOID' ? ' (void)' : ''}
                            </Link>
                          ))
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
