import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';
import { QueueService } from '../queues/queue.service';
import { formatDisplayCode } from '../queues/queue.util';

/**
 * Closes out recalls nobody answered.
 *
 * Without this a RECALL_PENDING token sits at the front of the line forever,
 * inflating everyone else's ETA. The sweep runs frequently because the grace
 * window is measured in single-digit minutes.
 *
 * In the target architecture this is a BullMQ delayed job keyed on the token so
 * it fires exactly once at the right moment; polling is the version that works
 * without Redis.
 */
@Injectable()
export class RecallScheduler {
  private readonly logger = new Logger(RecallScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBusService,
    private readonly queues: QueueService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async expireRecalls() {
    const expired = await this.prisma.token.findMany({
      where: { status: 'RECALL_PENDING', recallExpiresAt: { lte: new Date() } },
      include: { queue: true },
    });
    if (expired.length === 0) return;

    const touchedQueues = new Set<string>();

    for (const token of expired) {
      await this.prisma.token.update({
        where: { id: token.id },
        data: { status: 'NO_SHOW', completedAt: new Date(), counterId: null },
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
          reason: 'RECALL_EXPIRED',
          recallAttempts: token.recallAttempts,
        },
      });

      touchedQueues.add(token.queueId);
    }

    this.logger.log(`Expired ${expired.length} unanswered recall(s)`);
    for (const queueId of touchedQueues) {
      await this.queues.recalculate(queueId);
    }
  }
}
