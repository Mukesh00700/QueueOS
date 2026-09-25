'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRightLeft,
  BellRing,
  Check,
  ChevronRight,
  Plus,
  ShoppingCart,
  SkipForward,
  UserRound,
  X,
} from 'lucide-react';
import { PAYMENT_METHODS } from '@queueos/core';
import { api, type CounterView, type ProductRow } from '@/lib/api';
import { useLive } from '@/lib/use-live';
import { useTheme } from '@/lib/theme';
import { AnimatedNumber, Button, Card, Pill, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * The counter tablet.
 *
 * Used standing up, at arm's length, dozens of times an hour. Four buttons,
 * nothing else competing for the tap: NEXT, RECALL, NO-SHOW, COMPLETE.
 */
const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  SERVING: 'success',
  BREAK: 'warning',
  CLOSED: 'danger',
  IDLE: 'neutral',
};
const STATUS_LABEL: Record<string, string> = {
  SERVING: 'Serving',
  BREAK: 'On break',
  CLOSED: 'Closed',
  IDLE: 'Idle',
};

export default function CounterPage({ params }: { params: Promise<{ counterId: string }> }) {
  const { counterId } = use(params);
  const router = useRouter();

  // Counter screens are the one part of the product behind a login. `null`
  // while unresolved so nothing — not even a skeleton tied to live data —
  // renders before the check settles; without this the shell could flash
  // real queue content for an instant ahead of the redirect.
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    api
      .me()
      .then(() => setAuthed(true))
      .catch(() => {
        setAuthed(false);
        router.replace(`/login?next=/counter/${counterId}`);
      });
  }, [counterId, router]);

  const [queueId, setQueueId] = useState<string | null>(null);
  const { data, error, refresh, live } = useLive(
    counterId,
    () => api.counter(counterId),
    queueId ? { queueIds: [queueId] } : {},
  );

  useEffect(() => {
    if (data && data.queue.id !== queueId) setQueueId(data.queue.id);
  }, [data, queueId]);

  if (authed !== true) {
    return <div className="min-h-screen bg-surface" />;
  }
  if (error) {
    return <div className="grid min-h-screen place-items-center bg-surface p-6 text-danger">{error}</div>;
  }
  if (!data) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-16" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  return <CounterConsole view={data} onChange={refresh} live={live} />;
}

