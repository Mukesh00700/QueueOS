import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { TokenService } from './token.service';
import { feedbackSchema } from './token.dto';
import { Public } from '../auth/auth.guard';
import { ZodBody } from '../common/zod.pipe';

/**
 * The customer's own endpoints. The public token code is the credential — it is
 * 12 random characters, it only ever exposes one person's own status, and it
 * means a customer can check their place from a QR scan without an account.
 */
@Public()
@Controller('t')
export class TokenController {
  constructor(private readonly tokens: TokenService) {}

  @Get(':code')
  status(@Param('code') code: string) {
    return this.tokens.statusByCode(code);
  }

  @Get(':code/notifications')
  notifications(@Param('code') code: string) {
    return this.tokens.notifications(code);
  }

  /** "Still coming?" → YES */
  @Post(':code/confirm-recall')
  confirmRecall(@Param('code') code: string) {
    return this.tokens.confirmRecall(code);
  }

  /** "Still coming?" → NO, and the Leave Queue button. */
  @Post(':code/cancel')
  cancel(@Param('code') code: string) {
    return this.tokens.cancel(code);
  }

  @Post(':code/feedback')
  feedback(
    @Param('code') code: string,
    @Body(new ZodBody(feedbackSchema)) body: z.infer<typeof feedbackSchema>,
  ) {
    return this.tokens.submitFeedback(code, body.rating, body.comment);
  }
}
