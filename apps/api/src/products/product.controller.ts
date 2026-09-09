import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ProductService } from './product.service';
import { MinRole, type AuthedRequest } from '../auth/auth.guard';
import { ZodBody } from '../common/zod.pipe';
import { createProductSchema, updateProductSchema, type CreateProductDto, type UpdateProductDto } from './product.dto';

/** Business-setup product catalogue. Manager and above only, same as Staff. */
@MinRole('ADMIN')
@Controller('products')
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.products.list(req.user!);
  }

  @Post()
  create(@Body(new ZodBody(createProductSchema)) body: CreateProductDto, @Req() req: AuthedRequest) {
    return this.products.create(body, req.user!);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateProductSchema)) body: UpdateProductDto,
    @Req() req: AuthedRequest,
  ) {
    return this.products.update(id, body, req.user!);
  }
}
