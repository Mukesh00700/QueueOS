'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ChefHat, Clock } from 'lucide-react';
import { api, type KitchenTicket } from '@/lib/api';
import { useLive } from '@/lib/use-live';
import { Card, Pill, Skeleton } from '@/components/ui';
import { cn, timeAgo } from '@/lib/utils';

const STATUS_ORDER = ['QUEUED', 'PREPARING', 'READY'] as const;
type KitchenStatus = (typeof STATUS_ORDER)[number];

function nextStatus(current: string): KitchenStatus {
  const idx = STATUS_ORDER.indexOf(current as KitchenStatus);
  return STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
}

const STATUS_LABEL: Record<KitchenStatus, string> = {
  QUEUED: 'Queued',
  PREPARING: 'Preparing',
  READY: 'Ready',
};

/**
 * The kitchen board — a dedicated tablet screen, not tucked behind the
 * dashboard sidebar. Tickets are every order still in prep at this branch,
 * oldest first; a ticket clears itself once every item on it is tapped
 * through to READY, so there's nothing to manually dismiss.
 */
export default function KitchenPage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = use(params);
  const router = useRouter();

  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    api
      .me()
      .then(() => setAuthed(true))
      .catch(() => {
        setAuthed(false);
        router.replace(`/login?next=/kitchen/${branchId}`);
      });
  }, [branchId, router]);

  const { data: tickets, error, live } = useLive(branchId, () => api.kitchenBoard(branchId), { branchId }, {
    events: ['OrderLineAdded', 'KitchenItemUpdated', 'ServiceCompleted'],
  });

  const [pending, setPending] = useState<string | null>(null);

  async function cycleItem(itemId: string, current: string) {
    setPending(itemId);
    try {
      await api.setKitchenItemStatus(itemId, nextStatus(current));
    } catch {
      // The next live refresh (socket or poll) reconciles either way.
    } finally {
      setPending(null);
    }
  }

  if (authed !== true) {
    return <div className="min-h-screen bg-surface" />;
  }
  if (error) {
    return <div className="grid min-h-screen place-items-center bg-surface p-6 text-danger">{error}</div>;
  }
  if (!tickets) {
    return (
      <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface text-fg">
      <header className="flex items-center gap-3 border-b border-line bg-card px-6 py-4">
        <ChefHat size={20} className="text-accent" />
        <p className="text-lg font-bold tracking-tight">Kitchen</p>
        <span className="text-sm text-muted">{tickets.length} ticket{tickets.length === 1 ? '' : 's'} in prep</span>
        <span
          className={cn('ml-auto h-2.5 w-2.5 rounded-full', live ? 'bg-success live-dot' : 'bg-subtle')}
          title={live ? 'Live' : 'Reconnecting'}
        />
      </header>

      <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {tickets.length === 0 ? (
          <p className="col-span-full py-24 text-center text-sm text-muted">
            Nothing in prep — new orders show up here as they're rung in.
          </p>
        ) : (
          <AnimatePresence initial={false}>
            {tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} pending={pending} onTapItem={cycleItem} />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

function TicketCard({
  ticket,
  pending,
  onTapItem,
}: {
  ticket: KitchenTicket;
  pending: string | null;
  onTapItem: (itemId: string, current: string) => void;
}) {
  const ageMinutes = (Date.now() - new Date(ticket.createdAt).getTime()) / 60_000;
  const late = ageMinutes >= 10;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.18 }}
    >
      <Card className={cn('flex h-full flex-col p-4', late ? 'border-danger/60' : '')}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold">{ticket.customerName ?? 'Walk-in'}</p>
          <Pill tone={late ? 'danger' : 'neutral'}>
            <Clock size={11} className="mr-1 inline" />
            {timeAgo(ticket.createdAt)}
          </Pill>
        </div>
        <div className="flex-1 space-y-1.5">
          {ticket.items.map((item) => {
            const status = item.kitchenStatus as KitchenStatus;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTapItem(item.id, item.kitchenStatus)}
                disabled={pending === item.id}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50',
                  status === 'READY'
                    ? 'border-success/40 bg-success/10 text-muted line-through'
                    : status === 'PREPARING'
                      ? 'border-warning/40 bg-warning/10'
                      : 'border-line bg-raised',
                )}
              >
                <span className="truncate">
                  {item.quantity > 1 ? `${item.quantity}× ` : ''}
                  {item.description}
                </span>
                <span
                  className={cn(
                    'shrink-0 text-[10px] font-semibold uppercase tracking-wide',
                    status === 'READY' ? 'text-success' : status === 'PREPARING' ? 'text-warning' : 'text-subtle',
                  )}
                >
                  {STATUS_LABEL[status]}
                </span>
              </button>
            );
          })}
        </div>
      </Card>
    </motion.div>
  );
}
