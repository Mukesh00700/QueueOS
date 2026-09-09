import { Injectable } from '@nestjs/common';
import { loadFactorForHour, type QueueSnapshot } from '@queueos/core';
import { PrismaService } from '../prisma/prisma.service';
import { EtaService } from '../eta/eta.service';
import { QueueService, startOfToday } from '../queues/queue.service';

export interface Insight {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  /** The concrete thing an operator can do about it. */
  action: string | null;
  queueId: string | null;
}

/**
 * Operator recommendations.
 *
 * These are rules over live queue state, not a language model. That is a
 * deliberate choice for this layer: an operator acting on "open one more
 * counter" needs the reasoning to be auditable and the same inputs to always
 * produce the same advice. The rules also double as the labelled examples a
 * learned model would later be trained against.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly eta: EtaService,
  ) {}

  async forBranch(branchId: string): Promise<Insight[]> {
    const snapshots = await this.queues.listForBranch(branchId);
    const insights: Insight[] = [];

    for (const q of snapshots) {
      insights.push(...this.forQueue(q));
    }

    insights.push(...(await this.crossQueue(branchId, snapshots)));
    insights.push(...(await this.noShowInsight(branchId)));

    const rank = { critical: 0, warning: 1, info: 2 };
    return insights.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 6);
  }

  private forQueue(q: QueueSnapshot): Insight[] {
    const out: Insight[] = [];

    // Queue depth per counter is the clearest signal that staffing is short.
    const depthPerCounter = q.waiting / Math.max(1, q.openCounters);
    if (depthPerCounter > 10) {
      const projected = Math.round(depthPerCounter * q.averageServiceMinutes);
      const withOneMore = Math.round(
        (q.waiting / (q.openCounters + 1)) * q.averageServiceMinutes,
      );
      out.push({
        id: `depth-${q.id}`,
        severity: depthPerCounter > 18 ? 'critical' : 'warning',
        title: `${q.name} is ${q.waiting} deep across ${q.openCounters} open`,
        detail: `At the current ${q.averageServiceMinutes} min average, the last person in line waits about ${projected} min.`,
        action: `Open one more counter to bring the tail down to roughly ${withOneMore} min.`,
        queueId: q.id,
      });
    }

    if (q.status === 'PAUSED' && q.waiting > 0) {
      out.push({
        id: `paused-${q.id}`,
        severity: 'critical',
        title: `${q.name} is paused with ${q.waiting} waiting`,
        detail: 'Estimates shown to these customers are provisional while the queue is paused.',
        action: 'Resume the queue or notify waiting customers of the delay.',
        queueId: q.id,
      });
    }

    if (q.openCounters === 0 && q.waiting > 0) {
      out.push({
        id: `nocounters-${q.id}`,
        severity: 'critical',
        title: `${q.name} has no counter open`,
        detail: `${q.waiting} people are waiting with nobody serving.`,
        action: 'Assign a staff member to a counter on this queue.',
        queueId: q.id,
      });
    }

    return out;
  }

  /** Load imbalance between queues in the same branch. */
  private async crossQueue(branchId: string, snapshots: QueueSnapshot[]): Promise<Insight[]> {
    if (snapshots.length < 2) return [];

    const byWait = [...snapshots].sort(
      (a, b) => b.waiting / Math.max(1, b.openCounters) - a.waiting / Math.max(1, a.openCounters),
    );
    const busiest = byWait[0];
    const quietest = byWait[byWait.length - 1];

    const busiestDepth = busiest.waiting / Math.max(1, busiest.openCounters);
    const quietestDepth = quietest.waiting / Math.max(1, quietest.openCounters);

    if (busiestDepth >= 6 && quietestDepth <= 2 && quietest.openCounters > 1) {
      return [
        {
          id: `rebalance-${busiest.id}`,
          severity: 'warning',
          title: `${busiest.name} is congested while ${quietest.name} is idle`,
          detail: `${busiest.name} is ${Math.round(busiestDepth)} deep per counter; ${quietest.name} is ${Math.round(quietestDepth)}.`,
          action: `Move a counter from ${quietest.name} to ${busiest.name}.`,
          queueId: busiest.id,
        },
      ];
    }

    return [];
  }

  private async noShowInsight(branchId: string): Promise<Insight[]> {
    const since = startOfToday();
    const [noShows, total] = await Promise.all([
      this.prisma.token.count({ where: { branchId, status: 'NO_SHOW', joinedAt: { gte: since } } }),
      this.prisma.token.count({ where: { branchId, joinedAt: { gte: since } } }),
    ]);

    if (total < 10) return [];
    const rate = noShows / total;
    if (rate < 0.12) return [];

    return [
      {
        id: 'noshow-rate',
        severity: rate > 0.2 ? 'warning' : 'info',
        title: `No-show rate is ${Math.round(rate * 100)}% today`,
        detail: `${noShows} of ${total} tokens were never served.`,
        action: 'Lengthen the recall grace window or add an earlier reminder threshold.',
        queueId: null,
      },
    ];
  }

  /**
   * Forward-looking numbers for the prediction dashboard. The arrival forecast
   * projects today's observed rate onto the historical hour-of-day curve rather
   * than assuming the current rate holds flat.
   */
  async forecast(branchId: string) {
    const since = startOfToday();
    const now = new Date();

    const tokens = await this.prisma.token.findMany({
      where: { branchId, joinedAt: { gte: since } },
      select: { joinedAt: true },
    });

    const hoursElapsed = Math.max(1, (now.getTime() - since.getTime()) / 3_600_000);
    const observedRate = tokens.length / hoursElapsed;

    const remainingHours = Array.from({ length: Math.max(0, 19 - now.getHours()) }, (_, i) => now.getHours() + i + 1);
    const expectedWalkIns = Math.round(
      remainingHours.reduce((sum, h) => sum + observedRate * loadFactorForHour(h), 0),
    );

    const peakHour = remainingHours.reduce(
      (best, h) => (loadFactorForHour(h) > loadFactorForHour(best) ? h : best),
      remainingHours[0] ?? now.getHours(),
    );

    const snapshots = await this.queues.listForBranch(branchId);
    const worst = snapshots.reduce<QueueSnapshot | null>(
      (acc, q) => (!acc || q.waiting / Math.max(1, q.openCounters) > acc.waiting / Math.max(1, acc.openCounters) ? q : acc),
      null,
    );

    const totalCapacityPerHour = snapshots.reduce(
      (sum, q) => sum + (q.openCounters * 60) / Math.max(1, q.averageServiceMinutes),
      0,
    );

    // Staffing gap has two independent causes and both have to be counted, or
    // the panel ends up advising "no extra staff" while the insight list is
    // simultaneously flagging queues 20 deep. The first is flow — arrivals at
    // peak outrunning capacity. The second is the backlog already standing in
    // line, which persists even when the arrival rate looks comfortable.
    const averageService =
      snapshots.length > 0
        ? snapshots.reduce((s, q) => s + q.averageServiceMinutes, 0) / snapshots.length
        : 8;

    const peakArrivalRate = observedRate * loadFactorForHour(peakHour);
    const flowShortfall = Math.max(0, peakArrivalRate - totalCapacityPerHour);

    // Backlog work in server-hours, over the hour we would like to clear it in.
    const backlogMinutes = snapshots.reduce(
      (sum, q) => sum + q.waiting * q.averageServiceMinutes,
      0,
    );
    const currentServers = snapshots.reduce((sum, q) => sum + q.openCounters, 0);
    const TARGET_DRAIN_HOURS = 1.5;
    const serversToDrain = backlogMinutes / 60 / TARGET_DRAIN_HOURS;
    const backlogShortfall = Math.max(0, serversToDrain - currentServers);

    const recommendedExtraStaff = Math.ceil(
      (flowShortfall * averageService) / 60 + backlogShortfall,
    );

    return {
      expectedWalkIns,
      peakHour,
      peakHourLabel: `${peakHour % 12 === 0 ? 12 : peakHour % 12}:00 ${peakHour < 12 ? 'AM' : 'PM'}`,
      // Confidence tracks how much of the day has been observed — an hour of
      // data does not support a strong claim about the evening.
      confidence: Math.min(0.96, 0.45 + (hoursElapsed / 10) * 0.5),
      longestQueue: worst ? { id: worst.id, name: worst.name, waiting: worst.waiting } : null,
      expectedDelayMinutes: worst
        ? Math.round((worst.waiting / Math.max(1, worst.openCounters)) * worst.averageServiceMinutes)
        : 0,
      recommendedExtraStaff,
      capacityPerHour: Math.round(totalCapacityPerHour),
      observedArrivalsPerHour: Math.round(observedRate),
    };
  }
}
