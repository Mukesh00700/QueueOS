import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { QueueService } from './queue.service';
import { TokenService } from '../tokens/token.service';
import { joinQueueSchema } from '../tokens/token.dto';
import {
  createServiceTypeSchema,
  updateQueueSchema,
  updateServiceTypeSchema,
  type CreateServiceTypeDto,
  type UpdateQueueDto,
  type UpdateServiceTypeDto,
} from './queue.dto';
import { MinRole, Public, type AuthedRequest } from '../auth/auth.guard';
import { ZodBody } from '../common/zod.pipe';

const statusSchema = z.object({ status: z.enum(['OPEN', 'PAUSED', 'CLOSED']) });

@Controller('queues')
export class QueueController {
  constructor(
    private readonly queues: QueueService,
    private readonly tokens: TokenService,
  ) {}

  /** Public: powers the TV display and the kiosk queue picker. */
  @Public()
  @Get(':id')
  snapshot(@Param('id') id: string) {
    return this.queues.snapshot(id);
  }

  /** Public: snapshot plus the branch/vertical context a screen needs to render. */
  @Public()
  @Get(':id/display')
  display(@Param('id') id: string) {
    return this.queues.displayContext(id);
  }

  @Public()
  @Get(':id/service-types')
  serviceTypes(@Param('id') id: string) {
    return this.queues.serviceTypesFor(id);
  }

  /**
   * Public: self check-in from QR, kiosk or web. Unauthenticated by design —
   * requiring an account to join a line would defeat the purpose.
   */
  @Public()
  @Post(':id/tokens')
  join(
    @Param('id') id: string,
    @Body(new ZodBody(joinQueueSchema)) body: z.infer<typeof joinQueueSchema>,
  ) {
    return this.tokens.join(id, body);
  }

  @MinRole('ADMIN')
  @Post(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body(new ZodBody(statusSchema)) body: z.infer<typeof statusSchema>,
    @Req() req: AuthedRequest,
  ) {
    return this.queues.setStatus(id, body.status, req.user?.sub);
  }

  @MinRole('RECEPTION')
  @Post(':id/recalculate')
  recalculate(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.queues.recalculate(id, req.user?.sub).then(() => this.queues.snapshot(id));
  }

  @MinRole('ADMIN')
  @Patch(':id')
  async updateQueue(
    @Param('id') id: string,
    @Body(new ZodBody(updateQueueSchema)) body: UpdateQueueDto,
    @Req() req: AuthedRequest,
  ) {
    await this.queues.requireManageAccess(id, req.user!);
    return this.queues.update(id, body);
  }

  @MinRole('ADMIN')
  @Post(':id/service-types')
  async createServiceType(
    @Param('id') id: string,
    @Body(new ZodBody(createServiceTypeSchema)) body: CreateServiceTypeDto,
    @Req() req: AuthedRequest,
  ) {
    await this.queues.requireManageAccess(id, req.user!);
    return this.queues.createServiceType(id, body);
  }

  @MinRole('ADMIN')
  @Patch(':id/service-types/:serviceTypeId')
  async updateServiceType(
    @Param('id') id: string,
    @Param('serviceTypeId') serviceTypeId: string,
    @Body(new ZodBody(updateServiceTypeSchema)) body: UpdateServiceTypeDto,
    @Req() req: AuthedRequest,
  ) {
    await this.queues.requireManageAccess(id, req.user!);
    return this.queues.updateServiceType(id, serviceTypeId, body);
  }

  @MinRole('ADMIN')
  @Delete(':id/service-types/:serviceTypeId')
  async deleteServiceType(
    @Param('id') id: string,
    @Param('serviceTypeId') serviceTypeId: string,
    @Req() req: AuthedRequest,
  ) {
    await this.queues.requireManageAccess(id, req.user!);
    return this.queues.deleteServiceType(id, serviceTypeId);
  }
}
