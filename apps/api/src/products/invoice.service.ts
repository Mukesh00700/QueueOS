import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ROLE_RANK } from '@queueos/core';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/auth.service';
import type { RefundDto } from './invoice.dto';

const LIST_SELECT = {
  id: true,
  number: true,
  subtotal: true,
  taxAmount: true,
  total: true,
  status: true,
  createdAt: true,
  payments: { select: { method: true } },
  refunds: { select: { amount: true } },
  order: { select: { visit: { select: { customer: { select: { name: true } } } } } },
} as const;

/**
 * Read side of a chain that, until now, only ever got written to —
 * `CounterService.recordPayment` issues a real numbered Invoice on every
 * sale, but nothing anywhere let a human look at one afterward.
 */
@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  async listForBranch(branchId: string, limit: number) {
    const invoices = await this.prisma.invoice.findMany({
      where: { branchId },
      select: LIST_SELECT,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return invoices.map((inv) => ({
      id: inv.id,
      number: inv.number,
      subtotal: inv.subtotal,
      taxAmount: inv.taxAmount,
      total: inv.total,
      status: inv.status,
      createdAt: inv.createdAt,
      methods: [...new Set(inv.payments.map((p) => p.method))],
      customerName: inv.order.visit.customer?.name ?? null,
      refunded: inv.refunds.reduce((sum, r) => sum + r.amount, 0),
    }));
  }

  async getById(invoiceId: string, user: JwtPayload) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        branch: { select: { name: true, organization: { select: { name: true } } } },
        payments: { orderBy: { recordedAt: 'asc' } },
        refunds: { orderBy: { recordedAt: 'asc' } },
        order: {
          include: {
            items: { orderBy: { id: 'asc' } },
            visit: { include: { customer: true } },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    await this.requireAccess(invoice.organizationId, invoice.branchId, user);
    return invoice;
  }

  /**
   * One-way — matches how a real receipt is corrected: void this one,
   * ring up a fresh sale, rather than editing a document that already
   * went out. Idempotent-safe: voiding an already-void invoice is a no-op
   * error, not a silent double-action.
   */
  async void(invoiceId: string, user: JwtPayload) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { organizationId: true, branchId: true, status: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    await this.requireAccess(invoice.organizationId, invoice.branchId, user);
    if (invoice.status === 'VOID') {
      throw new BadRequestException('This invoice is already void');
    }
    return this.prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'VOID' } });
  }

  /**
   * Partial by nature, unlike void — money going back for one item, or
   * part of the total, while the rest of the sale stays a real, valid
   * invoice. Capped at what's actually left to refund, not just the
   * invoice total, so two refunds can never together exceed what was paid.
   */
  async refund(invoiceId: string, dto: RefundDto, user: JwtPayload) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { organizationId: true, branchId: true, status: true, total: true, refunds: { select: { amount: true } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    await this.requireAccess(invoice.organizationId, invoice.branchId, user);
    if (invoice.status === 'VOID') {
      throw new BadRequestException('This invoice is void — nothing left to refund');
    }
    const alreadyRefunded = invoice.refunds.reduce((sum, r) => sum + r.amount, 0);
    const refundable = invoice.total - alreadyRefunded;
    if (dto.amount > refundable + 0.01) {
      throw new BadRequestException(`Only ₹${refundable.toFixed(2)} is left to refund on this invoice`);
    }
    return this.prisma.refund.create({
      data: {
        invoiceId,
        amount: dto.amount,
        method: dto.method,
        reason: dto.reason,
        recordedBy: user.sub,
      },
    });
  }

  /** Same shape as every other back-office read: own org, and own branch unless Owner. */
  private async requireAccess(organizationId: string, branchId: string, user: JwtPayload) {
    if (organizationId !== user.organizationId) throw new NotFoundException('Invoice not found');
    if (ROLE_RANK[user.role] < ROLE_RANK.OWNER && user.branchId !== branchId) {
      throw new NotFoundException('Invoice not found');
    }
  }
}
