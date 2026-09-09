import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ACTIVE_TOKEN_STATUSES,
  ETA_ALERT_THRESHOLDS,
  ROLE_RANK,
  getVertical,
  type Priority,
  type QueueSnapshot,
  type TokenStatus,
  type TokenSnapshot,
} from '@queueos/core';
import type { Prisma, Token } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';
import { EtaService } from '../eta/eta.service';
import type { JwtPayload } from '../auth/auth.service';
import { formatDisplayCode, minutesBetween, IN_LINE_ORDER } from './queue.util';
import type {
  CreateQueueDto,
  CreateServiceTypeDto,
  UpdateQueueDto,
  UpdateServiceTypeDto,
} from './queue.dto';

/** Statuses that still hold a place in line, ordered ahead of the requester. */
const AHEAD_STATUSES: TokenStatus[] = ['WAITING', 'CALLED', 'RECALL_PENDING'];

/** An ETA is only rewritten when it moves enough for a human to notice. */
const ETA_WRITE_THRESHOLD_MINUTES = 1;

/** Width of the rolling arrivals chart, in hours. */
const HOURLY_BUCKETS = 12;

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBusService,
    private readonly eta: EtaService,
  ) {}

  /** Raw queue rows (config fields, not the computed live snapshot) for the setup page. */
  rawForBranch(branchId: string) {
    return this.prisma.queue.findMany({
      where: { branchId },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async listForBranch(branchId: string) {
    const queues = await this.prisma.queue.findMany({
      where: { branchId },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return Promise.all(queues.map((q) => this.snapshot(q.id)));
  }

  /**
   * Everything a public screen needs in one round trip.
   *
   * The TV display and the customer-facing queue detail need the branch name
   * and the vertical to pick their wording; those never change while the screen
   * is mounted, so bundling them with the snapshot saves a second request on
   * every poll.
   */
  async displayContext(queueId: string) {
    const queue = await this.prisma.queue.findUnique({
      where: { id: queueId },
      include: { branch: { include: { organization: true } } },
    });
    if (!queue) throw new NotFoundException(`Queue ${queueId} not found`);

    return {
      queue: await this.snapshot(queueId),
      department: queue.department,
      branch: {
        id: queue.branchId,
        name: queue.branch.name,
        organizationName: queue.branch.organization.name,
      },
      vertical: queue.branch.organization.vertical,
    };
  }

  async snapshot(queueId: string): Promise<QueueSnapshot> {
    const queue = await this.prisma.queue.findUnique({
      where: { id: queueId },
      include: { counters: true },
    });
    if (!queue) throw new NotFoundException(`Queue ${queueId} not found`);

    const since = startOfToday();

    const [active, completedToday, noShowToday, waitSamples] = await Promise.all([
      this.prisma.token.findMany({
        where: { queueId, status: { in: [...ACTIVE_TOKEN_STATUSES] } },
        orderBy: IN_LINE_ORDER,
        include: { counter: true, customer: true },
      }),
      this.prisma.token.count({ where: { queueId, status: 'COMPLETED', completedAt: { gte: since } } }),
      this.prisma.token.count({ where: { queueId, status: 'NO_SHOW', joinedAt: { gte: since } } }),
      this.prisma.token.findMany({
        where: { queueId, waitMinutes: { not: null }, joinedAt: { gte: since } },
        select: { waitMinutes: true },
        take: 100,
        orderBy: { calledAt: 'desc' },
      }),
    ]);

    const ctx = await this.eta.buildContext(queueId);

    const serving = active.filter((t) => t.status === 'SERVING');
    const inLine = active.filter((t) => AHEAD_STATUSES.includes(t.status as TokenStatus));

    const currentToken = serving[0] ?? active.find((t) => t.status === 'CALLED') ?? null;

    const averageWait =
      waitSamples.length > 0
        ? waitSamples.reduce((s, r) => s + (r.waitMinutes ?? 0), 0) / waitSamples.length
        : 0;

    return {
      id: queue.id,
      name: queue.name,
      status: queue.status,
      waiting: inLine.length,
      serving: serving.length,
      completedToday,
      noShowToday,
      currentToken: currentToken ? this.toSnapshot(currentToken, queue.tokenPrefix, null) : null,
      nextTokens: inLine.slice(0, 8).map((t, i) => this.toSnapshot(t, queue.tokenPrefix, i)),
      averageWaitMinutes: Math.round(averageWait),
      averageServiceMinutes: Math.round(ctx.stats.meanMinutes),
      openCounters: ctx.openCounters,
    };
  }

  /**
   * Recalculates every active token's ETA and pushes the changes out.
   *
   * Called after any state transition rather than on a timer, because the whole
   * product promise is that the number on the customer's phone is current. The
   * write is filtered to material changes so a 200-deep queue does not generate
   * 200 rows of churn every time one person is served.
   */
  async recalculate(queueId: string, actorId?: string | null): Promise<void> {
    const queue = await this.prisma.queue.findUnique({ where: { id: queueId } });
    if (!queue) return;

    this.eta.invalidate(queueId);
    const ctx = await this.eta.buildContext(queueId);

    const inLine = await this.prisma.token.findMany({
      where: { queueId, status: { in: AHEAD_STATUSES } },
      orderBy: IN_LINE_ORDER,
    });

    let recallPendingSeen = 0;

    for (let i = 0; i < inLine.length; i++) {
      const token = inLine[i];
      const result = this.eta.estimate(ctx, i, recallPendingSeen);
      if (token.status === 'RECALL_PENDING') recallPendingSeen++;

      const previous = token.etaMinutes;
      const changed =
        previous === null ||
        Math.abs(previous - result.minutes) >= ETA_WRITE_THRESHOLD_MINUTES ||
        Math.abs((token.etaConfidence ?? 0) - result.confidence) >= 0.05;

      if (!changed) continue;

      await this.prisma.token.update({
        where: { id: token.id },
        data: { etaMinutes: result.minutes, etaConfidence: result.confidence },
      });

      await this.events.publish({
        name: 'ETAUpdated',
        organizationId: queue.branchId ? await this.orgIdForBranch(queue.branchId) : '',
        branchId: queue.branchId,
        queueId,
        tokenId: token.id,
        actorId: actorId ?? null,
        payload: {
          code: formatDisplayCode(queue.tokenPrefix, token.displayNumber),
          previousMinutes: previous,
          etaMinutes: result.minutes,
          confidence: result.confidence,
          delayRisk: result.delayRisk,
          position: i + 1,
          factors: result.factors,
        },
      });

      await this.maybeNotify(token, result.minutes, queue.tokenPrefix, queue.branchId);
    }
  }

  /**
   * Fires the countdown notifications from the spec once each. The unique
   * constraint on (tokenId, thresholdMinutes) is what makes "once" true even if
   * two recalculations race, rather than relying on in-memory bookkeeping.
   */
  private async maybeNotify(token: Token, etaMinutes: number, prefix: string, branchId: string) {
    const threshold = ETA_ALERT_THRESHOLDS.find(
      (t) => etaMinutes <= t && (token.etaMinutes === null || token.etaMinutes > t),
    );
    if (threshold === undefined) return;

    const code = formatDisplayCode(prefix, token.displayNumber);
    const body =
      threshold === 0
        ? `Token ${code} — it's your turn now. Please proceed.`
        : `Token ${code} — your turn is in about ${threshold} minutes.`;

    try {
      await this.prisma.notification.create({
        data: {
          tokenId: token.id,
          channel: 'PUSH',
          thresholdMinutes: threshold,
          title: 'Queue update',
          body,
        },
      });
    } catch {
      // Unique violation: this threshold already fired for this token.
      return;
    }

    this.logger.log(`[notify] ${body}`);
  }

  toSnapshot(
    token: Token & { counter?: { name: string; providerName: string | null } | null; customer?: { name: string } | null },
    prefix: string,
    index: number | null,
  ): TokenSnapshot {
    return {
      id: token.id,
      code: formatDisplayCode(prefix, token.displayNumber),
      displayNumber: token.displayNumber,
      status: token.status as TokenStatus,
      priority: token.priority as Priority,
      position: index === null ? null : index + 1,
      peopleAhead: index,
      etaMinutes: token.etaMinutes,
      etaConfidence: token.etaConfidence,
      counterId: token.counterId,
      counterName: token.counter?.name ?? null,
      providerName: token.counter?.providerName ?? null,
      customerName: token.customer?.name ?? null,
      joinedAt: token.joinedAt.toISOString(),
      calledAt: token.calledAt?.toISOString() ?? null,
      servedAt: token.servedAt?.toISOString() ?? null,
      completedAt: token.completedAt?.toISOString() ?? null,
    };
  }

  /** Position and ETA for one token, as the customer screen needs it. */
  async positionOf(token: Token): Promise<{ peopleAhead: number; recallPendingAhead: number }> {
    // Walked rather than counted. A `sortKey < mine` count is only equivalent to
    // a position when sortKeys are unique, and they are not; taking the index in
    // the canonical ordering is correct by construction and cannot drift away
    // from what the queue snapshot shows.
    const inLine = await this.prisma.token.findMany({
      where: { queueId: token.queueId, status: { in: AHEAD_STATUSES } },
      orderBy: IN_LINE_ORDER,
      select: { id: true, status: true },
    });

    const index = inLine.findIndex((t) => t.id === token.id);
    const ahead = index === -1 ? inLine : inLine.slice(0, index);

    return {
      peopleAhead: ahead.length,
      recallPendingAhead: ahead.filter((t) => t.status === 'RECALL_PENDING').length,
    };
  }

  /**
   * sortKey that places a token `positions` places behind the front of the
   * line. Used by the recall flow so a returning no-show is not sent to the
   * very back — the penalty is bounded and predictable.
   *
   * `excludeTokenId` is the token being moved. It is still in an active status
   * at this point, so counting it would let it occupy one of the slots it is
   * supposed to be dropping behind, landing it one place too far forward.
   */
  async sortKeyAfterPositions(
    queueId: string,
    positions: number,
    excludeTokenId?: string,
  ): Promise<number> {
    const ahead = await this.prisma.token.findMany({
      where: {
        queueId,
        status: { in: AHEAD_STATUSES },
        ...(excludeTokenId ? { id: { not: excludeTokenId } } : {}),
      },
      orderBy: IN_LINE_ORDER,
      take: positions + 1,
      select: { sortKey: true },
    });

    if (ahead.length === 0) return Date.now();
    if (ahead.length <= positions) return ahead[ahead.length - 1].sortKey + 1000;

    const before = ahead[positions - 1]?.sortKey ?? ahead[0].sortKey - 1000;
    const after = ahead[positions].sortKey;

    // Bisection needs a gap. When the two neighbours share a key there is none,
    // so land just past them instead: the penalty comes out a place or two
    // deeper than asked, which is the safe direction to be wrong in, and the
    // result is still a definite spot rather than a tie.
    if (before === after) return after + 1;

    return (before + after) / 2;
  }

  async create(branchId: string, dto: CreateQueueDto) {
    const displayOrder = dto.displayOrder ?? (await this.prisma.queue.count({ where: { branchId } }));
    if (dto.nextQueueId) await this.requireSiblingQueue(branchId, undefined, dto.nextQueueId);

    return this.prisma.queue.create({
      data: {
        branchId,
        name: dto.name,
        department: dto.department ?? null,
        tokenPrefix: dto.tokenPrefix ?? 'A',
        baselineServiceMinutes: dto.baselineServiceMinutes ?? 8,
        recallGraceMinutes: dto.recallGraceMinutes ?? 3,
        recallPenaltyPositions: dto.recallPenaltyPositions ?? 5,
        displayOrder,
        nextNumber: 1,
        stageType: dto.stageType ?? 'CUSTOM',
        nextQueueId: dto.nextQueueId ?? null,
        hasVisibleQueue: dto.hasVisibleQueue ?? true,
      },
    });
  }

  async update(queueId: string, dto: UpdateQueueDto) {
    if (dto.nextQueueId) {
      const queue = await this.prisma.queue.findUniqueOrThrow({
        where: { id: queueId },
        select: { branchId: true },
      });
      await this.requireSiblingQueue(queue.branchId, queueId, dto.nextQueueId);
    }
    return this.prisma.queue.update({ where: { id: queueId }, data: dto });
  }

  /**
   * A queue's next stage must be another queue in the same branch — a flow is
   * a per-location concept, so chaining across branches never makes sense —
   * and can't be itself, the trivial one-node cycle. Deeper cycles aren't
   * checked here: nothing walks this chain yet (that's Phase 6), so a longer
   * cycle is inert data today, not a bug waiting to fire.
   */
  private async requireSiblingQueue(branchId: string, queueId: string | undefined, nextQueueId: string) {
    if (nextQueueId === queueId) {
      throw new BadRequestException('A queue cannot be its own next stage');
    }
    const target = await this.prisma.queue.findUnique({
      where: { id: nextQueueId },
      select: { branchId: true },
    });
    if (!target || target.branchId !== branchId) {
      throw new BadRequestException('The next stage must be a queue in the same branch');
    }
  }

  serviceTypesFor(queueId: string) {
    return this.prisma.serviceType.findMany({ where: { queueId }, orderBy: { name: 'asc' } });
  }

  async createServiceType(queueId: string, dto: CreateServiceTypeDto) {
    return this.prisma.serviceType.create({
      data: { queueId, name: dto.name, durationMinutes: dto.durationMinutes ?? 8 },
    });
  }

  async updateServiceType(queueId: string, serviceTypeId: string, dto: UpdateServiceTypeDto) {
    await this.requireServiceTypeInQueue(queueId, serviceTypeId);
    return this.prisma.serviceType.update({ where: { id: serviceTypeId }, data: dto });
  }

  async deleteServiceType(queueId: string, serviceTypeId: string) {
    await this.requireServiceTypeInQueue(queueId, serviceTypeId);
    await this.prisma.serviceType.delete({ where: { id: serviceTypeId } });
    return { ok: true };
  }

  private async requireServiceTypeInQueue(queueId: string, serviceTypeId: string) {
    const serviceType = await this.prisma.serviceType.findUnique({
      where: { id: serviceTypeId },
      select: { queueId: true },
    });
    if (!serviceType || serviceType.queueId !== queueId) {
      throw new NotFoundException('Service type not found on this queue');
    }
  }

  /**
   * A branch manager may only manage their own branch's queues; an org admin
   * may manage any queue within their own organization. Throws NotFound rather
   * than Forbidden when the queue belongs to a different organization entirely,
   * so a guess at another tenant's id doesn't even confirm the id exists.
   */
  async requireManageAccess(queueId: string, user: JwtPayload): Promise<string> {
    const queue = await this.prisma.queue.findUnique({
      where: { id: queueId },
      select: { branchId: true },
    });
    if (!queue) throw new NotFoundException(`Queue ${queueId} not found`);

    const branch = await this.prisma.branch.findUniqueOrThrow({
      where: { id: queue.branchId },
      select: { organizationId: true },
    });
    if (branch.organizationId !== user.organizationId) {
      throw new NotFoundException(`Queue ${queueId} not found`);
    }
    if (ROLE_RANK[user.role] < ROLE_RANK.OWNER && user.branchId !== queue.branchId) {
      throw new ForbiddenException('You can only manage your own branch');
    }
    return queue.branchId;
  }

  async setStatus(queueId: string, status: 'OPEN' | 'PAUSED' | 'CLOSED', actorId?: string) {
    const queue = await this.prisma.queue.update({ where: { id: queueId }, data: { status } });
    const organizationId = await this.orgIdForBranch(queue.branchId);

    await this.events.publish({
      name: status === 'PAUSED' ? 'QueuePaused' : 'QueueResumed',
      organizationId,
      branchId: queue.branchId,
      queueId,
      actorId,
      payload: { status, queueName: queue.name },
    });

    await this.recalculate(queueId, actorId);
    return this.snapshot(queueId);
  }

  async orgIdForBranch(branchId: string): Promise<string> {
    const branch = await this.prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { organizationId: true },
    });
    return branch.organizationId;
  }

  /** Branch-level KPI cards on the dashboard. */
  async branchStats(branchId: string) {
    const since = startOfToday();
    const branch = await this.prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      include: { organization: true },
    });

    const [activeCount, todayCount, noShows, waits] = await Promise.all([
      this.prisma.token.count({ where: { branchId, status: { in: [...ACTIVE_TOKEN_STATUSES] } } }),
      this.prisma.token.count({ where: { branchId, joinedAt: { gte: since } } }),
      this.prisma.token.count({ where: { branchId, status: 'NO_SHOW', joinedAt: { gte: since } } }),
      this.prisma.token.findMany({
        where: { branchId, waitMinutes: { not: null }, joinedAt: { gte: since } },
        select: { waitMinutes: true },
      }),
    ]);

    const averageWait =
      waits.length > 0 ? waits.reduce((s, w) => s + (w.waitMinutes ?? 0), 0) / waits.length : 0;

    return {
      branchId,
      branchName: branch.name,
      organizationName: branch.organization.name,
      vertical: getVertical(branch.vertical ?? branch.organization.vertical).id,
      activeQueue: activeCount,
      averageWaitMinutes: Math.round(averageWait),
      servedToday: todayCount,
      noShowsToday: noShows,
    };
  }

  /**
   * Hourly arrivals for the timeline chart, over the twelve hours ending now.
   *
   * A rolling window rather than a fixed 8am-8pm one: branches open at
   * different times, a temple runs before dawn, and an operator looking at the
   * chart at 3am should still see the shift they just worked.
   */
  async hourlyLoad(branchId: string) {
    const windowStart = new Date();
    windowStart.setMinutes(0, 0, 0);
    windowStart.setHours(windowStart.getHours() - (HOURLY_BUCKETS - 1));

    const tokens = await this.prisma.token.findMany({
      where: { branchId, joinedAt: { gte: windowStart } },
      select: { joinedAt: true, waitMinutes: true },
    });

    const buckets = new Map<number, { arrivals: number; waitTotal: number; waitCount: number }>();
    for (const t of tokens) {
      const offset = Math.floor((t.joinedAt.getTime() - windowStart.getTime()) / 3_600_000);
      if (offset < 0 || offset >= HOURLY_BUCKETS) continue;
      const b = buckets.get(offset) ?? { arrivals: 0, waitTotal: 0, waitCount: 0 };
      b.arrivals++;
      if (t.waitMinutes !== null) {
        b.waitTotal += t.waitMinutes;
        b.waitCount++;
      }
      buckets.set(offset, b);
    }

    return Array.from({ length: HOURLY_BUCKETS }, (_, i) => {
      const hour = new Date(windowStart.getTime() + i * 3_600_000).getHours();
      const b = buckets.get(i);
      return {
        hour,
        label: `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`,
        arrivals: b?.arrivals ?? 0,
        averageWait: b && b.waitCount > 0 ? Math.round(b.waitTotal / b.waitCount) : 0,
      };
    });
  }
}

export function startOfToday(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export type TokenWithRelations = Prisma.TokenGetPayload<{
  include: { counter: true; customer: true; queue: true };
}>;

export { minutesBetween };