function CounterConsole({
  view,
  onChange,
  live,
}: {
  view: CounterView;
  onChange: () => void;
  live: boolean;
}) {
  const { t, setVertical } = useTheme();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  // Split tender is just this array carrying more than one entry — the
  // common single-method case never adds a second line before submitting.
  const [tenders, setTenders] = useState<{ amount: number; method: string }[]>([]);
  const successTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A success message is a flash, not a persistent state — clear it itself.
  // An error stays put until the next action attempt (below) explains why.
  function flashSuccess(text: string) {
    setMessage({ kind: 'success', text });
    clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setMessage(null), 1800);
  }

  useEffect(() => {
    setVertical(view.vertical);
  }, [view.vertical, setVertical]);

  const { counter, queue, current, upNext, order, products } = view;
  const holding = current !== null;
  const isPaymentStage = view.stageType === 'PAYMENT';
  // A branch that's never configured a catalogue (hospital, salon, temple —
  // every branch before this feature existed) should see no trace of it.
  // Checking the order's own items too matters now that the product list is
  // stock-filtered: a cart that already holds the last unit of something
  // must stay visible even after that item drops out of the tap grid —
  // otherwise a real, already-committed sale would just disappear from
  // the screen the moment stock hits zero.
  const hasCatalogue = products.some((p) => p.active) || (order?.items.length ?? 0) > 0;

  // A stale confirm/amount/message should never carry over onto whichever token comes next.
  useEffect(() => {
    setConfirmingSkip(false);
    setPaymentAmount('');
    setTenders([]);
    setMessage(null);
  }, [current?.id]);

  useEffect(() => () => clearTimeout(successTimer.current), []);

  const tenderedSoFar = tenders.reduce((sum, t) => sum + t.amount, 0);
  const remainingBalance = order ? Math.max(0, order.total - tenderedSoFar) : 0;

  // The tender amount tracks whatever's still owed as it's built up — still
  // manually editable after, e.g. for a vertical with no catalogue lines.
  // Must also clear back to empty if the cart empties out (e.g. the last
  // item removed) — otherwise a stale total from a since-removed item could
  // get submitted as the tendered amount. Resets any in-progress split too:
  // the cart changing mid-payment invalidates whatever was already tendered
  // against the old total.
  useEffect(() => {
    setTenders([]);
    setPaymentAmount(order && order.total > 0 ? String(order.total) : '');
  }, [order?.total]);

  const ACTION_SUCCESS: Record<string, string> = {
    next: `Next ${t.customer.toLowerCase()} called`,
    recall: `${t.customer} recalled`,
    skip: 'Marked as no-show',
    complete: `${t.visit} completed`,
  };

  async function run(action: 'next' | 'recall' | 'skip' | 'complete') {
    setPending(action);
    setMessage(null);
    try {
      await api.counterAction(counter.id, action);
      flashSuccess(ACTION_SUCCESS[action]);
      onChange();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Action failed' });
    } finally {
      setPending(null);
    }
  }

  async function addProduct(productId: string) {
    setPending(`add-${productId}`);
    setMessage(null);
    try {
      await api.addOrderItem(counter.id, productId);
      onChange();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not add item' });
    } finally {
      setPending(null);
    }
  }

  async function removeItem(itemId: string) {
    setPending(`remove-${itemId}`);
    setMessage(null);
    try {
      await api.removeOrderItem(counter.id, itemId);
      onChange();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not remove item' });
    } finally {
      setPending(null);
    }
  }

  async function applyDiscount(type: 'FLAT' | 'PERCENT', value: number, reason: string) {
    setPending('discount');
    setMessage(null);
    try {
      await api.applyDiscount(counter.id, { type, value, reason });
      onChange();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not apply discount' });
    } finally {
      setPending(null);
    }
  }

  async function removeDiscount() {
    setPending('discount');
    setMessage(null);
    try {
      await api.removeDiscount(counter.id);
      onChange();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not remove discount' });
    } finally {
      setPending(null);
    }
  }

  async function redeemPoints(points: number) {
    setPending('discount');
    setMessage(null);
    try {
      await api.redeemPoints(counter.id, points);
      onChange();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not redeem points' });
    } finally {
      setPending(null);
    }
  }

  /**
   * A tap either finishes the sale or starts (continues) a split — never a
   * separate mode to opt into. If this tender covers what's left, submit
   * everything collected so far in one call; if it's short, bank it as a
   * line and keep going. The ordinary single-method sale is just the case
   * where the first tap already covers it all.
   */
  async function recordPayment(method: string) {
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) {
      setMessage({ kind: 'error', text: 'Enter an amount first' });
      return;
    }

    const soFar = [...tenders, { amount, method }];
    const total = order?.total ?? 0;
    const totalTendered = soFar.reduce((sum, t) => sum + t.amount, 0);

    if (total > 0 && totalTendered < total - 0.01) {
      setTenders(soFar);
      const left = total - totalTendered;
      setPaymentAmount(left.toFixed(2));
      setMessage(null);
      flashSuccess(`${method} ₹${amount.toFixed(2)} added — ₹${left.toFixed(2)} left`);
      return;
    }

    setPending('payment');
    setMessage(null);
    try {
      await api.recordPayment(counter.id, soFar);
      setTenders([]);
      setPaymentAmount('');
      flashSuccess(soFar.length > 1 ? 'Split payment recorded' : 'Payment recorded');
      onChange();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not record payment' });
    } finally {
      setPending(null);
    }
  }

  function clearTenders() {
    setTenders([]);
    setPaymentAmount(order && order.total > 0 ? String(order.total) : '');
    setMessage(null);
  }

  return (
    <div className="min-h-screen bg-surface text-fg">
      <header className="flex items-center gap-4 border-b border-line bg-card px-6 py-4">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold tracking-tight">{counter.name}</p>
          <p className="truncate text-xs text-muted">
            {queue.name}
            {counter.providerName ? ` · ${counter.providerName}` : ''}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Pill tone={STATUS_TONE[counter.status] ?? 'neutral'}>{STATUS_LABEL[counter.status] ?? counter.status}</Pill>
          <Link
            href={`/queues/${queue.id}`}
            target="_blank"
            className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-fg"
            title={`Move someone waiting to a different ${t.queue.toLowerCase()}`}
          >
            <ArrowRightLeft size={13} /> Transfer
          </Link>
          <span
            className={cn('h-2.5 w-2.5 rounded-full', live ? 'bg-success live-dot' : 'bg-subtle')}
            title={live ? 'Live' : 'Reconnecting'}
          />
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 p-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <Card className="relative overflow-hidden px-6 py-10 text-center">
            <div
              className="pointer-events-none absolute inset-0 opacity-50"
              style={{ background: 'radial-gradient(circle at 50% 30%, var(--glow), transparent 65%)' }}
            />
            <p className="relative text-[11px] font-medium uppercase tracking-[0.25em] text-muted">
              {t.nowServing}
            </p>
            {/* Code and name are one visual unit — animated as a single
                block so they never show a stale code next to a new name
                (or vice versa) mid-transition. No mode="wait": under back-
                to-back refetches (an immediate onChange() plus a debounced
                socket-triggered one landing moments later) the key can
                change again before an exit finishes, and "wait" can get
                stuck holding the screen blank. A plain crossfade has no
                such sequencing to get stuck in. */}
            <AnimatePresence>
              <motion.div
                key={current?.id ?? 'empty'}
                initial={{ opacity: 0, y: 14, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -14, scale: 0.94 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <p className="tnum relative mt-2 text-7xl font-extrabold leading-none tracking-tight text-accent">
                  {current?.code ?? '—'}
                </p>
                <p className="relative mt-3 text-sm text-muted">
                  {current
                    ? [current.customerName, current.priority !== 'NORMAL' ? current.priority : null]
                        .filter(Boolean)
                        .join(' · ')
                    : `Press NEXT to call the first ${t.customer.toLowerCase()}`}
                </p>
              </motion.div>
            </AnimatePresence>
          </Card>

          <AnimatePresence>
            {message ? (
              <motion.p
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className={cn(
                  'text-center text-sm font-medium',
                  message.kind === 'success' ? 'text-success' : 'text-danger',
                )}
              >
                {message.text}
              </motion.p>
            ) : null}
          </AnimatePresence>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              size="xl"
              onClick={() => run('next')}
              loading={pending === 'next'}
              disabled={pending !== null}
              className="sm:col-span-2"
            >
              <ChevronRight size={26} /> Next {t.customer.toLowerCase()}
            </Button>
            {isPaymentStage ? (
              <div className="sm:col-span-2 space-y-2">
                {tenders.length > 0 ? (
                  <div className="space-y-1.5 rounded-xl border border-line bg-raised p-3">
                    {tenders.map((t, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-muted">{t.method}</span>
                        <span className="tnum font-medium">₹{t.amount.toFixed(2)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between border-t border-line pt-1.5 text-sm font-semibold">
                      <span>Still owed</span>
                      <span className="tnum text-warning">₹{remainingBalance.toFixed(2)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={clearTenders}
                      disabled={pending !== null}
                      className="text-xs text-subtle underline underline-offset-4 hover:text-danger disabled:opacity-50"
                    >
                      Clear and start over
                    </button>
                  </div>
                ) : null}
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="Amount"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  disabled={!holding || pending !== null}
                  className="h-14 w-full rounded-2xl border border-line bg-raised px-4 text-xl font-semibold tabular-nums outline-none transition-colors focus:border-accent disabled:opacity-50"
                />
                <div className="grid grid-cols-4 gap-2">
                  {PAYMENT_METHODS.map((method) => (
                    <Button
                      key={method}
                      size="lg"
                      variant="success"
                      onClick={() => recordPayment(method)}
                      loading={pending === 'payment'}
                      disabled={pending !== null || !holding}
                    >
                      {method}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <Button
                size="xl"
                variant="success"
                onClick={() => run('complete')}
                loading={pending === 'complete'}
                disabled={pending !== null || !holding}
              >
                <Check size={24} /> Complete
              </Button>
            )}
            <Button
              size="xl"
              variant="warning"
              onClick={() => run('recall')}
              loading={pending === 'recall'}
              disabled={pending !== null || !holding}
            >
              <BellRing size={24} /> Recall
            </Button>
            {confirmingSkip ? (
              <div className="flex gap-3 sm:col-span-2">
                <Button
                  size="xl"
                  variant="danger"
                  onClick={() => {
                    setConfirmingSkip(false);
                    run('skip');
                  }}
                  loading={pending === 'skip'}
                  disabled={pending !== null}
                  className="flex-1"
                >
                  <SkipForward size={24} /> Confirm no-show
                </Button>
                <Button
                  size="xl"
                  variant="secondary"
                  onClick={() => setConfirmingSkip(false)}
                  disabled={pending !== null}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="xl"
                variant="danger"
                onClick={() => setConfirmingSkip(true)}
                disabled={pending !== null || !holding}
                className="sm:col-span-2"
              >
                <SkipForward size={24} /> No-show
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {holding && hasCatalogue ? (
            <CartSection
              order={order}
              products={products}
              pending={pending}
              onAdd={addProduct}
              onRemove={removeItem}
              onApplyDiscount={applyDiscount}
              onRemoveDiscount={removeDiscount}
              onRedeemPoints={redeemPoints}
            />
          ) : null}

          <Card className="grid grid-cols-3 divide-x divide-line text-center">
            <Stat label="Waiting" value={queue.waiting} />
            <Stat label="Done today" value={queue.completedToday} />
            <Stat label="Avg service" value={queue.averageServiceMinutes} suffix="m" />
          </Card>

          <Card className="p-5">
            <p className="mb-3 text-sm font-semibold">Up next</p>
            <div className="space-y-2">
              {upNext.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">
                  No one waiting in {queue.name}
                </p>
              ) : (
                <AnimatePresence initial={false}>
                  {upNext.map((token, index) => (
                    <motion.div
                      key={token.id}
                      layout
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: 24 }}
                      transition={{ duration: 0.2 }}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border border-line px-4 py-3',
                        index === 0 ? 'bg-accent/10' : 'bg-raised',
                      )}
                    >
                      <span className={cn('tnum text-xl font-bold', index === 0 && 'text-accent')}>
                        {token.code}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          <UserRound size={12} className="mr-1 inline text-subtle" />
                          {token.customerName ?? 'Walk-in'}
                        </p>
                      </div>
                      {token.status === 'RECALL_PENDING' ? (
                        <Pill tone="warning">Recalled</Pill>
                      ) : token.priority !== 'NORMAL' ? (
                        <Pill tone="accent">{token.priority.toLowerCase()}</Pill>
                      ) : null}
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * The cart for whoever's currently being served — "a counter already is
 * the POS terminal." No search box, no custom-item entry, no quantity
 * stepper: tap a product to add it, tap × to remove a line. A floor tool,
 * not a form.
 */
function CartSection({
  order,
  products,
  pending,
  onAdd,
  onRemove,
  onApplyDiscount,
  onRemoveDiscount,
  onRedeemPoints,
}: {
  order: CounterView['order'];
  products: ProductRow[];
  pending: string | null;
  onAdd: (productId: string) => void;
  onRemove: (itemId: string) => void;
  onApplyDiscount: (type: 'FLAT' | 'PERCENT', value: number, reason: string) => void;
  onRemoveDiscount: () => void;
  onRedeemPoints: (points: number) => void;
}) {
  const categories = Array.from(new Set(products.filter((p) => p.active).map((p) => p.category)));
  const [discounting, setDiscounting] = useState(false);
  const [discType, setDiscType] = useState<'FLAT' | 'PERCENT'>('FLAT');
  const [discValue, setDiscValue] = useState('');
  const [discReason, setDiscReason] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemValue, setRedeemValue] = useState('');

  function submitDiscount() {
    const value = Number(discValue);
    if (!value || value <= 0 || !discReason.trim()) return;
    onApplyDiscount(discType, value, discReason.trim());
    setDiscounting(false);
    setDiscValue('');
    setDiscReason('');
  }

  function submitRedeem() {
    const points = Number(redeemValue);
    if (!points || points <= 0) return;
    onRedeemPoints(Math.floor(points));
    setRedeeming(false);
    setRedeemValue('');
  }

  return (
    <Card className="p-5">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <ShoppingCart size={15} /> Cart
      </p>

      {order && order.items.length > 0 ? (
        <div className="mb-4 space-y-2">
          <AnimatePresence initial={false}>
            {order.items.map((item) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-3 rounded-xl border border-line bg-raised px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {item.quantity > 1 ? `${item.quantity}× ` : ''}
                    {item.description}
                  </p>
                </div>
                <span className="tnum text-sm font-semibold">₹{item.lineTotal.toFixed(2)}</span>
                {item.productId ? (
                  <button
                    type="button"
                    onClick={() => onRemove(item.id)}
                    disabled={pending !== null}
                    className="text-subtle transition-colors hover:text-danger disabled:opacity-50"
                    aria-label={`Remove ${item.description}`}
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </motion.div>
            ))}
          </AnimatePresence>
          <div className="space-y-1 border-t border-line pt-2 text-sm">
            <div className="flex items-center justify-between text-muted">
              <span>Subtotal</span>
              <span className="tnum">₹{order.subtotal.toFixed(2)}</span>
            </div>
            {order.taxAmount > 0 ? (
              <div className="flex items-center justify-between text-muted">
                <span>GST</span>
                <span className="tnum">₹{order.taxAmount.toFixed(2)}</span>
              </div>
            ) : null}
            {order.discountAmount > 0 ? (
              <div className="flex items-center justify-between text-success">
                <span className="truncate">
                  Discount{order.discountReason ? ` · ${order.discountReason}` : ''}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 tnum">
                  −₹{order.discountAmount.toFixed(2)}
                  <button
                    type="button"
                    onClick={onRemoveDiscount}
                    disabled={pending !== null}
                    className="text-subtle transition-colors hover:text-danger disabled:opacity-50"
                    aria-label="Remove discount"
                  >
                    <X size={12} />
                  </button>
                </span>
              </div>
            ) : null}
            <div className="flex items-center justify-between font-semibold">
              <span>Total</span>
              <span className="tnum">₹{order.total.toFixed(2)}</span>
            </div>
          </div>

          {order.discountAmount === 0 ? (
            discounting ? (
              <div className="mt-2 space-y-2 rounded-xl border border-line bg-raised p-3">
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDiscType('FLAT')}
                    className={cn(
                      'flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors',
                      discType === 'FLAT' ? 'border-accent text-accent' : 'border-line text-muted',
                    )}
                  >
                    ₹ Flat
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiscType('PERCENT')}
                    className={cn(
                      'flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors',
                      discType === 'PERCENT' ? 'border-accent text-accent' : 'border-line text-muted',
                    )}
                  >
                    % Off
                  </button>
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder={discType === 'PERCENT' ? 'e.g. 10' : 'e.g. 50'}
                  value={discValue}
                  onChange={(event) => setDiscValue(event.target.value)}
                  className="h-9 w-full rounded-lg border border-line bg-card px-2.5 text-sm outline-none focus:border-accent"
                />
                <input
                  type="text"
                  placeholder="Reason (e.g. Loyalty offer)"
                  value={discReason}
                  onChange={(event) => setDiscReason(event.target.value)}
                  className="h-9 w-full rounded-lg border border-line bg-card px-2.5 text-sm outline-none focus:border-accent"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={submitDiscount}
                    disabled={!discValue || !discReason.trim() || pending !== null}
                  >
                    Apply
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDiscounting(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setDiscounting(true)}
                disabled={pending !== null}
                className="mt-2 text-xs text-subtle underline underline-offset-4 hover:text-fg disabled:opacity-50"
              >
                + Add discount
              </button>
            )
          ) : null}

          {order.discountAmount === 0 && order.customerLoyaltyPoints !== null && order.customerLoyaltyPoints > 0 ? (
            redeeming ? (
              <div className="mt-2 space-y-2 rounded-xl border border-line bg-raised p-3">
                <p className="text-xs text-subtle">{order.customerLoyaltyPoints} pts available · ₹1 each</p>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max={order.customerLoyaltyPoints}
                  placeholder={`Up to ${order.customerLoyaltyPoints}`}
                  value={redeemValue}
                  onChange={(event) => setRedeemValue(event.target.value)}
                  className="h-9 w-full rounded-lg border border-line bg-card px-2.5 text-sm outline-none focus:border-accent"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={submitRedeem} disabled={!redeemValue || pending !== null}>
                    Redeem
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRedeeming(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setRedeeming(true)}
                disabled={pending !== null}
                className="mt-2 block text-xs text-subtle underline underline-offset-4 hover:text-fg disabled:opacity-50"
              >
                + Redeem loyalty points ({order.customerLoyaltyPoints} available)
              </button>
            )
          ) : null}
        </div>
      ) : (
        <p className="mb-4 text-xs text-subtle">No items yet — tap a product to add it.</p>
      )}

      {categories.length === 0 ? (
        <p className="text-xs text-subtle">
          Nothing available to add right now — set up products or restock from Setup.
        </p>
      ) : (
        <div className="space-y-3">
          {categories.map((category) => (
            <div key={category}>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-subtle">{category}</p>
              <div className="flex flex-wrap gap-1.5">
                {products
                  .filter((p) => p.active && p.category === category)
                  .map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => onAdd(product.id)}
                      disabled={pending !== null}
                      className="flex items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-accent disabled:opacity-50"
                    >
                      <Plus size={11} className="text-accent" />
                      {product.name}
                      <span className="text-subtle">₹{product.price.toFixed(0)}</span>
                      {product.trackStock && (product.stock ?? 0) <= 5 ? (
                        <span className="text-warning">{product.stock} left</span>
                      ) : null}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="px-2 py-4">
      <p className="text-[10px] uppercase tracking-wide text-subtle">{label}</p>
      <p className="mt-1 flex items-baseline justify-center gap-0.5 text-2xl font-bold">
        <AnimatedNumber value={value} />
        {suffix ? <span className="text-sm text-muted">{suffix}</span> : null}
      </p>
    </div>
  );
}
