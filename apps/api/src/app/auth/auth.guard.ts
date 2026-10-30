import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Inject,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AUTH_CONFIG, AuthConfig } from './auth.config';
import { AuthCookies } from './cookies';
import { SessionData, SessionStore } from './session.store';
import { ApiTokensService } from './api-tokens.service';
import { CurrentUser, UsersService } from './users.service';

const PUBLIC = 'mb:public';

/**
 * Opts a route out of the session check. Everything else requires a session — the default is
 * closed, so a new endpoint that forgets about authentication is protected anyway.
 */
export const Public = () => SetMetadata(PUBLIC, true);

const BEARER = 'mb:bearer';

/**
 * Authenticates a route by a personal API token instead of the session (0010). Only the MCP
 * endpoint carries it: a token does not open the rest of the api, and a session does not open
 * this route.
 */
export const BearerToken = () => SetMetadata(BEARER, true);

export interface AuthenticatedRequest extends Request {
  user: CurrentUser;
  session: SessionData;
}

export const User = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): CurrentUser =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);

/**
 * Global guard. With `AUTH_MODE=disabled` every non-public route answers 503 — never data (§9).
 * With `oidc` it answers 401 without a valid session. The user is read from the database on each
 * request, so a role change takes effect without waiting for the session to end.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly cookies: AuthCookies;

  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly sessions: SessionStore,
    private readonly users: UsersService,
    private readonly tokens: ApiTokensService,
  ) {
    this.cookies = new AuthCookies(config);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    if (this.config.mode !== 'oidc') {
      throw new ServiceUnavailableException('Authentication is disabled');
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const bearer = this.reflector.getAllAndOverride<boolean>(BEARER, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (bearer) {
      const header = req.headers?.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
      const user = token ? await this.tokens.authenticate(token) : null;
      if (!user) {
        throw new UnauthorizedException('A valid API token is required');
      }
      req.user = user;
      return true;
    }

    const session = await this.sessions.get(this.cookies.readSession(req));
    const user = session ? await this.users.findById(session.userId) : null;
    if (!session || !user) {
      throw new UnauthorizedException();
    }
    req.user = user;
    req.session = session;
    return true;
  }
}
