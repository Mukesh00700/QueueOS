'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, ShoppingBag, Truck, X } from 'lucide-react';
import { ROLE_RANK } from '@queueos/core';
import {
  api,
  type AuthUser,
  type BranchSummary,
  type ProductRow,
  type PurchaseOrderSummary,
  type SupplierInput,
  type SupplierRow,
} from '@/lib/api';
import { SetupShell } from '@/components/setup-shell';
import { Button, Card, CardHeader, EmptyState, Pill, Select, Skeleton } from '@/components/ui';

const INPUT =
  'h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-sm outline-none transition-colors focus:border-accent';

/**
 * Suppliers (master data) and the purchase orders placed against them, on
 * one page — small enough a domain that splitting it into two setup tabs
 * would just be extra navigation for no real separation of concerns.
 */
export default function SuppliersSetupPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [suppliers, setSuppliers] = useState<SupplierRow[] | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [branchId, setBranchId] = useState('');
  const [orders, setOrders] = useState<PurchaseOrderSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadSuppliers() {
    try {
      const [s, p, b] = await Promise.all([api.suppliers(), api.products(), api.branches()]);
      setSuppliers(s);
      setProducts(p);
      setBranches(b);
      setBranchId((current) => current || b[0]?.id || '');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load suppliers');
    }
  }

  async function loadOrders(forBranchId: string) {
    if (!forBranchId) return;
    try {
      setOrders(await api.purchaseOrders(forBranchId));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load purchase orders');
    }
  }

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => router.replace('/login?next=/setup/suppliers'));
    loadSuppliers();
  }, []);

  useEffect(() => {
    setOrders(null);
    loadOrders(branchId);
  }, [branchId]);

  if (user === undefined || (!loadError && !suppliers)) {
    return (
      <SetupShell title="Suppliers">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </SetupShell>
    );
  }
  if (!user) return null;

  const canManage = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK.ADMIN;
  if (!canManage) {
    return (
      <SetupShell title="Suppliers">
        <Card>
          <EmptyState title="You don't have access to business setup" />
        </Card>
      </SetupShell>
    );
  }

  return (
    <SetupShell title="Suppliers">
      {loadError ? (
        <Card className="p-5">
          <p className="text-sm text-danger">{loadError}</p>
        </Card>
      ) : null}

      <CreateSupplierCard onCreated={loadSuppliers} />

      <Card>
        <CardHeader
          title="Suppliers"
          subtitle={`${(suppliers ?? []).length} ${(suppliers ?? []).length === 1 ? 'supplier' : 'suppliers'}`}
          icon={<Truck size={16} />}
        />
        <div className="divide-y divide-line">
          {(suppliers ?? []).length === 0 ? (
            <EmptyState title="No suppliers yet" detail="Add your first one above." />
          ) : (
            (suppliers ?? []).map((s) => <SupplierRowItem key={s.id} supplier={s} onSaved={loadSuppliers} />)
          )}
        </div>
      </Card>

      {branches.length > 0 ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Purchase orders</h2>
            {branches.length > 1 ? (
              <Select value={branchId} onChange={(event) => setBranchId(event.target.value)} className="w-56">
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>

          <NewPurchaseOrderCard
            branchId={branchId}
            suppliers={suppliers ?? []}
            products={products}
            onCreated={() => loadOrders(branchId)}
          />

          <Card>
            <CardHeader
              title="Orders"
              subtitle={`${(orders ?? []).length} ${(orders ?? []).length === 1 ? 'order' : 'orders'}`}
              icon={<ShoppingBag size={16} />}
            />
            {!orders ? (
              <Skeleton className="h-32" />
            ) : orders.length === 0 ? (
              <EmptyState title="No purchase orders yet" detail="Place one above once you've added a supplier." />
            ) : (
              <div className="divide-y divide-line">
                {orders.map((po) => (
                  <PurchaseOrderRow key={po.id} po={po} onChanged={() => loadOrders(branchId)} />
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}
    </SetupShell>
  );
}

function CreateSupplierCard({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: SupplierInput = {
      name: String(form.get('name') ?? ''),
      phone: String(form.get('phone') ?? '') || undefined,
      email: String(form.get('email') ?? '') || undefined,
      notes: String(form.get('notes') ?? '') || undefined,
    };
    setBusy(true);
    setError(null);
    try {
      await api.createSupplier(body);
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add supplier');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus size={15} /> New supplier
      </Button>
    );
  }

  return (
    <Card className="p-5">
      <CardHeader title="New supplier" className="px-0 pt-0" />
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Name</span>
            <input name="name" required placeholder="e.g. Fresh Farms Produce" className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Phone</span>
            <input name="phone" className={INPUT} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Email (optional)</span>
          <input name="email" type="email" className={INPUT} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Notes (optional)</span>
          <input name="notes" className={INPUT} />
        </label>
        {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
        <div className="flex items-center gap-2">
          <Button type="submit" loading={busy}>
            Add supplier
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SupplierRowItem({ supplier, onSaved }: { supplier: SupplierRow; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.updateSupplier(supplier.id, {
        name: String(form.get('name') ?? ''),
        phone: String(form.get('phone') ?? '') || undefined,
        email: String(form.get('email') ?? '') || undefined,
        notes: String(form.get('notes') ?? '') || undefined,
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update supplier');
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Name</span>
            <input name="name" required defaultValue={supplier.name} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Phone</span>
            <input name="phone" defaultValue={supplier.phone ?? ''} className={INPUT} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Email</span>
          <input name="email" type="email" defaultValue={supplier.email ?? ''} className={INPUT} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Notes</span>
          <input name="notes" defaultValue={supplier.notes ?? ''} className={INPUT} />
        </label>
        {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
        <div className="flex items-center gap-2">
          <Button type="submit" loading={busy}>
            Save changes
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
        <p className="truncate text-sm font-semibold">{supplier.name}</p>
        <p className="truncate text-xs text-muted">
          {[supplier.phone, supplier.email].filter(Boolean).join(' · ') || 'No contact details'}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
        Edit
      </Button>
    </div>
  );
}

function NewPurchaseOrderCard({
  branchId,
  suppliers,
  products,
  onCreated,
}: {
  branchId: string;
  suppliers: SupplierRow[];
  products: ProductRow[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<{ productId: string; quantity: string; unitCost: string }[]>([
    { productId: '', quantity: '1', unitCost: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateLine(index: number, patch: Partial<{ productId: string; quantity: string; unitCost: string }>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const items = lines
      .filter((l) => l.productId && Number(l.quantity) > 0)
      .map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) || 0 }));
    if (!supplierId) {
      setError('Choose a supplier');
      return;
    }
    if (items.length === 0) {
      setError('Add at least one line item');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createPurchaseOrder({ branchId, supplierId, items });
      setOpen(false);
      setSupplierId('');
      setLines([{ productId: '', quantity: '1', unitCost: '' }]);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create purchase order');
    } finally {
      setBusy(false);
    }
  }

  if (suppliers.length === 0) {
    return <p className="text-xs text-subtle">Add a supplier above before placing an order.</p>;
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus size={15} /> New purchase order
      </Button>
    );
  }

  return (
    <Card className="p-5">
      <CardHeader title="New purchase order" className="px-0 pt-0" />
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Supplier</span>
          <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
            <option value="">Choose a supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>

        <div className="space-y-2">
          <span className="block text-sm font-medium">Items</span>
          {lines.map((line, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select
                value={line.productId}
                onChange={(event) => updateLine(i, { productId: event.target.value })}
                className="flex-1"
              >
                <option value="">Product</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <input
                type="number"
                min="1"
                placeholder="Qty"
                value={line.quantity}
                onChange={(event) => updateLine(i, { quantity: event.target.value })}
                className={`${INPUT} w-20`}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Unit cost"
                value={line.unitCost}
                onChange={(event) => updateLine(i, { unitCost: event.target.value })}
                className={`${INPUT} w-28`}
              />
              {lines.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-subtle transition-colors hover:text-danger"
                  aria-label="Remove line"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, { productId: '', quantity: '1', unitCost: '' }])}
            className="text-xs text-subtle underline underline-offset-4 hover:text-fg"
          >
            + Add line
          </button>
        </div>

        {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}

        <div className="flex items-center gap-2">
          <Button type="submit" loading={busy}>
            Place order
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PurchaseOrderRow({ po, onChanged }: { po: PurchaseOrderSummary; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = po.items.reduce((sum, i) => sum + i.lineTotal, 0);

  async function receive() {
    setBusy(true);
    setError(null);
    try {
      await api.receivePurchaseOrder(po.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark received');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{po.supplier.name}</p>
        <p className="truncate text-xs text-muted">
          {new Date(po.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          {' · '}₹{total.toFixed(2)}
        </p>
        {error ? <p className="mt-1 text-xs font-medium text-danger">{error}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Pill tone={po.status === 'RECEIVED' ? 'success' : 'warning'}>
          {po.status === 'RECEIVED' ? 'Received' : 'Open'}
        </Pill>
        {po.status !== 'RECEIVED' ? (
          <Button variant="ghost" size="sm" loading={busy} onClick={receive}>
            Mark received
          </Button>
        ) : null}
      </div>
    </div>
  );
}
