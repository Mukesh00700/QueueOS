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
@Controller('tokens')
export class TokenAdminController {
  constructor(private readonly tokens: TokenService) {}

  /**
   * Floor-staff level, not Admin — "this customer is in the wrong line"
   * is routine triage a receptionist handles all day, not a decision that
   * needs a manager. `TokenService.transfer` still enforces same-branch
   * scoping independently, so this doesn't widen reach beyond one branch.
   */
  @MinRole('COUNTER_STAFF')
  @Post(':id/transfer')
  transfer(
    @Param('id') id: string,
    @Body(new ZodBody(transferTokenSchema)) body: TransferTokenDto,
    @Req() req: AuthedRequest,
  ) {
    return this.tokens.transfer(id, body.targetQueueId, req.user!);
  }

  /**
   * Stays Admin-only, unlike transfer — jumping someone ahead of everyone
   * else waiting has a fairness dimension a manager should sign off on,
   * not something any floor staff should be able to do unilaterally.
   */
  @MinRole('ADMIN')
  @Post(':id/priority')
  changePriority(
    @Param('id') id: string,
    @Body(new ZodBody(changePrioritySchema)) body: ChangePriorityDto,
    @Req() req: AuthedRequest,
  ) {
    return this.tokens.changePriority(id, body.priority, body.reason, req.user!);
  }
}
