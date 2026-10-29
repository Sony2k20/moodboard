import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AUTH_CONFIG, AuthConfig } from './auth.config';
import { Public } from './auth.guard';
import { AuthCookies } from './cookies';
import {
  identityFromClaims,
  localeFromAcceptLanguage,
  roleFromGroups,
  safeReturnTo,
} from './identity';
import { OidcClient } from './oidc.client';
import { SessionStore } from './session.store';
import { UsersService } from './users.service';

/**
 * Authorization code flow with PKCE, BFF pattern (§4.5): the tokens never reach the browser, which
 * only ever holds an HttpOnly session cookie.
 *
 * Failures end on a page of the web app (`/login-failed?reason=…`) rather than a JSON error, because
 * the browser arrives here by navigation, not by `fetch`.
 */
@Controller('auth')
@Public()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly cookies: AuthCookies;

  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly oidc: OidcClient,
    private readonly sessions: SessionStore,
    private readonly users: UsersService,
  ) {
    this.cookies = new AuthCookies(config);
  }

  @Get('login')
  async login(
    @Query('returnTo') returnTo: unknown,
    @Res() res: Response,
  ): Promise<void> {
    this.requireOidc();
    const request = await this.oidc.authorizationRequest();
    await this.sessions.saveLoginFlow(request.state, {
      codeVerifier: request.codeVerifier,
      nonce: request.nonce,
      returnTo: safeReturnTo(returnTo),
    });
    this.cookies.setFlow(res, request.state);
    res.redirect(302, request.url);
  }

  @Get('callback')
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    this.requireOidc();
    const state =
      typeof req.query['state'] === 'string' ? req.query['state'] : '';
    const browserState = this.cookies.readFlow(req);
    this.cookies.clearFlow(res);

    // Taken before any check, so a state is redeemable once whatever happens next.
    const flow = state ? await this.sessions.takeLoginFlow(state) : null;
    if (!flow || browserState !== state) {
      return this.fail(res, 'expired');
    }
    if (typeof req.query['error'] === 'string') {
      return this.fail(
        res,
        req.query['error'] === 'access_denied' ? 'not_permitted' : 'failed',
      );
    }

    let result;
    try {
      result = await this.oidc.handleCallback(
        new URL(req.originalUrl, this.config.publicUrl),
        {
          state,
          nonce: flow.nonce,
          codeVerifier: flow.codeVerifier,
        },
      );
    } catch (error) {
      this.logger.warn(`Login callback rejected: ${String(error)}`);
      return this.fail(res, 'failed');
    }

    const settings = this.config.oidc!;
    const identity = identityFromClaims(result.claims);
    const role = roleFromGroups(
      result.claims['groups'],
      settings.adminGroup,
      settings.memberGroup,
    );
    if (!identity) {
      return this.fail(res, 'failed');
    }
    if (!role) {
      await this.users.audit('auth.login_denied', null, {
        sub: identity.sub,
        reason: 'no_group',
      });
      return this.fail(res, 'not_permitted');
    }

    const locale = localeFromAcceptLanguage(
      req.headers['accept-language'],
      this.config.defaultLocale,
    );
    const user = await this.users.upsertFromLogin(identity, role, locale);
    const { token, maxAgeSeconds } = await this.sessions.create({
      userId: user.id,
      sub: identity.sub,
      sid: result.sid,
      idToken: result.idToken,
      emergency: false,
    });
    await this.users.audit('auth.login', user.id, { role });
    this.cookies.setSession(res, token, maxAgeSeconds);
    res.redirect(302, flow.returnTo);
  }

  /** Ends the local session and tells the browser where to go to end the Authentik one. */
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ redirectUrl: string }> {
    const session = await this.sessions.destroy(this.cookies.readSession(req));
    this.cookies.clearSession(res);
    if (!session) {
      return { redirectUrl: '/' };
    }
    await this.users.audit('auth.logout', session.userId);
    if (session.emergency) {
      return { redirectUrl: '/emergency' };
    }
    return {
      redirectUrl: (await this.oidc.endSessionUrl(session.idToken)) ?? '/',
    };
  }

  /** Called by Authentik, server to server, when a user signs out there (0003). */
  @Post('backchannel-logout')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async backchannelLogout(
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    this.requireOidc();
    const token =
      typeof body?.['logout_token'] === 'string' ? body['logout_token'] : '';
    let claims;
    try {
      claims = await this.oidc.verifyLogoutToken(token);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      this.logger.warn(`Backchannel logout rejected: ${String(error)}`);
      throw new BadRequestException({ error: 'invalid_request' });
    }
    const ended = await this.sessions.destroyByLogout(claims);
    await this.users.audit('auth.backchannel_logout', null, {
      sub: claims.sub,
      sid: claims.sid,
      ended,
    });
  }

  private requireOidc(): void {
    if (this.config.mode !== 'oidc') {
      throw new ServiceUnavailableException('Authentication is disabled');
    }
  }

  private fail(
    res: Response,
    reason: 'expired' | 'not_permitted' | 'failed',
  ): void {
    res.redirect(302, `/login-failed?reason=${reason}`);
  }
}
