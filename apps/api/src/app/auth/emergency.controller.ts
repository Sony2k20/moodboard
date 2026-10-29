import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { valkeyPrefix } from '@moodboard/shared';
import type { Request, Response } from 'express';
import { VALKEY, ValkeyClient } from '../valkey.module';
import { AUTH_CONFIG, AuthConfig } from './auth.config';
import { Public } from './auth.guard';
import { AuthCookies } from './cookies';
import { verifyPassword } from './password';
import { SessionStore } from './session.store';
import { UsersService } from './users.service';

const FAILURES_KEY = `${valkeyPrefix(process.env)}:auth:emergency-failures`;
export const MAX_FAILURES = 5;
export const LOCKOUT_SECONDS = 15 * 60;

/**
 * The emergency admin (§4.10): local account, no SSO, every attempt in the audit log.
 *
 * "LAN only" is enforced by the port the request arrived on, not by its source address — behind
 * the cluster load balancer LAN traffic is source-NATed, so an IP check would be meaningless. The
 * api listens on a second port for this route alone, and the chart exposes that port only through
 * an IngressRoute on the LAN entry point. Arriving on the main port, the route does not exist.
 */
@Controller('auth/emergency')
@Public()
export class EmergencyController {
  private readonly cookies: AuthCookies;

  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(VALKEY) private readonly valkey: ValkeyClient,
    private readonly sessions: SessionStore,
    private readonly users: UsersService,
  ) {
    this.cookies = new AuthCookies(config);
  }

  @Post()
  @HttpCode(204)
  async login(
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const emergency = this.config.emergencyAdmin;
    if (!emergency || req.socket.localPort !== emergency.port) {
      throw new NotFoundException();
    }
    if (this.config.mode !== 'oidc') {
      throw new ServiceUnavailableException('Authentication is disabled');
    }

    const failures = Number((await this.valkey.get(FAILURES_KEY)) ?? 0);
    if (failures >= MAX_FAILURES) {
      await this.users.audit('auth.emergency_login_failed', null, {
        reason: 'locked',
      });
      throw new HttpException(
        'Too many failed attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const password =
      typeof body?.['password'] === 'string' ? body['password'] : '';
    if (
      !password ||
      !(await verifyPassword(password, emergency.passwordHash))
    ) {
      const count = await this.valkey.incr(FAILURES_KEY);
      if (count === 1) {
        await this.valkey.expire(FAILURES_KEY, LOCKOUT_SECONDS);
      }
      await this.users.audit('auth.emergency_login_failed', null, {
        reason: 'password',
        attempt: count,
      });
      throw new UnauthorizedException();
    }

    await this.valkey.del(FAILURES_KEY);
    const user = await this.users.ensureEmergencyAdmin(
      this.config.defaultLocale,
    );
    const { token, maxAgeSeconds } = await this.sessions.create({
      userId: user.id,
      sub: 'local:emergency-admin',
      emergency: true,
    });
    await this.users.audit('auth.emergency_login', user.id);
    this.cookies.setSession(res, token, maxAgeSeconds);
  }
}
