import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';

const WITH_ITEMS = { items: true } as const;

/**
 * The Order-as-cart: what a visit is buying, built up line by line as it
 * moves through its stages. See build-plan.md Phase 8 for how this started
 * (one flat amount at the Payment stage) and plan.md Phase 1a/1b for how it
 * grew into a real cart.
 */
@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBusService,
  ) {}

  currentOpenOrder(visitId: string) {
    return this.prisma.order.findFirst({ where: { visitId, status: 'OPEN' }, include: WITH_ITEMS });
  }

  /**
   * Idempotent per visit, not per stage — a QSR visit's `ServiceStarted`
   * fires at Ordering, then again at Payment, then again at Pickup; only the
   * first of those should open a cart, the rest just find it. Returns
   * `created: false` for a session-open reactor to skip publishing a
   * duplicate `PosSessionOpened`.
   */
  async openOrGetOrder(visitId: string, branchId: string, organizationId: string) {
    const existing = await this.currentOpenOrder(visitId);
    if (existing) return { order: existing, created: false };

    const order = await this.prisma.order.create({
      data: { organizationId, branchId, visitId, subtotal: 0, status: 'OPEN' },
      include: WITH_ITEMS,
    });
    return { order, created: true };
  }

  /**
   * Adds (or, for a product already in the cart, increments) a line.
   * `productId` is always resolved server-side for its name/price — a
   * counter action never trusts a client-supplied price. The upsert on
   * `(orderId, productId)` makes "add this product again" atomic — two
   * rapid taps can never create two rows for the same product.
   */
  async addItem(visitId: string, productId: string, quantity: number, actorId: string | null) {
    const order = await this.currentOpenOrder(visitId);
    if (!order) throw new NotFoundException('No open order for this visit');

    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || !product.active || product.organizationId !== order.organizationId) {
      throw new NotFoundException('Product not found');
    }

    await this.prisma.orderItem.upsert({
      where: { orderId_productId: { orderId: order.id, productId } },
      create: {
        orderId: order.id,
        productId: product.id,
        description: product.name,
        quantity,
        unitPrice: product.price,
        lineTotal: product.price * quantity,
        // Snapshotted at add-time — see the schema comment on this column.
        gstRate: product.gstRate,
        staffUserId: actorId,
      },
      update: {
        quantity: { increment: quantity },
        lineTotal: { increment: product.price * quantity },
      },
    });

    const updated = await this.recomputeTotals(order.id);

    await this.events.publish({
      name: 'OrderLineAdded',
      organizationId: order.organizationId,
      branchId: order.branchId,
      actorId,
      payload: { productName: product.name, quantity, unitPrice: product.price },
    });

    return updated;
  }

  async removeItem(visitId: string, itemId: string, actorId: string | null) {
    const order = await this.currentOpenOrder(visitId);
    if (!order) throw new NotFoundException('No open order for this visit');

    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Line item not found');

    await this.prisma.orderItem.delete({ where: { id: itemId } });
    return this.recomputeTotals(order.id);
  }

  private async recomputeTotals(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: WITH_ITEMS });
    const subtotal = order.items.reduce((sum, item) => sum + item.lineTotal, 0);
    const taxAmount = order.items.reduce((sum, item) => sum + (item.lineTotal * item.gstRate) / 100, 0);
    return this.prisma.order.update({
      where: { id: orderId },
      data: { subtotal, taxAmount },
      include: WITH_ITEMS,
    });
  }
}
