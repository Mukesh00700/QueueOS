'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Clock,
  Info,
  Monitor,
  TrendingUp,
  UserX,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { QueueSnapshot, Terminology } from '@queueos/core';
import type {
  ActivityEntry,
  BranchStats,
  CounterRow,
  Forecast,
  Insight,
  TimelinePoint,
} from '@/lib/api';
import { AnimatedNumber, Card, CardHeader, EmptyState, Pill, ProgressRing } from '@/components/ui';
import { HEAT_COLORS, cn, queueHeat, timeAgo } from '@/lib/utils';

// --- KPIs --------------------------------------------------------------------

export function KpiRow({ stats, t }: { stats: BranchStats; t: Terminology }) {
  const cards: { label: string; value: number; suffix?: string; icon: LucideIcon; tone: string }[] = [
    { label: `${t.customerPlural} waiting`, value: stats.activeQueue, icon: Users, tone: 'text-accent' },
    { label: 'Average wait', value: stats.averageWaitMinutes, suffix: 'min', icon: Clock, tone: 'text-warning' },
    { label: `${t.visit}s today`, value: stats.servedToday, icon: CheckCircle2, tone: 'text-success' },
    { label: 'No-shows today', value: stats.noShowsToday, icon: UserX, tone: 'text-danger' },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{card.label}</p>
            <card.icon size={16} className={card.tone} />
          </div>
          <p className="mt-3 flex items-baseline gap-1.5">
            <AnimatedNumber value={card.value} className="text-3xl font-bold tracking-tight" />
            {card.suffix ? <span className="text-sm text-muted">{card.suffix}</span> : null}
          </p>
        </Card>
      ))}
    </div>
  );
}

// --- Live queue heat map -----------------------------------------------------

export function QueueGrid({ queues, t }: { queues: QueueSnapshot[]; t: Terminology }) {
  if (queues.length === 0) {
    return <EmptyState title={`No ${t.queuePlural.toLowerCase()} configured`} />;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {queues.map((queue) => (
        <QueueHeatCard key={queue.id} queue={queue} t={t} />
      ))}
    </div>
  );
}

