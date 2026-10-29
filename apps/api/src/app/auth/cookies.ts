import type { CookieOptions, Request, Response } from 'express';
import { AuthConfig } from './auth.config';

/**
 * Cookie names and options in one place. With https the names carry the `__Host-` prefix, which
 * the browser enforces: Secure, Path=/, no Domain — the cookie cannot be set or overwritten by a
 * sibling subdomain.
 *
 * SameSite=Lax, not Strict: the return from Authentik is a cross-site top-level navigation, and
 * a Strict cookie would not be sent with it. Lax still withholds the cookie from cross-site POSTs,
 * which is what every state-changing endpoint here is.
 */
export class AuthCookies {
  constructor(private readonly config: AuthConfig) {}

  get sessionName(): string {
    return this.config.secureCookies ? '__Host-mb_session' : 'mb_session';
  }

  get flowName(): string {
    return this.config.secureCookies ? '__Host-mb_login' : 'mb_login';
  }

  readSession(req: Request): string | undefined {
    return (req.cookies as Record<string, string> | undefined)?.[
      this.sessionName
    ];
  }

  readFlow(req: Request): string | undefined {
    return (req.cookies as Record<string, string> | undefined)?.[this.flowName];
  }

  setSession(res: Response, token: string, maxAgeSeconds: number): void {
    res.cookie(this.sessionName, token, {
      ...this.options(),
      maxAge: maxAgeSeconds * 1000,
    });
  }

  /** Binds the login state to this browser, so a callback URL cannot be replayed elsewhere. */
  setFlow(res: Response, state: string): void {
    res.cookie(this.flowName, state, {
      ...this.options(),
      maxAge: 10 * 60 * 1000,
    });
  }

  clearSession(res: Response): void {
    res.clearCookie(this.sessionName, this.options());
  }

  clearFlow(res: Response): void {
    res.clearCookie(this.flowName, this.options());
  }

  private options(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.secureCookies,
      sameSite: 'lax',
      path: '/',
    };
  }
}
