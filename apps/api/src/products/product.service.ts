import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
      include: { branches: { select: { id: true, name: true } } },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * What a specific counter's catalogue looks like: active products with no
   * branch restriction (available everywhere — the default for every
   * product today), plus any restricted to this branch by name.
   */
  listForBranch(branchId: string, organizationId: string) {
    return this.prisma.product.findMany({
      where: {
        organizationId,
        active: true,
        OR: [{ branches: { none: {} } }, { branches: { some: { id: branchId } } }],
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async create(dto: CreateProductDto, user: JwtPayload) {
    if (dto.branchIds?.length) await this.requireOwnBranches(dto.branchIds, user.organizationId);
    return this.prisma.product.create({
      data: {
        organizationId: user.organizationId,
        name: dto.name,
        category: dto.category,
        price: dto.price,
        hsnSac: dto.hsnSac ?? null,
        gstRate: dto.gstRate ?? 0,
        trackStock: dto.trackStock ?? false,
        branches: dto.branchIds?.length ? { connect: dto.branchIds.map((id) => ({ id })) } : undefined,
      },
    });
  }

  async update(productId: string, dto: UpdateProductDto, user: JwtPayload) {
    await this.requireOwnOrg(productId, user.organizationId);
    const { branchIds, ...rest } = dto;
    if (branchIds) await this.requireOwnBranches(branchIds, user.organizationId);
    return this.prisma.product.update({
      where: { id: productId },
      data: {
        ...rest,
        // Undefined (key omitted) leaves assignment untouched; an explicit
        // (possibly empty) array replaces it wholesale — that's how "unassign
        // everything, back to available-everywhere" is expressed.
        ...(branchIds ? { branches: { set: branchIds.map((id) => ({ id })) } } : {}),
      },
    });
  }

  /** Same not-found-for-both-reasons shape as every other setup service: another org's product id reads as absent. */
  private async requireOwnOrg(productId: string, organizationId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { organizationId: true } });
    if (!product || product.organizationId !== organizationId) {
      throw new NotFoundException('Product not found');
    }
  }

  /** Guards against assigning a product to another organization's branch. */
  private async requireOwnBranches(branchIds: string[], organizationId: string) {
    const count = await this.prisma.branch.count({ where: { id: { in: branchIds }, organizationId } });
    if (count !== branchIds.length) {
      throw new BadRequestException('One or more branches do not belong to your organization');
    }
  }
}
