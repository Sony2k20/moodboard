import { LOCALES, Locale, UserRole } from '@moodboard/shared';

/**
 * Pure mapping from what the IdP says to what the application stores. Kept free of Nest and of
 * the OIDC library so it can be tested without either.
 */

/**
 * The role follows from Authentik group membership on every login (§9: roles are managed in
 * Authentik). Admin wins if a user is in both groups. `null` means "in neither": the login is
 * refused even though Authentik let the user through — the Application's policy binding is the
 * first gate, this is the second.
 */
export function roleFromGroups(
  groups: unknown,
  adminGroup: string,
  memberGroup: string,
): UserRole | null {
  const names = Array.isArray(groups)
    ? groups.filter((g): g is string => typeof g === 'string')
    : [];
  if (names.includes(adminGroup)) {
    return 'admin';
  }
  if (names.includes(memberGroup)) {
    return 'member';
  }
  return null;
}

/** First supported language in `Accept-Language`, by the order the browser sends (§13.2). */
export function localeFromAcceptLanguage(
  header: string | undefined,
  fallback: Locale,
): Locale {
  if (!header) {
    return fallback;
  }
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return {
        primary: tag.toLowerCase().split('-')[0],
        q: q ? Number(q.slice(2)) : 1,
      };
    })
    .filter((entry) => !Number.isNaN(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q);
  const match = ranked.find((entry) =>
    (LOCALES as readonly string[]).includes(entry.primary),
  );
  return match ? (match.primary as Locale) : fallback;
}

/**
 * Only same-origin paths are accepted after login. Anything else — an absolute URL, a
 * protocol-relative `//host`, a backslash that some browsers treat as a slash — falls back to `/`,
 * so the login cannot be turned into an open redirect.
 */
export function safeReturnTo(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//')
  ) {
    return '/';
  }
  if (value.includes('\\') || /[\u0000-\u001f]/.test(value)) {
    return '/';
  }
  return value;
}

export interface IdentityClaims {
  readonly sub: string;
  readonly email: string;
  readonly displayName: string;
}

/** `null` when the claims lack what a `user` row needs — `email` is `NOT NULL` (§5.1). */
export function identityFromClaims(
  claims: Record<string, unknown>,
): IdentityClaims | null {
  const sub = typeof claims['sub'] === 'string' ? claims['sub'] : '';
  const email = typeof claims['email'] === 'string' ? claims['email'] : '';
  if (!sub || !email) {
    return null;
  }
  const name = [claims['name'], claims['preferred_username'], email].find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.trim() !== '',
  );
  return { sub, email, displayName: (name as string).trim() };
}

const BACKCHANNEL_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

/**
 * The claim checks of OpenID Connect Back-Channel Logout 1.0, §2.6, that a signature check does
 * not cover.
 */
export function logoutClaims(payload: Record<string, unknown>): {
  sub?: string;
  sid?: string;
} {
  const events = payload['events'];
  if (
    typeof events !== 'object' ||
    events === null ||
    !(BACKCHANNEL_EVENT in (events as Record<string, unknown>))
  ) {
    throw new Error(
      'Not a logout token: the backchannel-logout event is missing',
    );
  }
  if ('nonce' in payload) {
    throw new Error('A logout token must not carry a nonce');
  }
  const sub = typeof payload['sub'] === 'string' ? payload['sub'] : undefined;
  const sid = typeof payload['sid'] === 'string' ? payload['sid'] : undefined;
  if (!sub && !sid) {
    throw new Error('A logout token needs sub or sid');
  }
  return { sub, sid };
}
