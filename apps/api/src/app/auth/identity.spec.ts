import {
  identityFromClaims,
  localeFromAcceptLanguage,
  logoutClaims,
  roleFromGroups,
  safeReturnTo,
} from './identity';

describe('roleFromGroups', () => {
  const admin = 'MoodBoard Admins';
  const member = 'MoodBoard Users';

  it('maps the admin group to admin, and admin wins over member', () => {
    expect(roleFromGroups([member, admin], admin, member)).toBe('admin');
  });

  it('maps the member group to member', () => {
    expect(roleFromGroups(['other', member], admin, member)).toBe('member');
  });

  it('refuses a user in neither group', () => {
    expect(roleFromGroups(['authentik Admins'], admin, member)).toBeNull();
  });

  it('compares names exactly — no case folding, no prefix match', () => {
    expect(
      roleFromGroups(['moodboard admins', 'MoodBoard Admins '], admin, member),
    ).toBeNull();
  });

  it('treats a missing or malformed claim as no groups', () => {
    expect(roleFromGroups(undefined, admin, member)).toBeNull();
    expect(roleFromGroups('MoodBoard Admins', admin, member)).toBeNull();
  });
});

describe('localeFromAcceptLanguage', () => {
  it('takes the first supported language by weight', () => {
    expect(
      localeFromAcceptLanguage('fr-FR,fr;q=0.9,de;q=0.8,en;q=0.7', 'en'),
    ).toBe('de');
  });

  it('falls back when nothing is supported or the header is absent', () => {
    expect(localeFromAcceptLanguage('fr, es', 'en')).toBe('en');
    expect(localeFromAcceptLanguage(undefined, 'de')).toBe('de');
  });

  it('ignores languages the browser weighted at zero', () => {
    expect(localeFromAcceptLanguage('de;q=0, en', 'de')).toBe('en');
  });
});

describe('safeReturnTo', () => {
  it.each(['/', '/assets/123?tab=colors', '/boards#top'])(
    'keeps the same-origin path %s',
    (path) => {
      expect(safeReturnTo(path)).toBe(path);
    },
  );

  it.each([
    'https://evil.example',
    '//evil.example/path',
    '/\\evil.example',
    'javascript:alert(1)',
    '/path\nSet-Cookie: x',
    '',
    undefined,
    ['/a'],
  ])('replaces %p with /', (value) => {
    expect(safeReturnTo(value)).toBe('/');
  });
});

describe('identityFromClaims', () => {
  it('prefers name, then preferred_username, then e-mail as display name', () => {
    expect(
      identityFromClaims({ sub: 's', email: 'a@b.c', name: ' Ada ' })
        ?.displayName,
    ).toBe('Ada');
    expect(
      identityFromClaims({
        sub: 's',
        email: 'a@b.c',
        preferred_username: 'ada',
      })?.displayName,
    ).toBe('ada');
    expect(
      identityFromClaims({ sub: 's', email: 'a@b.c', name: '' })?.displayName,
    ).toBe('a@b.c');
  });

  it('refuses claims without sub or e-mail', () => {
    expect(identityFromClaims({ email: 'a@b.c' })).toBeNull();
    expect(identityFromClaims({ sub: 's' })).toBeNull();
  });
});

describe('logoutClaims', () => {
  const event = { 'http://schemas.openid.net/event/backchannel-logout': {} };

  it('accepts a token with the event and sid or sub', () => {
    expect(logoutClaims({ events: event, sid: 'x' })).toEqual({
      sid: 'x',
      sub: undefined,
    });
    expect(logoutClaims({ events: event, sub: 'u' })).toEqual({
      sub: 'u',
      sid: undefined,
    });
  });

  it('rejects an ID token presented as a logout token', () => {
    expect(() => logoutClaims({ sub: 'u', nonce: 'n' })).toThrow(/event/);
    expect(() => logoutClaims({ events: event, sub: 'u', nonce: 'n' })).toThrow(
      /nonce/,
    );
  });

  it('rejects a token that names no session and no subject', () => {
    expect(() => logoutClaims({ events: event })).toThrow(/sub or sid/);
  });
});
