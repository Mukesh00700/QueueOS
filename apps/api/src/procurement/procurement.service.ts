import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/auth.service';
import type { CreatePurchaseOrderDto, CreateSupplierDto, UpdateSupplierDto } from './procurement.dto';

/**
 * Restocking a supplier actually shipped, not just a manual count nudge —
 * that's still `ProductService.restock`, unchanged, for the casual case.
 * Receiving a PO writes `StockMovement` rows the same way a sale does, one
 * more producer into the same ledger rather than a parallel stock concept.
 */
@Injectable()
export class ProcurementService {
  constructor(private readonly prisma: PrismaService) {}

  listSuppliers(user: JwtPayload) {
    return this.prisma.supplier.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { name: 'asc' },
    });
  }

  createSupplier(dto: CreateSupplierDto, user: JwtPayload) {
    return this.prisma.supplier.create({
      data: {
        organizationId: user.organizationId,
        name: dto.name,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        notes: dto.notes ?? null,
      },
    });
  }

  async updateSupplier(supplierId: string, dto: UpdateSupplierDto, user: JwtPayload) {
    await this.requireOwnSupplier(supplierId, user.organizationId);
    return this.prisma.supplier.update({ where: { id: supplierId }, data: dto });
  }

  listPurchaseOrders(branchId: string, limit: number) {
    return this.prisma.purchaseOrder.findMany({
      where: { branchId },
      include: { supplier: { select: { name: true } }, items: { select: { lineTotal: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getPurchaseOrder(purchaseOrderId: string, user: JwtPayload) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { supplier: true, items: true },
    });
    if (!po || po.organizationId !== user.organizationId) throw new NotFoundException('Purchase order not found');
    return po;
  }

  /**
   * Line items snapshot `description`/`unitCost` from the product at
   * creation time — same reasoning as `OrderItem`: a product renamed or
   * repriced later must not rewrite a PO already placed.
   */
  async createPurchaseOrder(dto: CreatePurchaseOrderDto, user: JwtPayload) {
    await this.requireOwnBranch(dto.branchId, user.organizationId);
    await this.requireOwnSupplier(dto.supplierId, user.organizationId);

    const products = await this.prisma.product.findMany({
      where: { id: { in: dto.items.map((i) => i.productId) }, organizationId: user.organizationId },
      select: { id: true, name: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p.name]));
    if (products.length !== new Set(dto.items.map((i) => i.productId)).size) {
      throw new BadRequestException('One or more products do not belong to your organization');
    }

    return this.prisma.purchaseOrder.create({
      data: {
        organizationId: user.organizationId,
        branchId: dto.branchId,
        supplierId: dto.supplierId,
        notes: dto.notes ?? null,
        createdBy: user.sub,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            description: productMap.get(item.productId)!,
            quantity: item.quantity,
            unitCost: item.unitCost,
            lineTotal: item.quantity * item.unitCost,
          })),
        },
      },
      include: { supplier: true, items: true },
    });
  }

  /** Marks it received and pushes every line's quantity into the stock ledger — untracked products are skipped, same as a sale never touching stock for them. */
  async receivePurchaseOrder(purchaseOrderId: string, user: JwtPayload) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { items: { include: { product: { select: { trackStock: true } } } } },
    });
    if (!po || po.organizationId !== user.organizationId) throw new NotFoundException('Purchase order not found');
    if (po.status === 'RECEIVED') throw new BadRequestException('This purchase order has already been received');

    await this.prisma.$transaction([
      ...po.items
        .filter((item) => item.productId && item.product?.trackStock)
        .map((item) =>
          this.prisma.stockMovement.create({
            data: { productId: item.productId!, quantity: item.quantity, reason: 'RESTOCK' },
          }),
        ),
      this.prisma.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status: 'RECEIVED', receivedAt: new Date() },
      }),
    ]);

    return this.getPurchaseOrder(purchaseOrderId, user);
  }

  private async requireOwnSupplier(supplierId: string, organizationId: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { organizationId: true } });
    if (!supplier || supplier.organizationId !== organizationId) throw new NotFoundException('Supplier not found');
  }

  private async requireOwnBranch(branchId: string, organizationId: string) {
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId }, select: { organizationId: true } });
    if (!branch || branch.organizationId !== organizationId) {
      throw new BadRequestException('That branch does not belong to your organization');
    }
  }
}
