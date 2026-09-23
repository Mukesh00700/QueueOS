import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { OrderService } from './order.service';
import { MinRole, type AuthedRequest } from '../auth/auth.guard';
import { ZodBody } from '../common/zod.pipe';
import { kitchenStatusSchema, type KitchenStatusDto } from './kitchen.dto';

/** The kitchen board — floor tool, same access tier as the counter tablet. */
@MinRole('COUNTER_STAFF')
@Controller('kitchen')
export class KitchenController {
  constructor(private readonly orders: OrderService) {}

  @Get(':branchId')
  board(@Param('branchId') branchId: string, @Req() req: AuthedRequest) {
    return this.orders.kitchenBoard(branchId, req.user!);
  }

  @Post('items/:itemId/status')
  setStatus(
    @Param('itemId') itemId: string,
    @Body(new ZodBody(kitchenStatusSchema)) body: KitchenStatusDto,
    @Req() req: AuthedRequest,
  ) {
    return this.orders.setItemKitchenStatus(itemId, body.status, req.user!);
  }
}
