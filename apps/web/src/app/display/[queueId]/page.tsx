'use client';

import { use, useEffect, useState } from 'react';
import { Activity, ArrowRight } from 'lucide-react';
import { api, type QueueDisplay } from '@/lib/api';
import { useLive } from '@/lib/use-live';
import { useTheme } from '@/lib/theme';
import { AnimatedNumber } from '@/components/ui';
import { cn, formatClock } from '@/lib/utils';

/**
 * Lobby TV.
 *
 * Read from ten metres away, so everything is oversized and there is exactly
 * one thing to look at. No navigation, no controls — this URL is opened once
 * on a stick PC and never touched again.
 */
export default function DisplayPage({ params }: { params: Promise<{ queueId: string }> }) {
  const { queueId } = use(params);
  const { data, error, live } = useLive(queueId, () => api.queueDisplay(queueId), {
    queueIds: [queueId],
  });

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface text-2xl text-danger">{error}</div>
    );
  }
  if (!data) {
    return <div className="grid min-h-screen place-items-center bg-surface text-muted">Loading…</div>;
  }

  return <DisplayBoard data={data} live={live} />;
}

function DisplayBoard({ data, live }: { data: QueueDisplay; live: boolean }) {
  const { t, vertical, setVertical } = useTheme();
  const { queue } = data;
  const upNext = queue.nextTokens.slice(0, 5);

  useEffect(() => {
    setVertical(data.vertical);
  }, [data.vertical, setVertical]);

  return (
    <div className="flex min-h-screen flex-col bg-surface text-fg">
      <header className="flex items-center justify-between border-b border-line px-10 py-6">
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent text-white">
            <Activity size={24} strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tight">{data.branch.organizationName}</p>
            <p className="text-base text-muted">
              {data.branch.name} · {queue.name}
              {data.department ? ` · ${data.department}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2 text-sm text-muted">
            <span className={cn('h-2.5 w-2.5 rounded-full', live ? 'bg-success live-dot' : 'bg-subtle')} />
            {live ? 'Live' : 'Reconnecting'}
          </span>
          <BigClock />
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 lg:grid-cols-[3fr_2fr]">
        <section className="relative flex flex-col items-center justify-center gap-4 px-10 py-14">
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{ background: `radial-gradient(circle at 50% 45%, var(--glow), transparent 62%)` }}
          />
          <p className="relative text-xl font-semibold uppercase tracking-[0.35em] text-muted">
            {t.nowServing}
          </p>
          <p
            className="tnum relative text-[clamp(6rem,20vw,16rem)] font-extrabold leading-none tracking-tighter"
            style={{ color: 'var(--accent)' }}
          >
            {queue.currentToken?.code ?? '—'}
          </p>
          {queue.currentToken ? (
            <p className="relative text-3xl font-semibold text-muted">
              {[queue.currentToken.counterName, vertical.board.showProvider ? queue.currentToken.providerName : null]
                .filter(Boolean)
                .join(' · ') || t.counter}
            </p>
          ) : (
            <p className="relative text-2xl text-muted">Please wait for the next call</p>
          )}
        </section>

        <section className="border-t border-line px-10 py-10 lg:border-l lg:border-t-0">
          <p className="text-lg font-semibold uppercase tracking-[0.2em] text-muted">Up next</p>
          <div className="mt-6 space-y-3">
            {upNext.length === 0 ? (
              <p className="text-xl text-subtle">No one waiting</p>
            ) : (
              upNext.map((token, index) => (
                <div
                  key={token.id}
                  className={cn(
                    'flex items-center justify-between rounded-2xl border border-line px-6 py-4',
                    index === 0 ? 'bg-accent/10' : 'bg-card',
                  )}
                >
                  <span className={cn('tnum text-4xl font-bold', index === 0 && 'text-accent')}>
                    {token.code}
                  </span>
                  <span className="flex items-center gap-3 text-lg text-muted">
                    {token.etaMinutes !== null ? (
                      <span className="tnum">~{token.etaMinutes} min</span>
                    ) : null}
                    {index === 0 ? <ArrowRight size={22} className="text-accent" /> : null}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="mt-10 grid grid-cols-3 gap-4 border-t border-line pt-6 text-center">
            <Stat label="Waiting" value={queue.waiting} />
            <Stat label={`${t.visit}s today`} value={queue.completedToday} />
            <Stat label="Avg wait" value={queue.averageWaitMinutes} suffix="m" />
          </div>
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div>
      <p className="text-sm uppercase tracking-wide text-subtle">{label}</p>
      <p className="mt-1 flex items-baseline justify-center gap-0.5 text-3xl font-bold">
        <AnimatedNumber value={value} />
        {suffix ? <span className="text-lg text-muted">{suffix}</span> : null}
      </p>
    </div>
  );
}

function BigClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) return <span className="tnum w-28 text-2xl" />;
  return <span className="tnum text-2xl font-semibold">{formatClock(now)}</span>;
}
