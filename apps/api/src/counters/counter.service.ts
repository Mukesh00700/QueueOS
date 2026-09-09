import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ROLE_RANK } from '@queueos/core';
import type { Counter, Token } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';
import { QueueService } from '../queues/queue.service';
import { OrderService } from '../products/order.service';
import { formatDisplayCode, minutesBetween, IN_LINE_ORDER } from '../queues/queue.util';
import type { JwtPayload } from '../auth/auth.service';
import type { AddOrderItemDto, CreateCounterDto, RecordPaymentDto, UpdateCounterDto } from './counter.dto';

/**
 * Counter operations — the four buttons on the reception tablet.
 *
 * Every method here is the authoritative state transition for a token. They all
 * follow the same shape: mutate, emit the domain event, recalculate the queue.
 * Recalculating inside the transition rather than on a timer is what makes the
 * customer's phone update within a second of the button press.
 */
@Injectable()
export class CounterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBusService,
    private readonly queues: QueueService,
    private readonly orders: OrderService,
  ) {}

  async create(branchId: string, dto: CreateCounterDto) {
    if (dto.queueId) await this.requireQueueInBranch(dto.queueId, branchId);
    return this.prisma.counter.create({
      data: { branchId, queueId: dto.queueId ?? null, name: dto.name, status: 'IDLE' },
    });
  }

  /**
   * Configuration edit, not an operational action — deliberately does not go
   * through requireCounter, which demands an already-assigned queue. Setting
   * the queue for the first time is exactly one of the edits this allows.
   */
  async update(counterId: string, dto: UpdateCounterDto, user?: JwtPayload) {
    const counter = await this.prisma.counter.findUnique({ where: { id: counterId } });
    if (!counter) throw new NotFoundException('Counter not found');
    this.assertBranchAccess(counter.branchId, user);
    if (dto.queueId) await this.requireQueueInBranch(dto.queueId, counter.branchId);
    return this.prisma.counter.update({ where: { id: counterId }, data: dto });
  }

  private async requireQueueInBranch(queueId: string, branchId: string) {
    const queue = await this.prisma.queue.findUnique({ where: { id: queueId }, select: { branchId: true } });
    if (!queue || queue.branchId !== branchId) {
      throw new BadRequestException('That queue does not belong to this branch');
    }
  }

  async view(counterId: string, user?: JwtPayload) {
    const counter = await this.prisma.counter.findUnique({
      where: { id: counterId },
      include: { queue: true, branch: { include: { organization: true } } },
    });
    if (!counter) throw new NotFoundException('Counter not found');
    this.assertBranchAccess(counter.branchId, user);
    if (!counter.queueId || !counter.queue) {
      throw new BadRequestException('Counter is not assigned to a queue');
    }

    const [current, upNext, snapshot] = await Promise.all([
      this.currentToken(counterId),
      this.prisma.token.findMany({
        where: { queueId: counter.queueId, status: { in: ['WAITING', 'RECALL_PENDING'] } },
        orderBy: IN_LINE_ORDER,
        take: 5,
        include: { customer: true, counter: true },
      }),
      this.queues.snapshot(counter.queueId),
    ]);
    const order = current ? await this.orders.currentOpenOrder(current.visitId) : null;

    return {
      counter: {
        id: counter.id,
        name: counter.name,
        status: counter.status,
        providerName: counter.providerName,
      },
      queue: snapshot,
      stageType: counter.queue.stageType,
      vertical: counter.branch.vertical ?? counter.branch.organization.vertical,
      current: current
        ? this.queues.toSnapshot(current, counter.queue.tokenPrefix, null)
        : null,
      upNext: upNext.map((t, i) => this.queues.toSnapshot(t, counter.queue!.tokenPrefix, i)),
      order: order
        ? {
            id: order.id,
            subtotal: order.subtotal,
            taxAmount: order.taxAmount,
            total: order.subtotal + order.taxAmount,
            items: order.items.map((item) => ({
              id: item.id,
              productId: item.productId,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
              gstRate: item.gstRate,
            })),
          }
        : null,
    };
  }

  /**
   * Call the next person. Anything the counter was already holding is closed
   * out first — a staff member hitting NEXT twice should never orphan a token
   * in SERVING forever.
   */
  async next(counterId: string, user?: JwtPayload) {
    const counter = await this.requireCounter(counterId, user);
    const actorId = user?.sub;

    const holding = await this.currentToken(counterId);
    if (holding) {
      await this.completeToken(holding, counter, actorId, 'AUTO_ON_NEXT');
    }

    const head = await this.prisma.token.findFirst({
      where: { queueId: counter.queueId!, status: 'WAITING' },
      orderBy: IN_LINE_ORDER,
    });

    if (!head) {
      await this.prisma.counter.update({ where: { id: counterId }, data: { status: 'IDLE' } });
      await this.queues.recalculate(counter.queueId!, actorId);
      return this.view(counterId, user);
    }

    await this.assignToken(counter, head, actorId, false);
    await this.queues.recalculate(counter.queueId!, actorId);
    return this.view(counterId, user);
  }

  /**
   * Call a specific waiting token out of turn — the manager-facing escape
   * hatch for the rare case where FIFO isn't what's wanted right now. Whoever
   * the counter was already holding is closed out first, same as `next`.
   */
  async callSpecific(counterId: string, tokenId: string, user?: JwtPayload) {
    const counter = await this.requireCounter(counterId, user);
    const actorId = user?.sub;

    const holding = await this.currentToken(counterId);
    if (holding) {
      await this.completeToken(holding, counter, actorId, 'AUTO_ON_NEXT');
    }

    const target = await this.prisma.token.findFirst({
      where: { id: tokenId, queueId: counter.queueId!, status: 'WAITING' },
    });
    if (!target) {
      throw new BadRequestException('That token is not waiting in this counter’s queue');
    }

    await this.assignToken(counter, target, actorId, true);
    await this.queues.recalculate(counter.queueId!, actorId);
    return this.view(counterId, user);
  }

  /** Shared by `next` and `callSpecific`: puts a token into SERVING at this counter and emits the assignment events. */
  private async assignToken(counter: Counter, token: Token, actorId: string | undefined, direct: boolean) {
    const now = new Date();
    const queue = await this.prisma.queue.findUniqueOrThrow({ where: { id: counter.queueId! } });

    await this.prisma.token.update({
      where: { id: token.id },
      data: {
        status: 'SERVING',
        counterId: counter.id,
        calledAt: now,
        servedAt: now,
        waitMinutes: minutesBetween(token.joinedAt, now),
        recallExpiresAt: null,
      },
    });
    await this.prisma.counter.update({ where: { id: counter.id }, data: { status: 'SERVING' } });

    const organizationId = await this.queues.orgIdForBranch(counter.branchId);
    const code = formatDisplayCode(queue.tokenPrefix, token.displayNumber);
    const base = {
      organizationId,
      branchId: counter.branchId,
      queueId: counter.queueId!,
      tokenId: token.id,
      actorId: actorId ?? null,
    };

    await this.events.publish({
      ...base,
      name: 'CounterAssigned',
      payload: { code, counterName: counter.name, providerName: counter.providerName, direct },
    });
    await this.events.publish({
      ...base,
      name: 'ServiceStarted',
      payload: { code, counterName: counter.name, waitedMinutes: Math.round(minutesBetween(token.joinedAt, now)), direct },
    });
    await this.events.publish({
      ...base,
      name: 'QueueAdvanced',
      payload: { code, counterName: counter.name, direct },
    });
  }

  /**
   * Recall — the customer did not appear. Rather than voiding the token, it
   * moves to RECALL_PENDING and the customer is asked "still coming?". The
   * grace window is per-queue because a hospital corridor and a food court have
   * very different walking distances.
   */
  async recall(counterId: string, user?: JwtPayload) {
    const counter = await this.requireCounter(counterId, user);
    const actorId = user?.sub;
    const token = await this.currentToken(counterId);
    if (!token) throw new BadRequestException('No token is being served at this counter');

    const queue = await this.prisma.queue.findUniqueOrThrow({ where: { id: counter.queueId! } });
    const expiresAt = new Date(Date.now() + queue.recallGraceMinutes * 60_000);

    await this.prisma.token.update({
      where: { id: token.id },
      data: {
        status: 'RECALL_PENDING',
        recallAttempts: { increment: 1 },
        recallExpiresAt: expiresAt,
      },
    });
    await this.prisma.counter.update({ where: { id: counterId }, data: { status: 'IDLE' } });

    const organizationId = await this.queues.orgIdForBranch(counter.branchId);
    await this.events.publish({
      name: 'RecallInitiated',
      organizationId,
      branchId: counter.branchId,
      queueId: counter.queueId!,
      tokenId: token.id,
      actorId,
      payload: {
        code: formatDisplayCode(queue.tokenPrefix, token.displayNumber),
        attempt: token.recallAttempts + 1,
        graceMinutes: queue.recallGraceMinutes,
        expiresAt: expiresAt.toISOString(),
        counterName: counter.name,
      },
    });

    await this.queues.recalculate(counter.queueId!, actorId);
    return this.view(counterId, user);
  }

  /** Mark the current token a no-show and free the counter. */
  async skip(counterId: string, user?: JwtPayload) {
    const counter = await this.requireCounter(counterId, user);
    const actorId = user?.sub;
    const token = await this.currentToken(counterId);
    if (!token) throw new BadRequestException('No token is being served at this counter');

    const queue = await this.prisma.queue.findUniqueOrThrow({ where: { id: counter.queueId! } });

    await this.prisma.token.update({
      where: { id: token.id },
      data: { status: 'NO_SHOW', completedAt: new Date(), counterId: null },
    });
    await this.prisma.counter.update({ where: { id: counterId }, data: { status: 'IDLE' } });

    const organizationId = await this.queues.orgIdForBranch(counter.branchId);
    await this.events.publish({
      name: 'CustomerNoShow',
      organizationId,
      branchId: counter.branchId,
      queueId: counter.queueId!,
      tokenId: token.id,
      actorId,
      payload: {
        code: formatDisplayCode(queue.tokenPrefix, token.displayNumber),
        reason: 'SKIPPED_AT_COUNTER',
        recallAttempts: token.recallAttempts,
      },
    });

    await this.queues.recalculate(counter.queueId!, actorId);
    return this.view(counterId, user);
  }

  /**
   * A payment-stage counter can't use the plain Complete button — see
   * `recordPayment` below, which is what actually closes this stage out.
   */
  async complete(counterId: string, user?: JwtPayload) {
    const counter = await this.requireCounter(counterId, user);
    const actorId = user?.sub;
    const token = await this.currentToken(counterId);
    if (!token) throw new BadRequestException('No token is being served at this counter');

    const queue = await this.prisma.queue.findUniqueOrThrow({ where: { id: counter.queueId! } });
    if (queue.stageType === 'PAYMENT') {
      throw new BadRequestException('This is a payment stage — record a payment to complete it');
    }

    await this.completeToken(token, counter, actorId, 'COMPLETED');
    await this.queues.recalculate(counter.queueId!, actorId);
    return this.view(counterId, user);
  }

  /**
   * Add a product to the visit's cart — any stage, not just Payment; "a
   * counter already is the POS terminal." No `recalculate()` call: a cart
   * line doesn't change queue position or ETA.
   */
  async addOrderItem(counterId: string, dto: AddOrderItemDto, user?: JwtPayload) {
    const counter = await this.requireCounter(counterId, user);
    const token = await this.currentToken(counterId);
    if (!token) throw new BadRequestException('No token is being served at this counter');
    await this.orders.addItem(token.visitId, dto.productId, dto.quantity, user?.sub ?? null);
    return this.view(counterId, user);
  }

  async removeOrderItem(counterId: string, itemId: string, user?: JwtPayload) {
    await this.requireCounter(counterId, user);
    const token = await this.currentToken(counterId);
    if (!token) throw new BadRequestException('No token is being served at this counter');
    await this.orders.removeItem(token.visitId, itemId, user?.sub ?? null);
    return this.view(counterId, user);
  }

  /**
   * The payment-stage equivalent of `complete` — closing this stage out is
   * "payment recorded," not a staff button. Issues an Invoice off the
   * visit's cart (opened automatically back when service started — see
   * `OrderSessionService`) rather than always minting a fresh Order: if
   * that cart already has real items, its own subtotal is the invoice
   * total; if it's still empty (a vertical that never touches the
   * catalogue), falls back to exactly build-plan.md Phase 8's behavior —
   * one ad-hoc "Payment" line for the amount typed here. Reuses
   * `completeToken`, so the resulting `ServiceCompleted` still feeds the
   * same auto-advance mechanism from Phase 6 unchanged; `InvoiceIssued`/
   * `PaymentCompleted` are published alongside it for the commerce-side
   * consumers Phase 2+ will add.
   */
  async recordPayment(counterId: string, dto: RecordPaymentDto, user?: JwtPayload) {
    const counter = await this.requireCounter(counterId, user);
    const actorId = user?.sub;
    const token = await this.currentToken(counterId);
    if (!token) throw new BadRequestException('No token is being served at this counter');

    const queue = await this.prisma.queue.findUniqueOrThrow({ where: { id: counter.queueId! } });
    if (queue.stageType !== 'PAYMENT') {
      throw new BadRequestException('This counter is not on a payment stage');
    }

    const organizationId = await this.queues.orgIdForBranch(counter.branchId);
    const { order: openOrder } = await this.orders.openOrGetOrder(token.visitId, counter.branchId, organizationId);

    const invoice = await this.prisma.$transaction(async (tx) => {
      const orderId = openOrder.id;
      // Re-read fresh inside the transaction, not from the snapshot fetched
      // before it opened — a cart line added between that fetch and here
      // must not be silently dropped from (or missing from) the invoice.
      const fresh = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: { select: { id: true } } },
      });
      let subtotal = fresh.subtotal;
      let taxAmount = fresh.taxAmount;

      if (fresh.items.length === 0) {
        // The flat "type an amount" fallback — no product, no rate, no tax.
        await tx.orderItem.create({
          data: {
            orderId,
            description: 'Payment',
            quantity: 1,
            unitPrice: dto.amount,
            lineTotal: dto.amount,
            staffUserId: actorId ?? null,
          },
        });
        subtotal = dto.amount;
        taxAmount = 0;
      } else {
        // A real cart exists — the amount tendered must at least cover it.
        // Over-tendering (change due) is fine; silently under-recording a
        // sale is not.
        const total = subtotal + taxAmount;
        if (dto.amount < total - 0.01) {
          throw new BadRequestException(
            `Amount is less than the cart total of ${total.toFixed(2)}`,
          );
        }
      }

      await tx.order.update({ where: { id: orderId }, data: { subtotal, taxAmount, status: 'PAID' } });

      const branch = await tx.branch.update({
        where: { id: counter.branchId },
        data: { nextInvoiceNumber: { increment: 1 } },
        select: { nextInvoiceNumber: true },
      });
      const invoice = await tx.invoice.create({
        data: {
          organizationId,
          branchId: counter.branchId,
          orderId,
          number: `INV-${branch.nextInvoiceNumber - 1}`,
          subtotal,
          taxAmount,
          total: subtotal + taxAmount,
          status: 'ISSUED',
        },
      });
      await tx.payment.create({
        data: { invoiceId: invoice.id, amount: dto.amount, method: dto.method, recordedBy: actorId ?? null },
      });

      return invoice;
    });

    const base = {
      organizationId,
      branchId: counter.branchId,
      queueId: counter.queueId!,
      tokenId: token.id,
      actorId: actorId ?? null,
    };
    await this.events.publish({
      ...base,
      name: 'InvoiceIssued',
      payload: { invoiceNumber: invoice.number, subtotal: invoice.subtotal, taxAmount: invoice.taxAmount, total: invoice.total },
    });
    await this.events.publish({
      ...base,
      name: 'PaymentCompleted',
      payload: { invoiceNumber: invoice.number, amount: dto.amount, method: dto.method },
    });

    await this.completeToken(token, counter, actorId, 'PAYMENT_RECORDED', {
      amount: dto.amount,
      method: dto.method,
      invoiceNumber: invoice.number,
    });
    await this.queues.recalculate(counter.queueId!, actorId);
    return this.view(counterId, user);
  }

  async setProvider(counterId: string, providerName: string | null, user?: JwtPayload) {
    const counter = await this.requireCounter(counterId, user);
    await this.prisma.counter.update({ where: { id: counterId }, data: { providerName } });
    await this.queues.recalculate(counter.queueId!, user?.sub);
    return this.view(counterId, user);
  }

  /**
   * Opening or closing a counter is the single biggest lever on ETA — it
   * changes the divisor for the whole queue, so the recalculation that follows
   * is what produces the "wait just dropped by 6 minutes" push to everyone.
   */
  async setStatus(counterId: string, status: 'IDLE' | 'BREAK' | 'CLOSED', user?: JwtPayload) {
    const counter = await this.requireCounter(counterId, user);
    await this.prisma.counter.update({ where: { id: counterId }, data: { status } });
    await this.queues.recalculate(counter.queueId!, user?.sub);
    return this.view(counterId, user);
  }

  private async completeToken(
    token: Token,
    counter: Counter,
    actorId: string | undefined,
    reason: string,
    extraPayload?: Record<string, unknown>,
  ) {
    const now = new Date();
    const serviceMinutes = token.servedAt ? minutesBetween(token.servedAt, now) : null;

    await this.prisma.token.update({
      where: { id: token.id },
      data: { status: 'COMPLETED', completedAt: now, serviceMinutes },
    });
    await this.prisma.counter.update({ where: { id: counter.id }, data: { status: 'IDLE' } });

    const queue = await this.prisma.queue.findUniqueOrThrow({ where: { id: token.queueId } });
    const organizationId = await this.queues.orgIdForBranch(token.branchId);

    await this.events.publish({
      name: 'ServiceCompleted',
      organizationId,
      branchId: token.branchId,
      queueId: token.queueId,
      tokenId: token.id,
      actorId,
      payload: {
        code: formatDisplayCode(queue.tokenPrefix, token.displayNumber),
        counterName: counter.name,
        serviceMinutes: serviceMinutes === null ? null : Math.round(serviceMinutes * 10) / 10,
        reason,
        ...extraPayload,
      },
    });
  }

  private async currentToken(counterId: string) {
    return this.prisma.token.findFirst({
      where: { counterId, status: { in: ['SERVING', 'CALLED'] } },
      orderBy: { servedAt: 'desc' },
      include: { customer: true, counter: true },
    });
  }

  /**
   * For anyone below org-admin, confirms the counter's branch matches their
   * own — a manager or counter staff acting on a counter id from another
   * branch (guessed or pasted) gets the same "not found" as an id that does
   * not exist at all, not a permissions error that would confirm it exists.
   */
  private assertBranchAccess(counterBranchId: string, user?: JwtPayload) {
    if (user && ROLE_RANK[user.role] < ROLE_RANK.OWNER && user.branchId !== counterBranchId) {
      throw new NotFoundException('Counter not found');
    }
  }

  private async requireCounter(counterId: string, user?: JwtPayload) {
    const counter = await this.prisma.counter.findUnique({ where: { id: counterId } });
    if (!counter) throw new NotFoundException('Counter not found');
    this.assertBranchAccess(counter.branchId, user);
    if (!counter.queueId) throw new BadRequestException('Counter is not assigned to a queue');
    return counter;
  }
}
