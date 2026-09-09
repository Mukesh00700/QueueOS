'use client';

import { use, useEffect, useState } from 'react';
import {
  Activity,
  BellRing,
  CheckCircle2,
  Hand,
  MapPin,
  Star,
  XCircle,
} from 'lucide-react';
import { api, type TokenStatusResponse } from '@/lib/api';
import { useLive } from '@/lib/use-live';
import { useTheme } from '@/lib/theme';
import { AnimatedNumber, Button, Card, Pill, ProgressRing, Skeleton } from '@/components/ui';
import { JourneyTrail } from '@/components/journey';
import { cn } from '@/lib/utils';

/**
 * The customer's screen — the promise of the product in one view.
 *
 * Everything here answers one question: "when should I get up?" The token
 * number is secondary; the ETA and the recall prompt are the reason this page
 * exists.
 */
export default function TokenPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [queueId, setQueueId] = useState<string | null>(null);

  const { data, error, refresh } = useLive(
    code,
    () => api.token(code),
    queueId ? { queueIds: [queueId] } : {},
    { pollMs: 15_000 },
  );

  // The public code intentionally does not expose the internal token id, so the
  // subscription rides the queue room instead — the same events, no id leak.
  useEffect(() => {
    if (data && data.queue.id !== queueId) setQueueId(data.queue.id);
  }, [data, queueId]);

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface p-6">
        <Card className="max-w-sm p-8 text-center">
          <XCircle size={28} className="mx-auto text-danger" />
          <p className="mt-3 text-sm font-medium">{error}</p>
          <p className="mt-1 text-xs text-muted">Check the link on your receipt and try again.</p>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-6">
        <Skeleton className="h-20" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return <TokenView token={data} onChange={refresh} />;
}

const TERMINAL = ['COMPLETED', 'CANCELLED', 'NO_SHOW'];

