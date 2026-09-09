import { Injectable } from '@nestjs/common';
import {
  computeEta,
  loadFactorForHour,
  serviceStatsFrom,
  type EtaResult,
  type ServiceStats,
} from '@queueos/core';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Context shared by every token in one queue at one moment. Built once per
 * recalculation pass rather than per token — a 200-deep queue would otherwise
 * issue 200 identical stats queries.
 */
export interface QueueEtaContext {
  queueId: string;
  stats: ServiceStats;
  openCounters: number;
  inProgressElapsedMinutes: number[];
  loadFactor: number;
  paused: boolean;
}

/** Stats change slowly; recomputing them on every socket tick is wasteful. */
const STATS_TTL_MS = 30_000;

/** How many recent services the rolling mean is built from. */
const STATS_WINDOW = 50;

@Injectable()
export class EtaService {
  private readonly statsCache = new Map<string, { value: ServiceStats; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async buildContext(queueId: string, now = new Date()): Promise<QueueEtaContext> {
    const [queue, stats, counters, inProgress] = await Promise.all([
      this.prisma.queue.findUniqueOrThrow({ where: { id: queueId } }),
      this.serviceStats(queueId),
      this.prisma.counter.findMany({
        where: { queueId, status: { in: ['IDLE', 'SERVING'] } },
        select: { id: true },
      }),
      this.prisma.token.findMany({
        where: { queueId, status: 'SERVING', servedAt: { not: null } },
        select: { servedAt: true },
      }),
    ]);

    // A queue with no configured counters still serves people — assume one.
    const openCounters = Math.max(1, counters.length);

    const inProgressElapsedMinutes = inProgress
      .map((t) => (t.servedAt ? minutesBetween(t.servedAt, now) : 0))
      .filter((m) => m >= 0);

    // Baseline is used until the queue has produced enough real samples.
    const effectiveStats: ServiceStats =
      stats.sampleSize >= 5
        ? stats
        : { ...stats, meanMinutes: queue.baselineServiceMinutes, stdDevMinutes: Math.max(stats.stdDevMinutes, queue.baselineServiceMinutes * 0.35) };

    return {
      queueId,
      stats: effectiveStats,
      openCounters,
      inProgressElapsedMinutes,
      loadFactor: loadFactorForHour(now.getHours()),
      paused: queue.status === 'PAUSED',
    };
  }

  /**
   * ETA for a token sitting behind `peopleAhead` others. `recallPendingAhead`
   * is a subset of `peopleAhead`.
   */
  estimate(ctx: QueueEtaContext, peopleAhead: number, recallPendingAhead = 0): EtaResult {
    return computeEta({
      peopleAhead,
      openCounters: ctx.openCounters,
      stats: ctx.stats,
      inProgressElapsedMinutes: ctx.inProgressElapsedMinutes,
      recallPendingAhead,
      loadFactor: ctx.loadFactor,
      paused: ctx.paused,
    });
  }

  invalidate(queueId: string) {
    this.statsCache.delete(queueId);
  }

  private async serviceStats(queueId: string): Promise<ServiceStats> {
    const cached = this.statsCache.get(queueId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const rows = await this.prisma.token.findMany({
      where: { queueId, status: 'COMPLETED', serviceMinutes: { not: null } },
      orderBy: { completedAt: 'desc' },
      take: STATS_WINDOW,
      select: { serviceMinutes: true },
    });

    const value = serviceStatsFrom(rows.map((r) => r.serviceMinutes as number));
    this.statsCache.set(queueId, { value, expiresAt: Date.now() + STATS_TTL_MS });
    return value;
  }
}

export function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 60_000;
}
