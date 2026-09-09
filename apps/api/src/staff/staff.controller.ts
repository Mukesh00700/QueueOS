import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { StaffService } from './staff.service';
import { MinRole, type AuthedRequest } from '../auth/auth.guard';
import { ZodBody } from '../common/zod.pipe';
import {
  createStaffSchema,
  resetPasswordSchema,
  updateStaffSchema,
  type CreateStaffDto,
  type ResetPasswordDto,
  type UpdateStaffDto,
} from './staff.dto';

/** Business-setup staff directory. Manager and above only. */
@MinRole('ADMIN')
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.staff.list(req.user!);
  }

  @Post()
  create(@Body(new ZodBody(createStaffSchema)) body: CreateStaffDto, @Req() req: AuthedRequest) {
    return this.staff.create(body, req.user!);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateStaffSchema)) body: UpdateStaffDto,
    @Req() req: AuthedRequest,
  ) {
    return this.staff.update(id, body, req.user!);
  }

  @Post(':id/reset-password')
  resetPassword(
    @Param('id') id: string,
    @Body(new ZodBody(resetPasswordSchema)) body: ResetPasswordDto,
    @Req() req: AuthedRequest,
  ) {
    return this.staff.resetPassword(id, body.password, req.user!);
  }
}
