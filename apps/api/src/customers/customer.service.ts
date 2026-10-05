import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Customer is org-scoped (one person can check in at several branches of
 * the same org), but every other back-office view in this app is
 * branch-scoped — so both reads here filter to "has a visit at this
 * branch" rather than exposing someone's history at a branch an Admin
 * doesn't manage.
 */
@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async listForBranch(branchId: string, limit: number) {
    const customers = await this.prisma.customer.findMany({
      where: { visits: { some: { branchId } } },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        loyaltyPoints: true,
        isSeniorCitizen: true,
        needsAssistance: true,
        visits: {
          where: { branchId },
          select: {
            createdAt: true,
            orders: { select: { invoice: { select: { total: true, status: true } } } },
          },
        },
      },
      take: limit,
    });

    return customers
      .map((c) => {
        const invoices = c.visits.flatMap((v) => v.orders.map((o) => o.invoice)).filter((inv) => inv !== null);
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          email: c.email,
          loyaltyPoints: c.loyaltyPoints,
          isSeniorCitizen: c.isSeniorCitizen,
          needsAssistance: c.needsAssistance,
          visitCount: c.visits.length,
          totalSpent: invoices.reduce((sum, inv) => sum + (inv.status === 'ISSUED' ? inv.total : 0), 0),
          lastVisitAt: c.visits.reduce((latest, v) => (v.createdAt > latest ? v.createdAt : latest), c.visits[0].createdAt),
        };
      })
      .sort((a, b) => b.lastVisitAt.getTime() - a.lastVisitAt.getTime());
  }

  /** One customer's full visit/purchase history, scoped to this one branch. */
  async getForBranch(branchId: string, customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        loyaltyPoints: true,
        isSeniorCitizen: true,
        needsAssistance: true,
        createdAt: true,
        visits: {
          where: { branchId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            createdAt: true,
            status: true,
            tokens: { select: { code: true, status: true, queue: { select: { name: true } } } },
            orders: {
              select: {
                invoice: { select: { id: true, number: true, total: true, status: true, createdAt: true } },
              },
            },
          },
        },
      },
    });
    // No visit at this branch reads the same as "not found" — matches how
    // every other branch-scoped read in this app hides out-of-scope data.
    if (!customer || customer.visits.length === 0) throw new NotFoundException('Customer not found');

    const visits = customer.visits.map((v) => ({
      id: v.id,
      createdAt: v.createdAt,
      status: v.status,
      tokens: v.tokens.map((t) => ({ code: t.code, status: t.status, queueName: t.queue.name })),
      invoices: v.orders.map((o) => o.invoice).filter((inv) => inv !== null),
    }));

    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      loyaltyPoints: customer.loyaltyPoints,
      isSeniorCitizen: customer.isSeniorCitizen,
      needsAssistance: customer.needsAssistance,
      customerSince: customer.createdAt,
      visitCount: visits.length,
      totalSpent: visits
        .flatMap((v) => v.invoices)
        .reduce((sum, inv) => sum + (inv.status === 'ISSUED' ? inv.total : 0), 0),
      visits,
    };
  }
}
