import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ROLE_RANK } from '@queueos/core';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';
import type { JwtPayload } from '../auth/auth.service';

const WITH_ITEMS = { items: true } as const;

/** ₹1 off the bill per point redeemed. */
export const LOYALTY_POINT_VALUE = 1;
/** ₹ actually paid per point earned — see CounterService.recordPayment. */
export const LOYALTY_EARN_RATE = 10;

/**
 * How many points are "behind" an order's current discount, if any — 0 for
 * a manual discount or no discount at all. Detected by the reason string
 * redeemLoyaltyPoints always writes; no separate `discountSource` column,
 * since this app is the only writer of that exact prefix.
 */
function pointsBehind(order: { discountType: string | null; discountReason: string | null; discountValue: number }): number {
  if (order.discountType !== 'FLAT' || !order.discountReason?.startsWith('Loyalty redemption')) return 0;
  return Math.round(order.discountValue / LOYALTY_POINT_VALUE);
}

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

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { branches: { select: { id: true } } },
    });
    if (!product || !product.active || product.organizationId !== order.organizationId) {
      throw new NotFoundException('Product not found');
    }
    // Empty branches list = available everywhere; otherwise this branch must be in it.
    if (product.branches.length > 0 && !product.branches.some((b) => b.id === order.branchId)) {
      throw new BadRequestException('This product is not available at this branch');
    }

    await this.prisma.$transaction(async (tx) => {
      // Checked and decremented inside the same transaction as the upsert —
      // two rapid taps racing each other must never both pass the check and
      // together oversell past zero.
      if (product.trackStock) {
        const { _sum } = await tx.stockMovement.aggregate({ where: { productId }, _sum: { quantity: true } });
        const available = _sum.quantity ?? 0;
        if (available < quantity) {
          throw new BadRequestException(
            available <= 0 ? `${product.name} is out of stock` : `Only ${available} left of ${product.name}`,
          );
        }
      }

      const item = await tx.orderItem.upsert({
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

      if (product.trackStock) {
        await tx.stockMovement.create({
          data: { productId, orderItemId: item.id, quantity: -quantity, reason: 'SALE' },
        });
      }
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

  /**
   * FLAT is a rupee amount off the bill, PERCENT a share of it — either way
   * it's stored as the rule (type + value), not just the resulting rupee
   * figure, so it stays correct as the cart keeps changing (recomputed
   * alongside subtotal/taxAmount on every mutation, same as those already
   * are). Applied to the post-tax total rather than reworked into each
   * line's GST — simpler, and matches how a till coupon is usually rung up
   * ("10% off the bill"), not a rate change on every item.
   */
  async applyDiscount(visitId: string, type: 'FLAT' | 'PERCENT', value: number, reason: string) {
    const order = await this.currentOpenOrder(visitId);
    if (!order) throw new NotFoundException('No open order for this visit');

    // Same reasoning as removeDiscount: overwriting an active loyalty
    // redemption must refund the points it already spent, not just
    // silently drop them. The counter UI never lets both happen (it hides
    // "Add discount" while a discount is already active), but the service
    // layer shouldn't depend on the UI to hold that invariant.
    const redeemedPoints = pointsBehind(order);
    await this.prisma.$transaction(async (tx) => {
      if (redeemedPoints > 0) {
        const visit = await tx.visit.findUniqueOrThrow({ where: { id: visitId }, select: { customerId: true } });
        if (visit.customerId) {
          await tx.customer.update({ where: { id: visit.customerId }, data: { loyaltyPoints: { increment: redeemedPoints } } });
        }
      }
      await tx.order.update({
        where: { id: order.id },
        data: { discountType: type, discountValue: value, discountReason: reason },
      });
    });

    return this.recomputeTotals(order.id);
  }

  async removeDiscount(visitId: string) {
    const order = await this.currentOpenOrder(visitId);
    if (!order) throw new NotFoundException('No open order for this visit');

    // Clearing a manual discount destroys nothing — it was free to apply.
    // Clearing a loyalty redemption is different: real points were already
    // spent for it, so removing it refunds them rather than losing them.
    const redeemedPoints = pointsBehind(order);
    await this.prisma.$transaction(async (tx) => {
      if (redeemedPoints > 0) {
        const visit = await tx.visit.findUniqueOrThrow({ where: { id: visitId }, select: { customerId: true } });
        if (visit.customerId) {
          await tx.customer.update({ where: { id: visit.customerId }, data: { loyaltyPoints: { increment: redeemedPoints } } });
        }
      }
      await tx.order.update({
        where: { id: order.id },
        data: { discountType: null, discountValue: 0, discountReason: null },
      });
    });

    return this.recomputeTotals(order.id);
  }

  /**
   * A redemption IS a discount — a FLAT one, worth `points *
   * LOYALTY_POINT_VALUE`, applied through the exact same slot a manual
   * discount uses (so it replaces one if there was one, same "one active
   * rule at a time" rule). No separate ledger table: the points spent are
   * just decremented off `Customer.loyaltyPoints` in the same transaction
   * that applies the discount, so the two can never drift apart. Capped at
   * both what the customer actually has and what the bill can absorb — a
   * point that wouldn't have moved the total isn't spent.
   */
  async redeemLoyaltyPoints(visitId: string, requestedPoints: number) {
    const order = await this.currentOpenOrder(visitId);
    if (!order) throw new NotFoundException('No open order for this visit');
    if (requestedPoints <= 0) throw new BadRequestException('Enter how many points to redeem');

    const visit = await this.prisma.visit.findUniqueOrThrow({ where: { id: visitId }, select: { customerId: true } });
    if (!visit.customerId) throw new BadRequestException('This visit has no customer to redeem points for');

    // A second redemption call on the same order adds to the first rather
    // than replacing it — unlike a manual discount (free to reapply), each
    // call here has already spent real points, so overwriting the slot
    // would silently burn that first call's balance for nothing.
    const alreadyRedeemedPoints = pointsBehind(order);
    const billTotal = order.subtotal + order.taxAmount;
    const maxRedeemable = Math.max(0, Math.ceil(billTotal / LOYALTY_POINT_VALUE) - alreadyRedeemedPoints);

    await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: visit.customerId! } });
      const points = Math.min(requestedPoints, customer.loyaltyPoints, maxRedeemable);
      if (points <= 0) {
        throw new BadRequestException(
          customer.loyaltyPoints <= 0 ? 'This customer has no loyalty points to redeem' : 'Nothing left on this bill to redeem points against',
        );
      }
      const totalPoints = alreadyRedeemedPoints + points;
      await tx.customer.update({ where: { id: customer.id }, data: { loyaltyPoints: { decrement: points } } });
      await tx.order.update({
        where: { id: order.id },
        data: {
          discountType: 'FLAT',
          discountValue: totalPoints * LOYALTY_POINT_VALUE,
          discountReason: `Loyalty redemption (${totalPoints} pts)`,
        },
      });
    });

    return this.recomputeTotals(order.id);
  }

  async removeItem(visitId: string, itemId: string, actorId: string | null) {
    const order = await this.currentOpenOrder(visitId);
    if (!order) throw new NotFoundException('No open order for this visit');

    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Line item not found');

    // The line never happened from a stock perspective — deleting its
    // movements (rather than writing a compensating positive one) restores
    // availability with no half-committed trace left in the ledger.
    await this.prisma.$transaction([
      this.prisma.stockMovement.deleteMany({ where: { orderItemId: itemId } }),
      this.prisma.orderItem.delete({ where: { id: itemId } }),
    ]);
    return this.recomputeTotals(order.id);
  }

  /**
   * Every ticket still in prep at this branch, oldest first — a ticket
   * clears itself once every item on it reaches READY, so nothing here ever
   * needs an explicit "bump" action.
   */
  async kitchenBoard(branchId: string, user: JwtPayload) {
    this.requireBranchAccess(branchId, user);
    const orders = await this.prisma.order.findMany({
      where: { branchId, items: { some: { kitchenStatus: { not: 'READY' } } } },
      include: {
        items: { orderBy: { id: 'asc' } },
        visit: { include: { customer: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return orders.map((order) => ({
      id: order.id,
      createdAt: order.createdAt,
      customerName: order.visit.customer?.name ?? null,
      items: order.items.map((item) => ({
        id: item.id,
        description: item.description,
        quantity: item.quantity,
        kitchenStatus: item.kitchenStatus,
      })),
    }));
  }

  async setItemKitchenStatus(itemId: string, status: string, user: JwtPayload) {
    const item = await this.prisma.orderItem.findUnique({
      where: { id: itemId },
      select: { description: true, order: { select: { branchId: true, organizationId: true } } },
    });
    if (!item) throw new NotFoundException('Line item not found');
    this.requireBranchAccess(item.order.branchId, user);
    const updated = await this.prisma.orderItem.update({ where: { id: itemId }, data: { kitchenStatus: status } });
    // Lets a second kitchen screen (an expo station, say) pick up the change
    // instantly instead of waiting on useLive's 30s poll fallback.
    await this.events.publish({
      name: 'KitchenItemUpdated',
      organizationId: item.order.organizationId,
      branchId: item.order.branchId,
      actorId: user.sub,
      payload: { itemId, description: item.description, status },
    });
    return updated;
  }

  /** Same "own branch unless Owner+" scope every floor screen already enforces. */
  private requireBranchAccess(branchId: string, user: JwtPayload) {
    if (ROLE_RANK[user.role] < ROLE_RANK.OWNER && user.branchId !== branchId) {
      throw new NotFoundException('Branch not found');
    }
  }

  private async recomputeTotals(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: WITH_ITEMS });
    const subtotal = order.items.reduce((sum, item) => sum + item.lineTotal, 0);
    const taxAmount = order.items.reduce((sum, item) => sum + (item.lineTotal * item.gstRate) / 100, 0);
    const billTotal = subtotal + taxAmount;
    const rawDiscount =
      order.discountType === 'PERCENT'
        ? billTotal * (order.discountValue / 100)
        : order.discountType === 'FLAT'
          ? order.discountValue
          : 0;
    const discountAmount = Math.min(rawDiscount, billTotal);
    return this.prisma.order.update({
      where: { id: orderId },
      data: { subtotal, taxAmount, discountAmount },
      include: WITH_ITEMS,
    });
  }
}
