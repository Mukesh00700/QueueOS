import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ACTIVE_TOKEN_STATUSES,
  TERMINAL_TOKEN_STATUSES,
  describeEta,
  getVertical,
  type Priority,
  type TokenStatus,
} from '@queueos/core';
import type { Token } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';
import { EtaService } from '../eta/eta.service';
import { QueueService } from '../queues/queue.service';
import { formatDisplayCode, generateTokenCode, sortKeyFor } from '../queues/queue.util';
import type { JwtPayload } from '../auth/auth.service';
import type { JoinQueueDto } from './token.dto';

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBusService,
    private readonly eta: EtaService,
    private readonly queues: QueueService,
  ) {}

  async join(queueId: string, dto: JoinQueueDto, actorId?: string) {
    const queue = await this.prisma.queue.findUnique({
      where: { id: queueId },
      include: { branch: { include: { organization: true } } },
    });
    if (!queue) throw new NotFoundException('Queue not found');
    if (queue.status === 'CLOSED') {
      throw new BadRequestException('This queue is closed and is not accepting new tokens');
    }

    const organizationId = queue.branch.organizationId;

    const customer = await this.prisma.customer.upsert({
      where: { organizationId_phone: { organizationId, phone: dto.phone } },
      create: {
        organizationId,
        name: dto.name,
        phone: dto.phone,
        email: dto.email ?? null,
        isSeniorCitizen: dto.isSeniorCitizen ?? false,
        needsAssistance: dto.needsAssistance ?? false,
      },
      update: {
        name: dto.name,
        email: dto.email ?? undefined,
        isSeniorCitizen: dto.isSeniorCitizen ?? undefined,
        needsAssistance: dto.needsAssistance ?? undefined,
      },
    });

    // Accessibility signals earn a priority band automatically. The spec calls
    // for computer vision to detect this; until DRISHTI is wired in, the same
    // decision is driven by what the customer declares at check-in.
    const priority = resolvePriority(dto.priority, customer.isSeniorCitizen || customer.needsAssistance);

    const joinedAt = new Date();

    // Reserve the display number atomically so two kiosks cannot issue the
    // same number to two people.
    const updatedQueue = await this.prisma.queue.update({
      where: { id: queueId },
      data: { nextNumber: { increment: 1 } },
      select: { nextNumber: true, tokenPrefix: true },
    });
    const displayNumber = updatedQueue.nextNumber - 1;
    const source = dto.source ?? 'WEB';
    const vertical = getVertical(queue.branch.vertical ?? queue.branch.organization.vertical).id;

    // One visit per token today — see queue-flow-design.md §6. This is the
    // backbone a customer's stage-tokens will hang off once a branch has more
    // than one stage; until then it's just the join-time record of "this
    // occasion," created and never otherwise touched.
    const visit = await this.prisma.visit.create({
      data: { organizationId, branchId: queue.branchId, customerId: customer.id, source, vertical },
    });

    const token = await this.prisma.token.create({
      data: {
        branchId: queue.branchId,
        queueId,
        visitId: visit.id,
        customerId: customer.id,
        serviceTypeId: dto.serviceTypeId ?? null,
        code: generateTokenCode(),
        displayNumber,
        status: 'WAITING',
        priority,
        source,
        sortKey: sortKeyFor(joinedAt, priority),
        joinedAt,
        notes: dto.notes ?? null,
      },
    });

    const base = {
      organizationId,
      branchId: queue.branchId,
      queueId,
      tokenId: token.id,
      actorId: actorId ?? null,
    };
    const code = formatDisplayCode(updatedQueue.tokenPrefix, displayNumber);

    await this.events.publish({
      ...base,
      name: 'TokenCreated',
      payload: { code, priority, source: token.source },
    });
    await this.events.publish({
      ...base,
      name: 'CustomerCheckedIn',
      payload: { code, customerName: customer.name, source: token.source },
    });
    await this.events.publish({
      ...base,
      name: 'QueueJoined',
      payload: { code, queueName: queue.name },
    });

    await this.queues.recalculate(queueId, actorId);

    return this.statusByCode(token.code);
  }

  /**
   * The customer-facing view. Keyed by the unguessable public code rather than
   * the internal id, and deliberately returns only this customer's own data.
   */
  async statusByCode(code: string) {
    const token = await this.prisma.token.findUnique({
      where: { code },
      include: {
        counter: true,
        customer: true,
        queue: { include: { branch: { include: { organization: true } } } },
      },
    });
    if (!token) throw new NotFoundException('Token not found');

    const queue = token.queue;
    const vertical = getVertical(queue.branch.vertical ?? queue.branch.organization.vertical);

    const { peopleAhead, recallPendingAhead } = await this.queues.positionOf(token);
    const ctx = await this.eta.buildContext(queue.id);
    const estimate = this.eta.estimate(ctx, peopleAhead, recallPendingAhead);

    const isTerminal = TERMINAL_TOKEN_STATUSES.includes(token.status as never);

    const nowServing = await this.prisma.token.findFirst({
      where: { queueId: queue.id, status: { in: ['SERVING', 'CALLED'] } },
      orderBy: { calledAt: 'desc' },
      include: { counter: true },
    });

    return {
      code: token.code,
      displayCode: formatDisplayCode(queue.tokenPrefix, token.displayNumber),
      displayNumber: token.displayNumber,
      status: token.status,
      priority: token.priority,
      peopleAhead: isTerminal ? 0 : peopleAhead,
      position: isTerminal ? null : peopleAhead + 1,
      eta: isTerminal
        ? null
        : {
            minutes: estimate.minutes,
            confidence: estimate.confidence,
            rangeMinutes: estimate.rangeMinutes,
            delayRisk: estimate.delayRisk,
            factors: estimate.factors,
            message: describeEta(estimate, vertical.terminology.visit.toLowerCase()),
          },
      counterName: token.counter?.name ?? null,
      providerName: token.counter?.providerName ?? null,
      recallExpiresAt: token.recallExpiresAt?.toISOString() ?? null,
      recallAttempts: token.recallAttempts,
      customerName: token.customer?.name ?? null,
      joinedAt: token.joinedAt.toISOString(),
      calledAt: token.calledAt?.toISOString() ?? null,
      completedAt: token.completedAt?.toISOString() ?? null,
      queue: {
        id: queue.id,
        name: queue.name,
        department: queue.department,
        status: queue.status,
      },
      branch: {
        id: queue.branch.id,
        name: queue.branch.name,
        organizationName: queue.branch.organization.name,
      },
      vertical: vertical.id,
      nowServing: nowServing
        ? {
            displayCode: formatDisplayCode(queue.tokenPrefix, nowServing.displayNumber),
            counterName: nowServing.counter?.name ?? null,
          }
        : null,
    };
  }

  /**
   * Smart recall confirmation — the "Still coming?" YES branch.
   *
   * The customer keeps their place instead of being cancelled, but drops a
   * bounded number of positions so the people who were on time are not
   * penalised. This is the single highest-leverage behaviour in the product:
   * it converts a no-show into a served visit.
   */
  async confirmRecall(code: string) {
    const token = await this.prisma.token.findUnique({
      where: { code },
      include: { queue: true },
    });
    if (!token) throw new NotFoundException('Token not found');
    if (token.status !== 'RECALL_PENDING') {
      throw new BadRequestException('This token is not awaiting a recall response');
    }

    const newSortKey = await this.queues.sortKeyAfterPositions(
      token.queueId,
      token.queue.recallPenaltyPositions,
      token.id,
    );

    await this.prisma.token.update({
      where: { id: token.id },
      data: {
        status: 'WAITING',
        sortKey: newSortKey,
        counterId: null,
        calledAt: null,
        recallExpiresAt: null,
      },
    });

    const organizationId = await this.queues.orgIdForBranch(token.branchId);
    await this.events.publish({
      name: 'RecallConfirmed',
      organizationId,
      branchId: token.branchId,
      queueId: token.queueId,
      tokenId: token.id,
      payload: {
        code: formatDisplayCode(token.queue.tokenPrefix, token.displayNumber),
        positionsDropped: token.queue.recallPenaltyPositions,
      },
    });

    await this.queues.recalculate(token.queueId);
    return this.statusByCode(code);
  }

  /** The "Still coming?" NO branch, and the customer-initiated leave action. */
  async cancel(code: string) {
    const token = await this.prisma.token.findUnique({ where: { code }, include: { queue: true } });
    if (!token) throw new NotFoundException('Token not found');
    if (TERMINAL_TOKEN_STATUSES.includes(token.status as never)) {
      throw new BadRequestException('This token has already been closed');
    }

    await this.prisma.token.update({
      where: { id: token.id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });

    const organizationId = await this.queues.orgIdForBranch(token.branchId);
    await this.events.publish({
      name: 'CustomerNoShow',
      organizationId,
      branchId: token.branchId,
      queueId: token.queueId,
      tokenId: token.id,
      payload: {
        code: formatDisplayCode(token.queue.tokenPrefix, token.displayNumber),
        reason: 'CUSTOMER_CANCELLED',
      },
    });

    await this.queues.recalculate(token.queueId);
    return this.statusByCode(code);
  }

  /**
   * Move a waiting or recalled token to a different queue in the same branch.
   * The original `joinedAt` is preserved when recomputing the sort key so a
   * customer who already waited twenty minutes doesn't get sent to the back
   * of the new line — the wait credit travels with them, per Chapter 10's
   * "context and wait credit travel" convention.
   */
  async transfer(tokenId: string, targetQueueId: string, user: JwtPayload) {
    const token = await this.prisma.token.findUnique({ where: { id: tokenId }, include: { queue: true } });
    if (!token) throw new NotFoundException('Token not found');
    if (token.status !== 'WAITING' && token.status !== 'RECALL_PENDING') {
      throw new BadRequestException('Only a waiting or recalled token can be transferred');
    }
    if (targetQueueId === token.queueId) {
      throw new BadRequestException('Token is already in that queue');
    }

    await this.queues.requireManageAccess(token.queueId, user);
    await this.queues.requireManageAccess(targetQueueId, user);

    const targetQueue = await this.prisma.queue.findUniqueOrThrow({ where: { id: targetQueueId } });
    if (targetQueue.branchId !== token.branchId) {
      throw new BadRequestException('Can only transfer within the same branch');
    }

    const sourceQueueId = token.queueId;
    const newSortKey = sortKeyFor(token.joinedAt, token.priority as Priority);

    await this.prisma.token.update({
      where: { id: tokenId },
      data: {
        queueId: targetQueueId,
        counterId: null,
        status: 'WAITING',
        sortKey: newSortKey,
        recallExpiresAt: null,
      },
    });

    const organizationId = await this.queues.orgIdForBranch(token.branchId);
    await this.events.publish({
      name: 'TokenTransferred',
      organizationId,
      branchId: token.branchId,
      queueId: targetQueueId,
      tokenId,
      actorId: user.sub,
      payload: {
        code: formatDisplayCode(token.queue.tokenPrefix, token.displayNumber),
        fromQueueId: sourceQueueId,
        fromQueueName: token.queue.name,
        toQueueId: targetQueueId,
        toQueueName: targetQueue.name,
      },
    });

    await this.queues.recalculate(sourceQueueId, user.sub);
    await this.queues.recalculate(targetQueueId, user.sub);

    return this.statusByCode(token.code);
  }

  /**
   * Override the priority band on an active token. Always requires a reason,
   * which is not stored on the token itself — it lives in the QueueEvent
   * payload, the same audit trail every other override in this system uses.
   */
  async changePriority(tokenId: string, priority: Priority, reason: string, user: JwtPayload) {
    const token = await this.prisma.token.findUnique({ where: { id: tokenId }, include: { queue: true } });
    if (!token) throw new NotFoundException('Token not found');
    if (!ACTIVE_TOKEN_STATUSES.includes(token.status as TokenStatus)) {
      throw new BadRequestException('Only an active token can have its priority changed');
    }

    await this.queues.requireManageAccess(token.queueId, user);

    const previousPriority = token.priority;
    const newSortKey = sortKeyFor(token.joinedAt, priority);

    await this.prisma.token.update({
      where: { id: tokenId },
      data: { priority, sortKey: newSortKey },
    });

    const organizationId = await this.queues.orgIdForBranch(token.branchId);
    await this.events.publish({
      name: 'PriorityChanged',
      organizationId,
      branchId: token.branchId,
      queueId: token.queueId,
      tokenId,
      actorId: user.sub,
      payload: {
        code: formatDisplayCode(token.queue.tokenPrefix, token.displayNumber),
        previousPriority,
        priority,
        reason,
      },
    });

    await this.queues.recalculate(token.queueId, user.sub);
    return this.statusByCode(token.code);
  }

  /**
   * Auto-advance: called by AutoAdvanceService when a completed token's queue
   * has a configured `nextQueueId`. Mints the next-stage token for the same
   * Visit, carrying the *original* `joinedAt` forward — the same wait-credit
   * formula `transfer()` uses, so a customer who already waited through
   * stage 1 doesn't start over at the back of stage 2.
   */
  async advanceStage(completedToken: Token, nextQueueId: string) {
    const nextQueue = await this.prisma.queue.findUniqueOrThrow({ where: { id: nextQueueId } });

    const updatedQueue = await this.prisma.queue.update({
      where: { id: nextQueueId },
      data: { nextNumber: { increment: 1 } },
      select: { nextNumber: true, tokenPrefix: true },
    });
    const displayNumber = updatedQueue.nextNumber - 1;

    const token = await this.prisma.token.create({
      data: {
        branchId: completedToken.branchId,
        queueId: nextQueueId,
        visitId: completedToken.visitId,
        customerId: completedToken.customerId,
        code: generateTokenCode(),
        displayNumber,
        status: 'WAITING',
        priority: completedToken.priority,
        source: completedToken.source,
        sortKey: sortKeyFor(completedToken.joinedAt, completedToken.priority as Priority),
        joinedAt: completedToken.joinedAt,
      },
    });

    const organizationId = await this.queues.orgIdForBranch(completedToken.branchId);
    await this.events.publish({
      organizationId,
      branchId: completedToken.branchId,
      queueId: nextQueueId,
      tokenId: token.id,
      name: 'QueueJoined',
      payload: {
        code: formatDisplayCode(updatedQueue.tokenPrefix, displayNumber),
        queueName: nextQueue.name,
        autoAdvancedFrom: completedToken.queueId,
      },
    });

    await this.queues.recalculate(nextQueueId);
    return token;
  }

  async submitFeedback(code: string, rating: number, comment?: string) {
    const token = await this.prisma.token.findUnique({ where: { code }, include: { queue: true } });
    if (!token) throw new NotFoundException('Token not found');

    await this.prisma.feedback.upsert({
      where: { tokenId: token.id },
      create: { tokenId: token.id, rating, comment: comment ?? null },
      update: { rating, comment: comment ?? null },
    });

    const organizationId = await this.queues.orgIdForBranch(token.branchId);
    await this.events.publish({
      name: 'FeedbackSubmitted',
      organizationId,
      branchId: token.branchId,
      queueId: token.queueId,
      tokenId: token.id,
      payload: { rating, code: formatDisplayCode(token.queue.tokenPrefix, token.displayNumber) },
    });

    return { ok: true };
  }

  async notifications(code: string) {
    const token = await this.prisma.token.findUnique({ where: { code }, select: { id: true } });
    if (!token) throw new NotFoundException('Token not found');
    return this.prisma.notification.findMany({
      where: { tokenId: token.id },
      orderBy: { sentAt: 'desc' },
    });
  }
}

function resolvePriority(requested: Priority | undefined, needsSupport: boolean): Priority {
  const base = requested ?? 'NORMAL';
  if (base === 'NORMAL' && needsSupport) return 'PRIORITY';
  return base;
}
