import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { MinRole, type AuthedRequest } from '../auth/auth.guard';
import { ZodBody } from '../common/zod.pipe';
import { refundSchema, type RefundDto } from './invoice.dto';

/** Financial records — back-office only, same tier as the dashboard itself. */
@MinRole('ADMIN')
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get(':id')
  get(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.invoices.getById(id, req.user!);
  }

  @Post(':id/void')
  void(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.invoices.void(id, req.user!);
  }

  @Post(':id/refund')
  refund(
    @Param('id') id: string,
    @Body(new ZodBody(refundSchema)) body: RefundDto,
    @Req() req: AuthedRequest,
  ) {
    return this.invoices.refund(id, body, req.user!);
  }
}