function TokenView({ token, onChange }: { token: TokenStatusResponse; onChange: () => void }) {
  const { t, vertical, setVertical } = useTheme();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setVertical(token.vertical);
  }, [token.vertical, setVertical]);

  const stageIndex = journeyIndex(token);
  const eta = token.eta;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface text-fg">
      <div className="mx-auto max-w-md px-5 py-8">
        <header className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-white">
            <Activity size={18} strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{token.branch.organizationName}</p>
            <p className="truncate text-xs text-muted">
              {token.branch.name} · {token.queue.name}
            </p>
          </div>
        </header>

        {/* Recall is the single highest-leverage moment in the product: it turns
            a no-show back into a served visit, so it takes over the screen. */}
        {token.status === 'RECALL_PENDING' ? (
          <Card className="mt-6 border-warning/40 bg-warning/10 p-5 text-center">
            <BellRing size={26} className="mx-auto animate-bounce text-warning" />
            <p className="mt-3 text-lg font-bold">We called your {t.token.toLowerCase()}</p>
            {/* Deliberately does not promise the original position: confirming a
                recall re-queues the token a few places back rather than at the
                front, so "keep your place" would be a lie the next screen tells. */}
            <p className="mt-1 text-sm text-muted">
              Tap below within <RecallCountdown expiresAt={token.recallExpiresAt} /> to stay in the{' '}
              {t.queue.toLowerCase()}. You will drop a few places, not lose your turn.
            </p>
            <Button
              size="lg"
              variant="warning"
              loading={busy}
              className="mt-4 w-full"
              onClick={() => act(() => api.confirmRecall(token.code))}
            >
              <Hand size={18} /> I&apos;m here
            </Button>
          </Card>
        ) : null}

        {token.status === 'CALLED' ? (
          <Card className="mt-6 border-accent/40 bg-accent/10 p-5 text-center">
            <p className="text-lg font-bold text-accent">It&apos;s your turn</p>
            <p className="mt-1 text-sm">
              Please go to <span className="font-semibold">{token.counterName ?? t.counter}</span>
              {token.providerName ? ` · ${token.providerName}` : ''}
            </p>
          </Card>
        ) : null}

        <Card className="mt-6 overflow-hidden">
          <div className="relative flex flex-col items-center px-6 py-8">
            <div
              className="pointer-events-none absolute inset-0 opacity-50"
              style={{ background: 'radial-gradient(circle at 50% 30%, var(--glow), transparent 65%)' }}
            />
            <p className="relative text-[11px] font-medium uppercase tracking-[0.25em] text-muted">
              Your {t.token.toLowerCase()}
            </p>
            <p className="tnum relative text-6xl font-extrabold leading-none tracking-tight text-accent">
              {token.displayCode}
            </p>
            <div className="relative mt-3 flex items-center gap-2">
              <StatusPill status={token.status} />
              {token.priority !== 'NORMAL' ? (
                <Pill tone="warning">{token.priority.toLowerCase()}</Pill>
              ) : null}
            </div>
          </div>

          {eta && !TERMINAL.includes(token.status) ? (
            <div className="flex flex-col items-center gap-4 border-t border-line px-6 py-7">
              <ProgressRing progress={eta.confidence} size={168} stroke={11}>
                <LiveEta minutes={eta.minutes} />
                <span className="mt-1 text-xs text-muted">minutes away</span>
              </ProgressRing>

              <p className="text-center text-[15px] font-medium">{eta.message}</p>
              <p className="tnum text-xs text-muted">
                Likely between {eta.rangeMinutes[0]} and {eta.rangeMinutes[1]} min ·{' '}
                {Math.round(eta.confidence * 100)}% confidence
              </p>

              {eta.factors.length > 0 ? (
                <div className="flex flex-wrap justify-center gap-1.5">
                  {eta.factors.map((factor) => (
                    <span
                      key={factor}
                      className="rounded-full border border-line bg-raised px-2.5 py-1 text-[11px] text-muted"
                    >
                      {factor}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-3 divide-x divide-line border-t border-line text-center">
            <Stat label="Ahead of you" value={token.peopleAhead} />
            <Stat label="Position" value={token.position ?? 0} />
            <Stat label={t.nowServing} text={token.nowServing?.displayCode ?? '—'} />
          </div>
        </Card>

        {token.status === 'COMPLETED' ? (
          <FeedbackCard code={token.code} visit={t.visit} />
        ) : null}

        <Card className="mt-4 p-5">
          <p className="mb-4 text-sm font-semibold">Your {vertical.terminology.visit.toLowerCase()}</p>
          <JourneyTrail stages={vertical.journey} activeIndex={stageIndex} />
        </Card>

        {token.counterName ? (
          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted">
            <MapPin size={13} /> {token.counterName}
            {token.providerName ? ` · ${token.providerName}` : ''}
          </p>
        ) : null}

        {!TERMINAL.includes(token.status) && token.status !== 'SERVING' ? (
          <button
            onClick={() => act(() => api.cancelToken(token.code))}
            disabled={busy}
            className="mx-auto mt-6 block text-xs text-subtle underline underline-offset-4 hover:text-danger disabled:opacity-50"
          >
            Leave the {t.queue.toLowerCase()}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Index into `vertical.journey`, whose stages are
 * checked_in, queued, almost, assigned, serving, completed.
 */
function journeyIndex(token: TokenStatusResponse): number {
  switch (token.status) {
    case 'COMPLETED':
      return 5;
    case 'SERVING':
      return 4;
    case 'CALLED':
    case 'RECALL_PENDING':
      // Being called is the moment a counter is attached, so this is `assigned`.
      return 3;
    case 'WAITING':
      // "Almost your turn" is a state the customer feels, not one the server
      // stores — it starts when there are two people left ahead.
      return token.peopleAhead <= 2 ? 2 : 1;
    default:
      return 0;
  }
}

const STATUS_TONE: Record<string, { tone: 'accent' | 'success' | 'warning' | 'danger' | 'neutral'; label: string }> = {
  WAITING: { tone: 'accent', label: 'Waiting' },
  CALLED: { tone: 'warning', label: 'Called' },
  RECALL_PENDING: { tone: 'warning', label: 'Recalled' },
  SERVING: { tone: 'success', label: 'In service' },
  COMPLETED: { tone: 'success', label: 'Completed' },
  NO_SHOW: { tone: 'danger', label: 'Missed' },
  CANCELLED: { tone: 'neutral', label: 'Cancelled' },
};

function StatusPill({ status }: { status: string }) {
  const meta = STATUS_TONE[status] ?? { tone: 'neutral' as const, label: status };
  return (
    <Pill tone={meta.tone} dot={status === 'WAITING' || status === 'SERVING'}>
      {meta.label}
    </Pill>
  );
}

/**
 * Ticks the ETA down between server pushes.
 *
 * The API is authoritative, but a number that only moves when someone else is
 * served looks frozen. This decays locally and snaps back whenever a fresh
 * value arrives.
 */
function LiveEta({ minutes }: { minutes: number }) {
  const [shown, setShown] = useState(minutes);

  useEffect(() => {
    setShown(minutes);
    const anchor = Date.now();
    const id = setInterval(() => {
      const elapsed = (Date.now() - anchor) / 60_000;
      setShown(Math.max(0, Math.round(minutes - elapsed)));
    }, 15_000);
    return () => clearInterval(id);
  }, [minutes]);

  return <AnimatedNumber value={shown} className="text-5xl font-extrabold leading-none" />;
}

function RecallCountdown({ expiresAt }: { expiresAt: string | null }) {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () =>
      setLeft(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (left === null) return <span className="font-semibold">a moment</span>;
  return <span className="tnum font-semibold">{left}s</span>;
}

function Stat({ label, value, text }: { label: string; value?: number; text?: string }) {
  return (
    <div className="px-2 py-4">
      <p className="text-[10px] uppercase tracking-wide text-subtle">{label}</p>
      <p className="tnum mt-1 text-lg font-semibold">
        {text ?? <AnimatedNumber value={value ?? 0} />}
      </p>
    </div>
  );
}

function FeedbackCard({ code, visit }: { code: string; visit: string }) {
  const [rating, setRating] = useState(0);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <Card className="mt-4 flex items-center justify-center gap-2 p-5 text-sm text-success">
        <CheckCircle2 size={16} /> Thanks for the feedback
      </Card>
    );
  }

  return (
    <Card className="mt-4 p-5 text-center">
      <p className="text-sm font-semibold">How was your {visit.toLowerCase()}?</p>
      <div className="mt-3 flex justify-center gap-1.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => {
              setRating(star);
              api.feedback(code, star).then(() => setSent(true));
            }}
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
            className="p-1"
          >
            <Star
              size={26}
              className={cn(
                'transition-colors',
                star <= rating ? 'fill-warning text-warning' : 'text-subtle hover:text-warning',
              )}
            />
          </button>
        ))}
      </div>
    </Card>
  );
}
