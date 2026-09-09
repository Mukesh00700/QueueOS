import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { Public, type AuthedRequest } from './auth.guard';
import { ZodBody } from '../common/zod.pipe';
import { registerSchema, type RegisterDto } from './auth.dto';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body(new ZodBody(loginSchema)) body: z.infer<typeof loginSchema>) {
    return this.auth.login(body.email, body.password);
  }

  @Public()
  @Post('register')
  register(@Body(new ZodBody(registerSchema)) body: RegisterDto) {
    return this.auth.register(body);
  }

  @Get('me')
  me(@Req() req: AuthedRequest) {
    return req.user;
  }
}
