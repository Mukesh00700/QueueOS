import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ROLE_RANK, type Role } from '@queueos/core';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../auth/password';
import type { JwtPayload } from '../auth/auth.service';
import type { CreateStaffDto, UpdateStaffDto } from './staff.dto';

const SAFE_SELECT = {
  id: true,
  organizationId: true,
  branchId: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
} satisfies Prisma.StaffUserSelect;

/**
 * An ADMIN may only see/manage their own branch's staff and can never create
 * or edit an account ranked at or above their own — otherwise an admin could
 * mint themselves a second OWNER account. An OWNER is exempt: they already
 * have full authority within the organization.
 */
function assertCanManage(actorRole: Role, targetRole: Role) {
  if (ROLE_RANK[actorRole] >= ROLE_RANK.OWNER) return;
  if (ROLE_RANK[targetRole] >= ROLE_RANK[actorRole]) {
    throw new ForbiddenException('You cannot manage a role equal to or higher than your own');
  }
}

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: JwtPayload) {
    const where: Prisma.StaffUserWhereInput = { organizationId: user.organizationId };
    if (ROLE_RANK[user.role] < ROLE_RANK.OWNER) where.branchId = user.branchId;
    return this.prisma.staffUser.findMany({
      where,
      select: SAFE_SELECT,
      orderBy: [{ name: 'asc' }],
    });
  }

  async create(dto: CreateStaffDto, user: JwtPayload) {
    assertCanManage(user.role, dto.role);

    const isManager = ROLE_RANK[user.role] < ROLE_RANK.OWNER;
    if (isManager && dto.branchId && dto.branchId !== user.branchId) {
      throw new ForbiddenException('You can only add staff to your own branch');
    }
    const branchId = isManager ? user.branchId : (dto.branchId ?? null);

    const passwordHash = await hashPassword(dto.password);
    try {
      return await this.prisma.staffUser.create({
        data: {
          organizationId: user.organizationId,
          branchId,
          name: dto.name,
          email: dto.email,
          passwordHash,
          role: dto.role,
        },
        select: SAFE_SELECT,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(`A staff member with email "${dto.email}" already exists`);
      }
      throw err;
    }
  }

  async update(staffId: string, dto: UpdateStaffDto, user: JwtPayload) {
    const target = await this.requireStaffInScope(staffId, user);
    assertCanManage(user.role, target.role as Role);
    if (dto.role) assertCanManage(user.role, dto.role);

    const isManager = ROLE_RANK[user.role] < ROLE_RANK.OWNER;
    if (isManager && dto.branchId !== undefined && dto.branchId !== user.branchId) {
      throw new ForbiddenException('You can only manage staff in your own branch');
    }

    return this.prisma.staffUser.update({ where: { id: staffId }, data: dto, select: SAFE_SELECT });
  }

  async resetPassword(staffId: string, password: string, user: JwtPayload) {
    const target = await this.requireStaffInScope(staffId, user);
    assertCanManage(user.role, target.role as Role);

    const passwordHash = await hashPassword(password);
    await this.prisma.staffUser.update({ where: { id: staffId }, data: { passwordHash } });
    return { ok: true };
  }

  /** Same not-found-for-both-reasons shape as the other setup services: a staff id from another org or branch reads as absent, not forbidden. */
  private async requireStaffInScope(staffId: string, user: JwtPayload) {
    const target = await this.prisma.staffUser.findUnique({ where: { id: staffId } });
    if (!target || target.organizationId !== user.organizationId) {
      throw new NotFoundException('Staff member not found');
    }
    if (ROLE_RANK[user.role] < ROLE_RANK.OWNER && target.branchId !== user.branchId) {
      throw new NotFoundException('Staff member not found');
    }
    return target;
  }
}
