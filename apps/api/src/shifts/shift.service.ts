import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CloseShiftDto, OpenShiftDto } from './shift.dto';

/**
 * The branch's cash drawer, open to close. `expectedCash` is computed on
 * read from Payment/Refund, never stored — see the schema comment on Shift
 * for why that's safe here (those rows are never edited after creation).
 */
@Injectable()
export class ShiftService {
  constructor(private readonly prisma: PrismaService) {}

  private async openShift(branchId: string) {
    return this.prisma.shift.findFirst({ where: { branchId, status: 'OPEN' } });
  }

  /**
   * Net sales by payment method between `openedAt` and `until` (payments
   * minus refunds, per method) — one pass covers both the cash drawer's
   * `expectedCash` and the non-cash breakdown (card/UPI/wallet have no
   * physical drawer to reconcile against, but staff still want to see
   * "how much went out on each rail" without digging through invoices).
   */
  private async salesByMethod(branchId: string, openedAt: Date, until: Date) {
    const window = { gte: openedAt, lte: until };
    const [paid, refunded] = await Promise.all([
      this.prisma.payment.groupBy({
        by: ['method'],
        where: { recordedAt: window, invoice: { branchId } },
        _sum: { amount: true },
      }),
      this.prisma.refund.groupBy({
        by: ['method'],
        where: { recordedAt: window, invoice: { branchId } },
        _sum: { amount: true },
      }),
    ]);
    const net: Record<string, number> = {};
    for (const row of paid) net[row.method] = (net[row.method] ?? 0) + (row._sum.amount ?? 0);
    for (const row of refunded) net[row.method] = (net[row.method] ?? 0) - (row._sum.amount ?? 0);
    return net;
  }

  async current(branchId: string) {
    const shift = await this.openShift(branchId);
    if (!shift) return null;
    const sales = await this.salesByMethod(branchId, shift.openedAt, new Date());
    const { CASH: cash = 0, ...nonCash } = sales;
    return { ...shift, expectedCash: shift.openingCash + cash, nonCash };
  }

  async history(branchId: string, limit: number) {
    const shifts = await this.prisma.shift.findMany({
      where: { branchId, status: 'CLOSED' },
      orderBy: { closedAt: 'desc' },
      take: limit,
    });
    // One window query per shift — closedAt is fixed once set, so this is
    // just as correct as a stored figure would be, without another column.
    return Promise.all(
      shifts.map(async (shift) => {
        const sales = await this.salesByMethod(branchId, shift.openedAt, shift.closedAt!);
        const { CASH: cash = 0, ...nonCash } = sales;
        const expectedCash = shift.openingCash + cash;
        return { ...shift, expectedCash, nonCash, variance: (shift.countedCash ?? 0) - expectedCash };
      }),
    );
  }

  async open(branchId: string, organizationId: string, dto: OpenShiftDto, userId: string | undefined) {
    const existing = await this.openShift(branchId);
    if (existing) throw new BadRequestException('A shift is already open for this branch');
    return this.prisma.shift.create({
      data: { organizationId, branchId, openingCash: dto.openingCash, openedBy: userId ?? null },
    });
  }

  async close(branchId: string, dto: CloseShiftDto, userId: string | undefined) {
    const shift = await this.openShift(branchId);
    if (!shift) throw new NotFoundException('No shift is currently open for this branch');
    const closedAt = new Date();
    const sales = await this.salesByMethod(branchId, shift.openedAt, closedAt);
    const { CASH: cash = 0, ...nonCash } = sales;
    const expectedCash = shift.openingCash + cash;
    const updated = await this.prisma.shift.update({
      where: { id: shift.id },
      data: { status: 'CLOSED', countedCash: dto.countedCash, closedBy: userId ?? null, closedAt },
    });
    return { ...updated, expectedCash, nonCash, variance: dto.countedCash - expectedCash };
  }
}