function QueueHeatCard({ queue, t }: { queue: QueueSnapshot; t: Terminology }) {
  const heat = queueHeat(queue.waiting, queue.openCounters, queue.averageServiceMinutes);
  const colors = HEAT_COLORS[heat.level];
  const paused = queue.status !== 'OPEN';

  return (
    <Link href={`/queues/${queue.id}`} className="group block">
      <Card className={cn('p-5 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)]', paused && 'opacity-70')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{queue.name}</p>
            <p className="tnum mt-0.5 text-xs text-muted">
              {queue.openCounters} {queue.openCounters === 1 ? t.counter.toLowerCase() : t.counterPlural.toLowerCase()} open
              {' · '}
              {queue.averageServiceMinutes} min avg service
            </p>
          </div>
          {paused ? (
            <Pill tone="warning">{queue.status === 'PAUSED' ? 'Paused' : 'Closed'}</Pill>
          ) : (
            <Pill tone={heat.level === 'fast' ? 'success' : heat.level === 'busy' ? 'warning' : 'danger'} dot>
              {heat.level === 'fast' ? 'Flowing' : heat.level === 'busy' ? 'Busy' : 'Congested'}
            </Pill>
          )}
        </div>

        <div className="mt-4 flex items-end justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-subtle">Waiting</p>
            <AnimatedNumber value={queue.waiting} className="text-3xl font-bold leading-none" />
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-subtle">{t.nowServing}</p>
            <p className="tnum text-xl font-semibold leading-tight">
              {queue.currentToken?.code ?? '—'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-subtle">Tail wait</p>
            <p className={cn('tnum text-xl font-semibold leading-tight', colors.text)}>
              {heat.tailMinutes}m
            </p>
          </div>
        </div>

        {/* The bar is the fastest read on the page: length is queue depth, colour
            is how long the last person in it will actually wait. */}
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${Math.min(100, (heat.tailMinutes / 60) * 100)}%`,
              background: colors.raw,
            }}
          />
        </div>
      </Card>
    </Link>
  );
}

// --- Arrivals / wait timeline ------------------------------------------------

export function TimelineChart({ points }: { points: TimelinePoint[] }) {
  const maxArrivals = Math.max(1, ...points.map((p) => p.arrivals));
  const maxWait = Math.max(1, ...points.map((p) => p.averageWait));
  const now = new Date().getHours();

  return (
    <Card>
      <CardHeader
        title="Arrival flow"
        subtitle="Last twelve hours, with the average wait each hour experienced"
        icon={<TrendingUp size={16} />}
      />
      <div className="px-5 pb-5">
        {/* items-stretch, not items-end: the columns must fill the 160px track
            so the bars inside them have a height to be a percentage of. */}
        <div className="flex h-40 items-stretch gap-1">
          {points.map((point) => {
            const height = (point.arrivals / maxArrivals) * 100;
            const waitHeight = (point.averageWait / maxWait) * 100;
            const current = point.hour === now;
            return (
              <div key={point.hour} className="group relative flex flex-1 flex-col items-center justify-end gap-1">
                <div className="relative flex h-full w-full items-end justify-center">
                  <div
                    className={cn(
                      'w-full rounded-t-md transition-all',
                      current ? 'bg-accent' : 'bg-accent/30 group-hover:bg-accent/60',
                    )}
                    style={{ height: `${Math.max(2, height)}%` }}
                  />
                  {/* Wait line marker rides on top of the arrivals bar so a tall
                      bar with a high marker reads instantly as "overwhelmed". */}
                  <span
                    className="absolute left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full bg-warning"
                    style={{ bottom: `${Math.min(98, waitHeight)}%` }}
                  />
                </div>
                <span className={cn('tnum text-[9px]', current ? 'font-semibold text-accent' : 'text-subtle')}>
                  {point.label}
                </span>
                <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-lg border border-line bg-card px-2 py-1 text-[11px] shadow-[var(--shadow-raised)] group-hover:block">
                  <span className="tnum font-semibold">{point.arrivals}</span> arrivals ·{' '}
                  <span className="tnum text-warning">{point.averageWait}m</span> wait
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-4 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-sm bg-accent/50" /> Arrivals
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full bg-warning" /> Average wait
          </span>
        </div>
      </div>
    </Card>
  );
}

// --- AI prediction panel -----------------------------------------------------

export function AiPanel({ forecast, t }: { forecast: Forecast; t: Terminology }) {
  return (
    <Card>
      <CardHeader
        title="Queue Prediction AI"
        subtitle={`Next hour · peak at ${forecast.peakHourLabel}`}
        icon={<Brain size={16} className="text-ai" />}
        action={<Pill tone="ai">{Math.round(forecast.confidence * 100)}% confident</Pill>}
      />
      <div className="flex flex-col items-center gap-6 px-5 pb-5 sm:flex-row">
        <ProgressRing progress={forecast.confidence} size={132} stroke={9} color="var(--ai)">
          <AnimatedNumber value={forecast.expectedWalkIns} className="text-3xl font-bold leading-none" />
          <span className="mt-1 text-[11px] text-muted">expected {t.customerPlural.toLowerCase()}</span>
        </ProgressRing>

        <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Metric label="Capacity / hour" value={`${forecast.capacityPerHour}`} />
          <Metric label="Arriving / hour" value={`${forecast.observedArrivalsPerHour}`} />
          <Metric
            label="Expected delay"
            value={`${forecast.expectedDelayMinutes} min`}
            tone={forecast.expectedDelayMinutes > 20 ? 'text-danger' : undefined}
          />
          <Metric
            label="Extra staff needed"
            value={forecast.recommendedExtraStaff === 0 ? 'None' : `+${forecast.recommendedExtraStaff}`}
            tone={forecast.recommendedExtraStaff > 0 ? 'text-warning' : 'text-success'}
          />
          {forecast.longestQueue ? (
            <div className="col-span-2 rounded-xl border border-line bg-raised px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-subtle">Longest line</p>
              <p className="mt-0.5 text-sm font-medium">
                {forecast.longestQueue.name}{' '}
                <span className="tnum text-muted">· {forecast.longestQueue.waiting} waiting</span>
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-subtle">{label}</p>
      <p className={cn('tnum mt-0.5 text-lg font-semibold leading-tight', tone)}>{value}</p>
    </div>
  );
}

// --- Insights ----------------------------------------------------------------

const SEVERITY: Record<Insight['severity'], { icon: LucideIcon; tone: string; pill: 'accent' | 'warning' | 'danger' }> = {
  info: { icon: Info, tone: 'text-accent', pill: 'accent' },
  warning: { icon: AlertTriangle, tone: 'text-warning', pill: 'warning' },
  critical: { icon: AlertTriangle, tone: 'text-danger', pill: 'danger' },
};

export function InsightList({ insights }: { insights: Insight[] }) {
  return (
    <Card>
      <CardHeader title="AI Command Center" subtitle="Ranked by impact on wait time" icon={<Brain size={16} />} />
      <div className="space-y-2 px-5 pb-5">
        {insights.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={22} />} title="Everything is flowing" detail="No action needed right now." />
        ) : (
          insights.map((insight) => {
            const meta = SEVERITY[insight.severity];
            return (
              <div key={insight.id} className="rounded-xl border border-line bg-raised p-3.5">
                <div className="flex items-start gap-2.5">
                  <meta.icon size={15} className={cn('mt-0.5 shrink-0', meta.tone)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{insight.title}</p>
                    <p className="mt-0.5 text-xs text-muted">{insight.detail}</p>
                    {insight.action ? (
                      <p className={cn('mt-2 text-xs font-medium', meta.tone)}>→ {insight.action}</p>
                    ) : null}
                  </div>
                  {insight.queueId ? (
                    <Link
                      href={`/queues/${insight.queueId}`}
                      className="shrink-0 text-xs font-medium text-accent hover:underline"
                    >
                      Open
                    </Link>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

// --- Counters ----------------------------------------------------------------

export function CounterStrip({ counters, t }: { counters: CounterRow[]; t: Terminology }) {
  return (
    <Card>
      <CardHeader title={t.counterPlural} subtitle={`${counters.filter((c) => c.status === 'OPEN').length} open`} icon={<Monitor size={16} />} />
      <div className="grid gap-2 px-5 pb-5 sm:grid-cols-2">
        {counters.map((counter) => (
          <Link
            key={counter.id}
            href={`/counter/${counter.id}`}
            className="flex items-center gap-3 rounded-xl border border-line bg-raised px-3 py-2.5 transition-colors hover:border-line-strong"
          >
            <span
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                counter.status === 'OPEN' ? 'bg-success' : counter.status === 'BREAK' ? 'bg-warning' : 'bg-subtle',
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{counter.name}</p>
              <p className="truncate text-[11px] text-muted">
                {counter.providerName ?? `No ${t.provider.toLowerCase()} assigned`}
              </p>
            </div>
            <span className="shrink-0 text-[11px] text-subtle">{counter.queue?.name ?? '—'}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

// --- Activity feed -----------------------------------------------------------

const EVENT_LABEL: Record<string, string> = {
  QueueJoined: 'joined the line',
  TokenCreated: 'token issued',
  CustomerCheckedIn: 'checked in',
  QueueAdvanced: 'queue advanced',
  CounterAssigned: 'assigned to a counter',
  ServiceStarted: 'service started',
  ServiceCompleted: 'service completed',
  CustomerNoShow: 'marked no-show',
  RecallInitiated: 'recalled',
  RecallConfirmed: 'confirmed recall',
  QueuePaused: 'queue paused',
  QueueResumed: 'queue resumed',
  FeedbackSubmitted: 'left feedback',
  ETAUpdated: 'ETA updated',
};

const EVENT_TONE: Record<string, string> = {
  ServiceCompleted: 'bg-success',
  CustomerNoShow: 'bg-danger',
  RecallInitiated: 'bg-warning',
  RecallConfirmed: 'bg-success',
  QueuePaused: 'bg-warning',
};

export function ActivityFeed({ activity }: { activity: ActivityEntry[] }) {
  return (
    <Card>
      <CardHeader title="Live activity" subtitle="Straight off the event log" icon={<Clock size={16} />} />
      <div className="max-h-[420px] space-y-0 overflow-y-auto px-5 pb-5">
        {activity.length === 0 ? (
          <EmptyState title="Nothing yet today" />
        ) : (
          activity.map((entry) => (
            <div key={entry.id} className="flex items-start gap-3 border-b border-line py-2.5 last:border-0">
              <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', EVENT_TONE[entry.name] ?? 'bg-accent')} />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="tnum font-medium">
                    {typeof entry.payload.displayCode === 'string' ? entry.payload.displayCode : entry.name}
                  </span>{' '}
                  <span className="text-muted">{EVENT_LABEL[entry.name] ?? entry.name}</span>
                </p>
              </div>
              <span className="shrink-0 text-[11px] text-subtle">{timeAgo(entry.occurredAt)}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
