'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Package, Plus } from 'lucide-react';
import { ROLE_RANK, GST_RATES } from '@queueos/core';
import { api, type AuthUser, type BranchSummary, type ProductInput, type ProductRow } from '@/lib/api';
import { SetupShell } from '@/components/setup-shell';
import { Button, Card, CardHeader, EmptyState, Pill, Select, Skeleton } from '@/components/ui';

const INPUT =
  'h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-sm outline-none transition-colors focus:border-accent';

/**
 * Org-wide sellable catalogue — mirrors /setup/staff's shape (list + create
 * + inline edit), since Product is org-scoped the same way Staff is, not
 * nested under a branch like Queues/Counters.
 */
export default function ProductsSetupPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    try {
      const [p, b] = await Promise.all([api.products(), api.branches()]);
      setProducts(p);
      setBranches(b);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load products');
    }
  }

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => router.replace('/login?next=/setup/products'));
    load();
  }, []);

  if (user === undefined || (!loadError && !products)) {
    return (
      <SetupShell title="Products">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </SetupShell>
    );
  }
  if (!user) return null;

  const canManage = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK.ADMIN;
  if (!canManage) {
    return (
      <SetupShell title="Products">
        <Card>
          <EmptyState title="You don't have access to business setup" />
        </Card>
      </SetupShell>
    );
  }

  return (
    <SetupShell title="Products">
      {loadError ? (
        <Card className="p-5">
          <p className="text-sm text-danger">{loadError}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={load}>
            Retry
          </Button>
        </Card>
      ) : null}

      <CreateProductCard branches={branches} onCreated={load} />

      <Card>
        <CardHeader
          title="Catalogue"
          subtitle={`${(products ?? []).length} ${(products ?? []).length === 1 ? 'item' : 'items'}`}
          icon={<Package size={16} />}
        />
        <div className="divide-y divide-line">
          {(products ?? []).length === 0 ? (
            <EmptyState title="No products yet" detail="Add your first item above." />
          ) : (
            (products ?? []).map((p) => <ProductRowItem key={p.id} product={p} branches={branches} onSaved={load} />)
          )}
        </div>
      </Card>
    </SetupShell>
  );
}

function readProductForm(form: FormData): ProductInput {
  return {
    name: String(form.get('name') ?? ''),
    category: String(form.get('category') ?? ''),
    price: Number(form.get('price') ?? 0),
    hsnSac: String(form.get('hsnSac') ?? '') || undefined,
    gstRate: Number(form.get('gstRate') ?? 0),
    trackStock: form.get('trackStock') === 'on',
    branchIds: form.getAll('branchIds').map(String),
  };
}

/**
 * Left unchecked, a product is available at every branch — the only
 * behavior that existed before this picker did, and still the default for
 * a single-branch org. Checking specific branches restricts it to just
 * those. Not worth rendering for an org with one branch or none: there's
 * no meaningful choice to make.
 */
function BranchPicker({ branches, defaultCheckedIds }: { branches: BranchSummary[]; defaultCheckedIds: Set<string> }) {
  if (branches.length < 2) return null;
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">
        Available at <span className="font-normal text-muted">(none checked = every branch)</span>
      </span>
      <div className="flex flex-wrap gap-3">
        {branches.map((b) => (
          <label key={b.id} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              name="branchIds"
              value={b.id}
              defaultChecked={defaultCheckedIds.has(b.id)}
              className="h-4 w-4"
            />
            {b.name}
          </label>
        ))}
      </div>
    </div>
  );
}

