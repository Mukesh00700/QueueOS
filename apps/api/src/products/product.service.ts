import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/auth.service';
import type { CreateProductDto, UpdateProductDto } from './product.dto';

/** The org-wide sellable catalogue — shared across every branch, like Staff. */
@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: JwtPayload) {
    return this.prisma.product.findMany({
      where: { organizationId: user.organizationId },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  create(dto: CreateProductDto, user: JwtPayload) {
    return this.prisma.product.create({
      data: {
        organizationId: user.organizationId,
        name: dto.name,
        category: dto.category,
        price: dto.price,
        hsnSac: dto.hsnSac ?? null,
        gstRate: dto.gstRate ?? 0,
        trackStock: dto.trackStock ?? false,
      },
    });
  }

  async update(productId: string, dto: UpdateProductDto, user: JwtPayload) {
    await this.requireOwnOrg(productId, user.organizationId);
    return this.prisma.product.update({ where: { id: productId }, data: dto });
  }

  /** Same not-found-for-both-reasons shape as every other setup service: another org's product id reads as absent. */
  private async requireOwnOrg(productId: string, organizationId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { organizationId: true } });
    if (!product || product.organizationId !== organizationId) {
      throw new NotFoundException('Product not found');
    }
  }
}
