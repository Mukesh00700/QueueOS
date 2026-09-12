import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ROLE_RANK, VERTICALS, getVertical } from '@queueos/core';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queues/queue.service';
import { provisionFlow } from '../queues/flow-provisioning';
import { EventBusService } from '../events/event-bus.service';
import { InsightsService } from '../insights/insights.service';
import { CounterService } from '../counters/counter.service';
import { formatDisplayCode } from '../queues/queue.util';
import { MinRole, Public, type AuthedRequest } from '../auth/auth.guard';
import type { JwtPayload } from '../auth/auth.service';
import { ZodBody } from '../common/zod.pipe';
import { createBranchSchema, updateBranchSchema, type CreateBranchDto, type UpdateBranchDto } from './branch.dto';
import { createQueueSchema, type CreateQueueDto } from '../queues/queue.dto';
import { createCounterSchema, type CreateCounterDto } from '../counters/counter.dto';

@Controller()
export class BranchController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly events: EventBusService,
    private readonly insights: InsightsService,
    private readonly counterService: CounterService,
  ) {}

  /**
   * Create a branch within the caller's own organization. `flowTemplate` is
   * optional here (unlike registration, which always picks one) — a branch
   * created without it gets zero queues, same as before this field existed.
   */
  @MinRole('OWNER')
  @Post('branches')
  async create(
    @Body(new ZodBody(createBranchSchema)) body: CreateBranchDto,
    @Req() req: AuthedRequest,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const branch = await tx.branch.create({
          data: {
            organizationId: req.user!.organizationId,
            name: body.name,
            code: body.code,
            vertical: body.vertical ?? null,
            timezone: body.timezone ?? 'Asia/Kolkata',
            address: body.address ?? null,
            openTime: body.openTime ?? '09:00',
            closeTime: body.closeTime ?? '18:00',
          },
        });
        if (body.flowTemplate) await provisionFlow(tx, branch.id, body.flowTemplate);
        return branch;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(`A branch with code "${body.code}" already exists in your organization`);
      }
      throw err;
    }
  }

  @MinRole('OWNER')
  @Patch('branches/:id')
  async update(
    @Param('id') id: string,
    @Body(new ZodBody(updateBranchSchema)) body: UpdateBranchDto,
    @Req() req: AuthedRequest,
  ) {
    await this.requireOwnOrg(id, req.user!.organizationId);
    try {
      return await this.prisma.branch.update({ where: { id }, data: body });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(`A branch with code "${body.code}" already exists in your organization`);
      }
      throw err;
    }
  }

  /** Guards against an org admin editing another organization's branch by guessing an id. */
  private async requireOwnOrg(branchId: string, organizationId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { organizationId: true },
    });
    if (!branch || branch.organizationId !== organizationId) {
      throw new NotFoundException('Branch not found');
    }
  }

  /** A branch manager may only configure their own branch; an org admin may configure any branch in their org. */
  private async requireBranchScope(branchId: string, user: JwtPayload) {
    await this.requireOwnOrg(branchId, user.organizationId);
    if (ROLE_RANK[user.role] < ROLE_RANK.OWNER && user.branchId !== branchId) {
      throw new ForbiddenException('You can only manage your own branch');
    }
  }

  @MinRole('ADMIN')
  @Post('branches/:id/queues')
  async createQueue(
    @Param('id') branchId: string,
    @Body(new ZodBody(createQueueSchema)) body: CreateQueueDto,
    @Req() req: AuthedRequest,
  ) {
    await this.requireBranchScope(branchId, req.user!);
    return this.queues.create(branchId, body);
  }

  @MinRole('ADMIN')
  @Post('branches/:id/counters')
  async createCounter(
    @Param('id') branchId: string,
    @Body(new ZodBody(createCounterSchema)) body: CreateCounterDto,
    @Req() req: AuthedRequest,
  ) {
    await this.requireBranchScope(branchId, req.user!);
    return this.counterService.create(branchId, body);
  }

  /** Vertical profiles, so the web app renders terminology from one source. */
  @Public()
  @Get('verticals')
  verticals() {
    return VERTICALS;
  }

  /**
   * Staff-only: every branch the caller is allowed to administer. An org
   * admin sees their whole organization; anyone below that rank sees only
   * their own branch. This used to return every branch on the platform —
   * see decision.md, 2026-09-08.
   */
  @MinRole('ADMIN')
  @Get('branches')
  async list(@Req() req: AuthedRequest) {
    const user = req.user!;
    const isOwner = ROLE_RANK[user.role] >= ROLE_RANK.OWNER;

    const branches = await this.prisma.branch.findMany({
      where: {
        organizationId: user.organizationId,
        ...(isOwner ? {} : { id: user.branchId ?? '__none__' }),
      },
      include: { organization: true, _count: { select: { queues: true } } },
      orderBy: { name: 'asc' },
    });

    return branches.map((b) => ({
      id: b.id,
      name: b.name,
      code: b.code,
      organizationId: b.organizationId,
      organizationName: b.organization.name,
      vertical: getVertical(b.vertical ?? b.organization.vertical).id,
      queueCount: b._count.queues,
    }));
  }

  /**
   * Public, deliberately minimal: what the check-in kiosk needs to greet a
   * customer and list open queues to join. No customer names, no activity
   * log, no revenue-adjacent stats — see decision.md, 2026-09-08, on why
   * this had to be split out of `overview` rather than making `overview`
   * itself public.
   */
  @Public()
  @Get('branches/:id/checkin-info')
  async checkinInfo(@Param('id') id: string) {
    const [stats, queues] = await Promise.all([
      this.queues.branchStats(id),
      this.queues.listForBranch(id),
    ]);

    return {
      organizationName: stats.organizationName,
      branchName: stats.branchName,
      vertical: stats.vertical,
      queues,
    };
  }

  /**
   * Everything the operator dashboard needs in one round trip. Assembled
   * server-side because six separate requests on page load is what makes a
   * mission-control screen feel slow. Staff-only and branch-scoped — this
   * carries customer names, the activity log and revenue-adjacent stats,
   * none of which belong on a public response. See decision.md, 2026-09-08.
   */
  @MinRole('ADMIN')
  @Get('branches/:id/overview')
  async overview(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.requireBranchScope(id, req.user!);
    const [stats, queues, timeline, activity, insights, forecast, rawCounters] = await Promise.all([
      this.queues.branchStats(id),
      this.queues.listForBranch(id),
      this.queues.hourlyLoad(id),
      this.events.recent(id, 20),
      this.insights.forBranch(id),
      this.insights.forecast(id),
      this.prisma.counter.findMany({
        where: { branchId: id },
        include: { queue: { select: { id: true, name: true, tokenPrefix: true } } },
        orderBy: { name: 'asc' },
      }),
    ]);

    // Who's actually being served right now at each counter — so a NEXT/
    // COMPLETE press on the counter tablet shows up here too, not just a
    // status dot. One query for every counter rather than N.
    const servingTokens = await this.prisma.token.findMany({
      where: { counterId: { in: rawCounters.map((c) => c.id) }, status: { in: ['SERVING', 'CALLED'] } },
      include: { customer: true },
    });
    const currentByCounter = new Map(servingTokens.map((t) => [t.counterId, t]));

    const counters = rawCounters.map((c) => {
      const current = currentByCounter.get(c.id);
      return {
        ...c,
        currentToken: current
          ? {
              code: formatDisplayCode(c.queue?.tokenPrefix ?? 'A', current.displayNumber),
              customerName: current.customer?.name ?? null,
            }
          : null,
      };
    });

    return { stats, queues, timeline, activity, insights, forecast, counters };
  }

  @MinRole('ADMIN')
  @Get('branches/:id/queues')
  async queuesFor(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.requireBranchScope(id, req.user!);
    return this.queues.listForBranch(id);
  }

  /** Raw queue config (not the live snapshot) for the business-setup page. */
  @MinRole('ADMIN')
  @Get('branches/:id/queue-config')
  async queueConfig(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.requireBranchScope(id, req.user!);
    return this.queues.rawForBranch(id);
  }

  @MinRole('ADMIN')
  @Get('branches/:id/activity')
  async activity(@Param('id') id: string, @Query('limit') limit: string | undefined, @Req() req: AuthedRequest) {
    await this.requireBranchScope(id, req.user!);
    return this.events.recent(id, Math.min(100, Number(limit) || 25));
  }

  /** Counters for a branch, used by the setup page and the counter picker on the tablet. */
  @MinRole('ADMIN')
  @Get('branches/:id/counters')
  async counters(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.requireBranchScope(id, req.user!);
    return this.prisma.counter.findMany({
      where: { branchId: id },
      include: { queue: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }
}
