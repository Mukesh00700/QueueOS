import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import type { Role } from '@queueos/core';
import { PrismaService } from '../prisma/prisma.service';
import { provisionFlow } from '../queues/flow-provisioning';
import { hashPassword, verifyPassword } from './password';
import type { RegisterDto } from './auth.dto';

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string;
  branchId: string | null;
}

interface StaffLike {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
  branchId: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.staffUser.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    // Same error and roughly the same work either way, so the response does not
    // reveal whether an address is registered.
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.issueSession(user);
  }

  /**
   * Self-service sign-up: creates the Organization, its first Branch (named
   * "Main Branch" — the owner can rename or add more from /setup/branches),
   * that branch's flow (per `dto.flowTemplate`, defaulting to a single
   * queue), and the OWNER account, all in one transaction. Auto-logs in on
   * success, same response shape as `login`.
   */
  async register(dto: RegisterDto) {
    const passwordHash = await hashPassword(dto.password);
    const slug = await this.uniqueSlug(dto.businessName);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: { name: dto.businessName, slug, vertical: dto.vertical },
        });
        const branch = await tx.branch.create({
          data: {
            organizationId: org.id,
            name: 'Main Branch',
            code: 'MAIN',
            vertical: dto.vertical,
          },
        });
        await provisionFlow(tx, branch.id, dto.flowTemplate ?? 'single');
        return tx.staffUser.create({
          data: {
            organizationId: org.id,
            branchId: branch.id,
            name: dto.ownerName,
            email: dto.email,
            passwordHash,
            role: 'OWNER',
          },
        });
      });

      return this.issueSession(user);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(`An account with email "${dto.email}" already exists`);
      }
      throw err;
    }
  }

  async verify(token: string): Promise<JwtPayload> {
    try {
      return await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Session expired, please sign in again');
    }
  }

  private async issueSession(user: StaffLike) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      organizationId: user.organizationId,
      branchId: user.branchId,
    };

    return { accessToken: await this.jwt.signAsync(payload), user: payload };
  }

  /** `Zudio` -> `zudio`; on a collision, `zudio-4f2a` rather than failing the sign-up. */
  private async uniqueSlug(businessName: string): Promise<string> {
    const base =
      businessName
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'business';

    const existing = await this.prisma.organization.findUnique({ where: { slug: base } });
    if (!existing) return base;

    return `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
}