function CreateProductCard({ branches, onCreated }: { branches: BranchSummary[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.createProduct(readProductForm(form));
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add product');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus size={15} /> New product
      </Button>
    );
  }

  return (
    <Card className="p-5">
      <CardHeader title="New product" className="px-0 pt-0" />
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Name</span>
            <input name="name" required placeholder="e.g. Veg Burger" className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Category</span>
            <input name="category" required placeholder="e.g. Food" className={INPUT} />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Price</span>
            <input name="price" type="number" step="0.01" min="0" required className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">GST rate</span>
            <Select name="gstRate" defaultValue="0">
              {GST_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}%
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">HSN/SAC (optional)</span>
            <input name="hsnSac" className={INPUT} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="trackStock" className="h-4 w-4" />
          Track stock for this item
        </label>

        <BranchPicker branches={branches} defaultCheckedIds={new Set()} />

        {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}

        <div className="flex items-center gap-2">
          <Button type="submit" loading={busy}>
            Add product
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ProductRowItem({
  product,
  branches,
  onSaved,
}: {
  product: ProductRow;
  branches: BranchSummary[];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restocking, setRestocking] = useState(false);
  const [restockQty, setRestockQty] = useState('');
  const [restockBusy, setRestockBusy] = useState(false);
  const [restockError, setRestockError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.updateProduct(product.id, { ...readProductForm(form), active: form.get('active') === 'on' });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update product');
    } finally {
      setBusy(false);
    }
  }

  async function submitRestock() {
    const qty = Number(restockQty);
    if (!qty || qty <= 0) {
      setRestockError('Enter how many arrived');
      return;
    }
    setRestockBusy(true);
    setRestockError(null);
    try {
      await api.restockProduct(product.id, qty);
      setRestocking(false);
      setRestockQty('');
      onSaved();
    } catch (err) {
      setRestockError(err instanceof Error ? err.message : 'Could not restock');
    } finally {
      setRestockBusy(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Name</span>
            <input name="name" required defaultValue={product.name} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Category</span>
            <input name="category" required defaultValue={product.category} className={INPUT} />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Price</span>
            <input
              name="price"
              type="number"
              step="0.01"
              min="0"
              required
              defaultValue={product.price}
              className={INPUT}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">GST rate</span>
            <Select name="gstRate" defaultValue={String(product.gstRate)}>
              {GST_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}%
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">HSN/SAC (optional)</span>
            <input name="hsnSac" defaultValue={product.hsnSac ?? ''} className={INPUT} />
          </label>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="trackStock" defaultChecked={product.trackStock} className="h-4 w-4" />
            Track stock
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={product.active} className="h-4 w-4" />
            Active
          </label>
        </div>

        <BranchPicker
          branches={branches}
          defaultCheckedIds={new Set((product.branches ?? []).map((b) => b.id))}
        />

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
    <div className="px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{product.name}</p>
          <p className="truncate text-xs text-muted">
            {product.category} · ₹{product.price.toFixed(2)}
            {product.gstRate > 0 ? ` · GST ${product.gstRate}%` : ''}
            {product.hsnSac ? ` · ${product.hsnSac}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {product.trackStock ? (
            <Pill tone={(product.stock ?? 0) <= 0 ? 'danger' : (product.stock ?? 0) <= 5 ? 'warning' : 'accent'}>
              {product.stock ?? 0} in stock
            </Pill>
          ) : null}
          {product.branches?.length ? (
            <Pill tone="warning">{product.branches.map((b) => b.name).join(', ')} only</Pill>
          ) : null}
          {!product.active ? <Pill tone="danger">inactive</Pill> : null}
          {product.trackStock ? (
            <Button variant="ghost" size="sm" onClick={() => setRestocking((r) => !r)}>
              Restock
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      </div>

      {restocking ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-raised p-3">
          <input
            type="number"
            min={1}
            autoFocus
            placeholder="Quantity received"
            value={restockQty}
            onChange={(event) => setRestockQty(event.target.value)}
            className={INPUT}
          />
          <Button size="sm" loading={restockBusy} onClick={submitRestock}>
            Add
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setRestocking(false);
              setRestockQty('');
              setRestockError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}
      {restockError ? <p className="mt-2 text-xs font-medium text-danger">{restockError}</p> : null}
    </div>
  );
}
