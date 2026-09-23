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

  /** Cash in the drawer between `openedAt` and `until`: float + CASH sales − CASH refunds. */
  private async expectedCash(branchId: string, openingCash: number, openedAt: Date, until: Date) {
    const window = { gte: openedAt, lte: until };
    const [cashIn, cashOut] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { method: 'CASH', recordedAt: window, invoice: { branchId } },
        _sum: { amount: true },
      }),
      this.prisma.refund.aggregate({
        where: { method: 'CASH', recordedAt: window, invoice: { branchId } },
        _sum: { amount: true },
      }),
    ]);
    return openingCash + (cashIn._sum.amount ?? 0) - (cashOut._sum.amount ?? 0);
  }

  async current(branchId: string) {
    const shift = await this.openShift(branchId);
    if (!shift) return null;
    const expectedCash = await this.expectedCash(branchId, shift.openingCash, shift.openedAt, new Date());
    return { ...shift, expectedCash };
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
        const expectedCash = await this.expectedCash(branchId, shift.openingCash, shift.openedAt, shift.closedAt!);
        return { ...shift, expectedCash, variance: (shift.countedCash ?? 0) - expectedCash };
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
    const expectedCash = await this.expectedCash(branchId, shift.openingCash, shift.openedAt, closedAt);
    const updated = await this.prisma.shift.update({
      where: { id: shift.id },
      data: { status: 'CLOSED', countedCash: dto.countedCash, closedBy: userId ?? null, closedAt },
    });
    return { ...updated, expectedCash, variance: dto.countedCash - expectedCash };
  }
}
