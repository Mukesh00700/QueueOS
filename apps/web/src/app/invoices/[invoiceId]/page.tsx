'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import { PAYMENT_METHODS } from '@queueos/core';
import { api, ApiError, type InvoiceDetail } from '@/lib/api';
import { Button, Card, Pill, Select, Skeleton } from '@/components/ui';

const INPUT =
  'h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-sm outline-none transition-colors focus:border-accent';

/**
 * The receipt — a printable view of an Invoice that, before this page
 * existed, was only ever a database row. Standalone rather than wrapped in
 * AppShell: its whole job is to be printed cleanly, and a sidebar has no
 * business on a piece of paper.
 */
export default function InvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = use(params);
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingVoid, setConfirmingVoid] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  function load() {
    api
      .invoice(invoiceId)
      .then(setInvoice)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load this invoice'));
  }

  useEffect(() => {
    api.me().catch(() => router.replace(`/login?next=/invoices/${invoiceId}`));
    load();
  }, [invoiceId]);

  async function handleVoid() {
    setVoiding(true);
    try {
      await api.voidInvoice(invoiceId);
      setConfirmingVoid(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not void this invoice');
    } finally {
      setVoiding(false);
    }
  }

  async function submitRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get('amount'));
    const reason = String(form.get('reason') ?? '').trim();
    if (!amount || amount <= 0) {
      setRefundError('Enter how much to refund');
      return;
    }
    if (!reason) {
      setRefundError('A reason is required for every refund');
      return;
    }
    setRefundBusy(true);
    setRefundError(null);
    try {
      await api.refundInvoice(invoiceId, { amount, method: String(form.get('method')), reason });
      setRefunding(false);
      load();
    } catch (err) {
      setRefundError(err instanceof ApiError ? err.message : 'Could not record this refund');
    } finally {
      setRefundBusy(false);
    }
  }

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface p-6">
        <Card className="max-w-sm p-6 text-center">
          <p className="text-sm font-medium text-danger">{error}</p>
        </Card>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const isVoid = invoice.status === 'VOID';
  const totalRefunded = invoice.refunds.reduce((sum, r) => sum + r.amount, 0);
  const refundable = invoice.total - totalRefunded;

  return (
    <div className="min-h-screen bg-surface text-fg print:min-h-0">
      {/* 80mm is the standard thermal receipt roll width — @page here is
          what actually tells the print dialog/driver to use it instead of
          A4/Letter; the print: utility classes below constrain the content
          to fit inside it. Can't verify this against real thermal hardware
          in this environment (none exists here) — this is the part of
          "receipt printing" that's genuinely checkable without it: a real
          browser's print-preview layout. Talking directly to a printer over
          USB/serial (raw ESC-POS bytes) needs a physical device or at least
          a printer-agent to target, so it's deliberately not built here. */}
      <style>{'@media print { @page { size: 80mm auto; margin: 0; } }'}</style>
      <div className="mx-auto max-w-lg px-6 py-10 print:max-w-[72mm] print:px-2 print:py-0 print:font-mono print:text-[11px]">
        <div className="flex items-center justify-between print:hidden">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-muted hover:text-fg"
          >
            <ArrowLeft size={14} /> Back
          </Link>
          <div className="flex items-center gap-2">
            {!isVoid && refundable > 0.01 ? (
              <Button variant="ghost" size="sm" onClick={() => setRefunding((r) => !r)}>
                Refund
              </Button>
            ) : null}
            {!isVoid ? (
              confirmingVoid ? (
                <>
                  <Button variant="danger" size="sm" loading={voiding} onClick={handleVoid}>
                    Confirm void
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmingVoid(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmingVoid(true)}>
                  Void invoice
                </Button>
              )
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              <Printer size={14} /> Print
            </Button>
          </div>
        </div>

        {refunding ? (
          <Card className="mt-4 p-5 print:hidden">
            <form onSubmit={submitRefund} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">Amount to refund</span>
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    max={refundable}
                    defaultValue={refundable.toFixed(2)}
                    className={INPUT}
                  />
                  <span className="mt-1 block text-xs text-subtle">Up to ₹{refundable.toFixed(2)} left to refund</span>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">Refunded via</span>
                  <Select name="method" defaultValue={invoice.payments[0]?.method ?? PAYMENT_METHODS[0]}>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Reason</span>
                <input name="reason" required placeholder="e.g. Item was wrong" className={INPUT} />
              </label>
              {refundError ? <p className="text-sm font-medium text-danger">{refundError}</p> : null}
              <div className="flex items-center gap-2">
                <Button type="submit" variant="danger" loading={refundBusy}>
                  Record refund
                </Button>
                <Button type="button" variant="ghost" onClick={() => setRefunding(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        ) : null}

        <Card className={`relative mt-6 overflow-hidden p-8 print:border-none print:p-0 print:shadow-none ${isVoid ? 'opacity-80' : ''}`}>
          {isVoid ? (
            <div className="absolute right-6 top-6">
              <Pill tone="danger">Void</Pill>
            </div>
          ) : null}

          <div>
            <p className="text-lg font-bold tracking-tight">{invoice.branch.organization.name}</p>
            <p className="text-sm text-muted">{invoice.branch.name}</p>
          </div>

          <div className="mt-6 flex items-baseline justify-between border-y border-line py-3 text-sm">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-subtle">Invoice</p>
              <p className="font-semibold">{invoice.number}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-subtle">Date</p>
              <p className="font-medium">
                {new Date(invoice.createdAt).toLocaleString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </div>

          {invoice.order.visit.customer ? (
            <p className="mt-3 text-sm text-muted">
              Billed to <span className="font-medium text-fg">{invoice.order.visit.customer.name}</span>
              {' · '}
              {invoice.order.visit.customer.phone}
            </p>
          ) : null}

          <div className="mt-5 space-y-2">
            {invoice.order.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate">
                    {item.quantity > 1 ? `${item.quantity}× ` : ''}
                    {item.description}
                  </p>
                  {item.gstRate > 0 ? (
                    <p className="text-[11px] text-subtle">GST {item.gstRate}%</p>
                  ) : null}
                </div>
                <span className="tnum shrink-0 font-medium">₹{item.lineTotal.toFixed(2)}</span>
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-1.5 border-t border-line pt-4 text-sm">
            <div className="flex items-center justify-between text-muted">
              <span>Subtotal</span>
              <span className="tnum">₹{invoice.subtotal.toFixed(2)}</span>
            </div>
            {invoice.taxAmount > 0 ? (
              <div className="flex items-center justify-between text-muted">
                <span>GST</span>
                <span className="tnum">₹{invoice.taxAmount.toFixed(2)}</span>
              </div>
            ) : null}
            {invoice.discountAmount > 0 ? (
              <div className="flex items-center justify-between text-success">
                <span className="truncate">
                  Discount{invoice.discountReason ? ` · ${invoice.discountReason}` : ''}
                </span>
                <span className="tnum shrink-0">−₹{invoice.discountAmount.toFixed(2)}</span>
              </div>
            ) : null}
            <div className="flex items-center justify-between text-base font-bold">
              <span>Total</span>
              <span className="tnum">₹{invoice.total.toFixed(2)}</span>
            </div>
            {totalRefunded > 0 ? (
              <>
                <div className="flex items-center justify-between text-danger">
                  <span>Refunded</span>
                  <span className="tnum">−₹{totalRefunded.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-line pt-1.5 text-base font-bold">
                  <span>Net</span>
                  <span className="tnum">₹{(invoice.total - totalRefunded).toFixed(2)}</span>
                </div>
              </>
            ) : null}
          </div>

          {invoice.loyaltyPointsEarned > 0 ? (
            <p className="mt-2 text-xs text-accent">Earned {invoice.loyaltyPointsEarned} loyalty pts</p>
          ) : null}

          <div className="mt-5 space-y-1.5 border-t border-line pt-4">
            <p className="text-[11px] uppercase tracking-wide text-subtle">
              {invoice.payments.length > 1 ? 'Payments' : 'Payment'}
            </p>
            {invoice.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span className="text-muted">{p.method}</span>
                <span className="tnum">₹{p.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>

          {invoice.refunds.length > 0 ? (
            <div className="mt-5 space-y-2 border-t border-line pt-4">
              <p className="text-[11px] uppercase tracking-wide text-subtle">
                {invoice.refunds.length > 1 ? 'Refunds' : 'Refund'}
              </p>
              {invoice.refunds.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-muted">{r.method}</p>
                    <p className="truncate text-[11px] text-subtle">{r.reason}</p>
                  </div>
                  <span className="tnum shrink-0 text-danger">−₹{r.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
