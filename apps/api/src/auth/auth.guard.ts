import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLE_RANK, type Role } from '@queueos/core';
import { AuthService, type JwtPayload } from './auth.service';

export const IS_PUBLIC_KEY = 'queueos:isPublic';
export const ROLES_KEY = 'queueos:minRole';

/**
 * Customer-facing endpoints (check-in, token status, TV display) carry no
 * session — the unguessable token code is the credential. Everything else is
 * staff-only and must opt out explicitly, so a new controller is authenticated
 * by default rather than accidentally open.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Minimum role required, compared by rank from @queueos/core. */
export const MinRole = (role: Role) => SetMetadata(ROLES_KEY, role);

export interface AuthedRequest {
  user?: JwtPayload;
  headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization;
    const raw = Array.isArray(header) ? header[0] : header;

    if (!raw?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const user = await this.auth.verify(raw.slice(7));
    request.user = user;

    const minRole = this.reflector.getAllAndOverride<Role>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (minRole && ROLE_RANK[user.role] < ROLE_RANK[minRole]) {
      throw new ForbiddenException(`Requires ${minRole} or higher`);
    }

    return true;
  }
}
