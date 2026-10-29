import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

export type Locale = 'en' | 'de';

export interface CurrentUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: 'admin' | 'member';
  readonly locale: Locale;
}

/**
 * - `signedIn`: `/api/me` answered with a user
 * - `redirecting`: no session, on the way to the Authentik login
 * - `anonymous`: no session, on a page that renders without one
 * - `disabled`: the api runs with `AUTH_MODE=disabled` and serves no data (503)
 * - `unavailable`: anything else — the api or Valkey is down
 */
export type SessionState =
  | 'loading'
  | 'signedIn'
  | 'redirecting'
  | 'anonymous'
  | 'disabled'
  | 'unavailable';

/** Full-page navigation, behind a token so tests can watch it instead of leaving the page. */
export const NAVIGATE = new InjectionToken<(url: string) => void>('NAVIGATE', {
  providedIn: 'root',
  factory: () => (url: string) => window.location.assign(url),
});

/** Pages that must render without a session: the login error and the emergency login. */
const PUBLIC_PATHS = ['/login-failed', '/emergency'];

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);
  private readonly transloco = inject(TranslocoService);
  private readonly navigate = inject(NAVIGATE);

  readonly state = signal<SessionState>('loading');
  readonly user = signal<CurrentUser | null>(null);

  /** Runs before the first route renders. Never rejects — every outcome is a state. */
  async init(
    path: string = window.location.pathname,
    search: string = window.location.search,
  ): Promise<void> {
    try {
      const user = await firstValueFrom(this.http.get<CurrentUser>('/api/me'));
      this.user.set(user);
      this.transloco.setActiveLang(user.locale);
      this.state.set('signedIn');
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      if (status === 401) {
        if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
          this.state.set('anonymous');
          return;
        }
        this.state.set('redirecting');
        this.navigate(
          `/api/auth/login?returnTo=${encodeURIComponent(path + search)}`,
        );
        return;
      }
      this.state.set(status === 503 ? 'disabled' : 'unavailable');
    }
  }

  /** The locale is persisted on the user, so it follows them across devices (§13.2). */
  async setLocale(locale: Locale): Promise<void> {
    this.transloco.setActiveLang(locale);
    if (this.user()) {
      this.user.set(
        await firstValueFrom(
          this.http.patch<CurrentUser>('/api/me', { locale }),
        ),
      );
    }
  }

  async logout(): Promise<void> {
    const { redirectUrl } = await firstValueFrom(
      this.http.post<{ redirectUrl: string }>('/api/auth/logout', {}),
    );
    this.navigate(redirectUrl);
  }
}
