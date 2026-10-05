'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Users } from 'lucide-react';
import { ROLE_RANK } from '@queueos/core';
import { api, type AuthUser, type BranchSummary, type CustomerSummary } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { Card, CardHeader, EmptyState, Pill, Skeleton } from '@/components/ui';
import { timeAgo } from '@/lib/utils';

const INPUT =
  'h-10 w-full rounded-xl border border-line bg-raised pl-9 pr-3.5 text-sm outline-none transition-colors focus:border-accent';

/**
 * Who's actually come through this branch — the Customer row has existed
 * since check-in needed a phone number for loyalty, but nothing ever let a
 * human browse it. One list, searched client-side (branch customer counts
 * are small enough that a server-side search endpoint isn't worth it yet);
 * click through to a customer's full visit/purchase history.
 */
export default function CustomersPage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [branch, setBranch] = useState<BranchSummary | null>(null);
  const [customers, setCustomers] = useState<CustomerSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  async function load() {
    try {
      const [branches, list] = await Promise.all([api.branches(), api.customers(branchId)]);
      setBranch(branches.find((b) => b.id === branchId) ?? null);
      setCustomers(list);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load customers');
    }
  }

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => router.replace(`/login?next=/dashboard/${branchId}/customers`));
    load();
  }, [branchId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers ?? [];
    return (customers ?? []).filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q));
  }, [customers, search]);

  if (user === undefined || (!loadError && !customers)) {
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
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="mt-1 text-sm text-muted">Everyone who has checked in at this branch.</p>
        </div>

        {loadError ? (
          <Card className="p-5">
            <p className="text-sm text-danger">{loadError}</p>
          </Card>
        ) : null}

        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
          <input
            type="text"
            placeholder="Search by name or phone"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={INPUT}
          />
        </div>

        <Card>
          <CardHeader
            title="Directory"
            subtitle={`${filtered.length} ${filtered.length === 1 ? 'customer' : 'customers'}`}
            icon={<Users size={16} />}
          />
          {filtered.length === 0 ? (
            <EmptyState
              title={(customers ?? []).length === 0 ? 'No customers yet' : 'No match'}
              detail={
                (customers ?? []).length === 0
                  ? 'Someone appears here the first time they check in.'
                  : 'Try a different name or phone number.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-subtle">
                    <th className="px-5 py-3 font-medium">Customer</th>
                    <th className="px-3 py-3 text-right font-medium">Visits</th>
                    <th className="px-3 py-3 text-right font-medium">Total spent</th>
                    <th className="px-3 py-3 text-right font-medium">Loyalty points</th>
                    <th className="px-5 py-3 text-right font-medium">Last visit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.map((c) => (
                    <tr key={c.id} className="transition-colors hover:bg-raised">
                      <td className="px-5 py-3">
                        <Link href={`/dashboard/${branchId}/customers/${c.id}`} className="block">
                          <p className="font-medium">{c.name}</p>
                          <p className="flex items-center gap-1.5 text-xs text-muted">
                            {c.phone}
                            {c.isSeniorCitizen ? <Pill tone="accent">Senior</Pill> : null}
                            {c.needsAssistance ? <Pill tone="warning">Assistance</Pill> : null}
                          </p>
                        </Link>
                      </td>
                      <td className="tnum px-3 py-3 text-right text-muted">{c.visitCount}</td>
                      <td className="tnum px-3 py-3 text-right font-semibold">₹{c.totalSpent.toFixed(2)}</td>
                      <td className="tnum px-3 py-3 text-right text-muted">{c.loyaltyPoints}</td>
                      <td className="px-5 py-3 text-right text-xs text-muted">{timeAgo(c.lastVisitAt)}</td>
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
