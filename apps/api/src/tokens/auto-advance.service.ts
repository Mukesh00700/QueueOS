import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { EventEnvelope } from '@queueos/core';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';
import { TokenService } from './token.service';

/**
 * Reacts to `ServiceCompleted` and walks the stage chain: if the completed
 * queue has a `nextQueueId`, mint the next-stage token; otherwise this was
 * the last stage, so close out the Visit. The manual transfer endpoint stays
 * the override for the exception case — this is the primary path now.
 */
@Injectable()
export class AutoAdvanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoAdvanceService.name);
  private unsubscribe?: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBusService,
    private readonly tokens: TokenService,
  ) {}

  onModuleInit() {
    this.unsubscribe = this.events.subscribe((event) => {
      if (event.name === 'ServiceCompleted') {
        this.handleServiceCompleted(event).catch((err) =>
          this.logger.error('Auto-advance failed', err as Error),
        );
      }
    });
  }

  onModuleDestroy() {
    this.unsubscribe?.();
  }

  private async handleServiceCompleted(event: EventEnvelope) {
    if (!event.queueId || !event.tokenId) return;

    const queue = await this.prisma.queue.findUnique({ where: { id: event.queueId } });
    const token = await this.prisma.token.findUnique({ where: { id: event.tokenId } });
    if (!queue || !token) return;

    if (!queue.nextQueueId) {
      await this.prisma.visit.update({
        where: { id: token.visitId },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      return;
    }

    await this.tokens.advanceStage(token, queue.nextQueueId);
  }
}
