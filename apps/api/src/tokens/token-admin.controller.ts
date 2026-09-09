import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { TokenService } from './token.service';
import { MinRole, type AuthedRequest } from '../auth/auth.guard';
import { ZodBody } from '../common/zod.pipe';
import {
  changePrioritySchema,
  transferTokenSchema,
  type ChangePriorityDto,
  type TransferTokenDto,
} from './token.dto';

/**
 * Staff-side token operations, keyed by internal id rather than the public
 * customer code — deliberately a separate controller from `TokenController`
 * (`/t/*`), which is `@Public()` at the class level and must stay that way.
 */
@MinRole('ADMIN')
@Controller('tokens')
export class TokenAdminController {
  constructor(private readonly tokens: TokenService) {}

  @Post(':id/transfer')
  transfer(
    @Param('id') id: string,
    @Body(new ZodBody(transferTokenSchema)) body: TransferTokenDto,
    @Req() req: AuthedRequest,
  ) {
    return this.tokens.transfer(id, body.targetQueueId, req.user!);
  }

  @Post(':id/priority')
  changePriority(
    @Param('id') id: string,
    @Body(new ZodBody(changePrioritySchema)) body: ChangePriorityDto,
    @Req() req: AuthedRequest,
  ) {
    return this.tokens.changePriority(id, body.priority, body.reason, req.user!);
  }
}
