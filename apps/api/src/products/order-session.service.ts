import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { EventEnvelope } from '@queueos/core';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';
import { OrderService } from './order.service';

/**
 * Reacts to `ServiceStarted` and opens a visit's cart the moment service
 * actually begins — Chapter 12's "no New Sale button" rule: the session
 * opens because the queue event fired, not because staff clicked something.
 * Idempotent per visit (`OrderService.openOrGetOrder` only creates once,
 * regardless of how many stages' `ServiceStarted` fire afterward), so only
 * the stage that actually opens the cart publishes `PosSessionOpened`.
 */
@Injectable()
export class OrderSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderSessionService.name);
  private unsubscribe?: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBusService,
    private readonly orders: OrderService,
  ) {}

  onModuleInit() {
    this.unsubscribe = this.events.subscribe((event) => {
      if (event.name === 'ServiceStarted') {
        this.handleServiceStarted(event).catch((err) =>
          this.logger.error('Cart auto-open failed', err as Error),
        );
      }
    });
  }

  onModuleDestroy() {
    this.unsubscribe?.();
  }

  private async handleServiceStarted(event: EventEnvelope) {
    if (!event.tokenId) return;

    const token = await this.prisma.token.findUnique({ where: { id: event.tokenId } });
    if (!token) return;

    const { order, created } = await this.orders.openOrGetOrder(
      token.visitId,
      token.branchId,
      event.organizationId,
    );
    if (!created) return;

    await this.events.publish({
      name: 'PosSessionOpened',
      organizationId: event.organizationId,
      branchId: token.branchId,
      queueId: token.queueId,
      tokenId: token.id,
      actorId: event.actorId,
      payload: { orderId: order.id },
    });
  }
}
