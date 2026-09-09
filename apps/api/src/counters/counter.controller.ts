import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { CounterService } from './counter.service';
import { MinRole, type AuthedRequest } from '../auth/auth.guard';
import { ZodBody } from '../common/zod.pipe';
import {
  addOrderItemSchema,
  recordPaymentSchema,
  updateCounterSchema,
  type AddOrderItemDto,
  type RecordPaymentDto,
  type UpdateCounterDto,
} from './counter.dto';

const providerSchema = z.object({ providerName: z.string().trim().max(80).nullable() });
const statusSchema = z.object({ status: z.enum(['IDLE', 'BREAK', 'CLOSED']) });

/** The reception tablet. Every action here is staff-only. */
@MinRole('COUNTER_STAFF')
@Controller('counters')
export class CounterController {
  constructor(private readonly counters: CounterService) {}

  /** Declared before `:id` — otherwise Nest would match "mine" as an id. */
  @Get('mine')
  mine(@Req() req: AuthedRequest) {
    return this.counters.mine(req.user!);
  }

  @Get(':id')
  view(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.counters.view(id, req.user);
  }

  @Post(':id/next')
  next(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.counters.next(id, req.user);
  }

  @Post(':id/call/:tokenId')
  callSpecific(@Param('id') id: string, @Param('tokenId') tokenId: string, @Req() req: AuthedRequest) {
    return this.counters.callSpecific(id, tokenId, req.user);
  }

  @Post(':id/recall')
  recall(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.counters.recall(id, req.user);
  }

  @Post(':id/skip')
  skip(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.counters.skip(id, req.user);
  }

  @Post(':id/complete')
  complete(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.counters.complete(id, req.user);
  }

  @Post(':id/record-payment')
  recordPayment(
    @Param('id') id: string,
    @Body(new ZodBody(recordPaymentSchema)) body: RecordPaymentDto,
    @Req() req: AuthedRequest,
  ) {
    return this.counters.recordPayment(id, body, req.user);
  }

  @Post(':id/order/items')
  addOrderItem(
    @Param('id') id: string,
    @Body(new ZodBody(addOrderItemSchema)) body: AddOrderItemDto,
    @Req() req: AuthedRequest,
  ) {
    return this.counters.addOrderItem(id, body, req.user);
  }

  @Delete(':id/order/items/:itemId')
  removeOrderItem(@Param('id') id: string, @Param('itemId') itemId: string, @Req() req: AuthedRequest) {
    return this.counters.removeOrderItem(id, itemId, req.user);
  }

  @Post(':id/provider')
  setProvider(
    @Param('id') id: string,
    @Body(new ZodBody(providerSchema)) body: z.infer<typeof providerSchema>,
    @Req() req: AuthedRequest,
  ) {
    return this.counters.setProvider(id, body.providerName, req.user);
  }

  @Post(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body(new ZodBody(statusSchema)) body: z.infer<typeof statusSchema>,
    @Req() req: AuthedRequest,
  ) {
    return this.counters.setStatus(id, body.status, req.user);
  }

  /** Configuration, not a floor action — gated higher than the rest of this controller. */
  @MinRole('ADMIN')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateCounterSchema)) body: UpdateCounterDto,
    @Req() req: AuthedRequest,
  ) {
    return this.counters.update(id, body, req.user);
  }
}
