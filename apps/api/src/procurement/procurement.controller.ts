import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ProcurementService } from './procurement.service';
import { MinRole, type AuthedRequest } from '../auth/auth.guard';
import { ZodBody } from '../common/zod.pipe';
import {
  createPurchaseOrderSchema,
  createSupplierSchema,
  updateSupplierSchema,
  type CreatePurchaseOrderDto,
  type CreateSupplierDto,
  type UpdateSupplierDto,
} from './procurement.dto';

/** Supplier records and the purchase orders placed against them. Manager and above only, same as Products/Staff. */
@MinRole('ADMIN')
@Controller()
export class ProcurementController {
  constructor(private readonly procurement: ProcurementService) {}

  @Get('suppliers')
  listSuppliers(@Req() req: AuthedRequest) {
    return this.procurement.listSuppliers(req.user!);
  }

  @Post('suppliers')
  createSupplier(@Body(new ZodBody(createSupplierSchema)) body: CreateSupplierDto, @Req() req: AuthedRequest) {
    return this.procurement.createSupplier(body, req.user!);
  }

  @Patch('suppliers/:id')
  updateSupplier(
    @Param('id') id: string,
    @Body(new ZodBody(updateSupplierSchema)) body: UpdateSupplierDto,
    @Req() req: AuthedRequest,
  ) {
    return this.procurement.updateSupplier(id, body, req.user!);
  }

  @Get('purchase-orders/:id')
  getPurchaseOrder(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.procurement.getPurchaseOrder(id, req.user!);
  }

  @Post('purchase-orders')
  createPurchaseOrder(@Body(new ZodBody(createPurchaseOrderSchema)) body: CreatePurchaseOrderDto, @Req() req: AuthedRequest) {
    return this.procurement.createPurchaseOrder(body, req.user!);
  }

  @Post('purchase-orders/:id/receive')
  receivePurchaseOrder(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.procurement.receivePurchaseOrder(id, req.user!);
  }
}
