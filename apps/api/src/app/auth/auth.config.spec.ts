import { authConfigFromEnv } from './auth.config';

const oidcEnv = {
  AUTH_MODE: 'oidc',
  PUBLIC_URL: 'https://moodboard.example.com/',
  OIDC_ISSUER_URL: 'https://auth.example.com/application/o/moodboard/',
  OIDC_CLIENT_ID: 'client',
  OIDC_CLIENT_SECRET: 'secret',
  OIDC_ADMIN_GROUP: 'Admins',
  OIDC_MEMBER_GROUP: 'Users',
};

describe('authConfigFromEnv', () => {
  it('fails closed: no AUTH_MODE means disabled', () => {
    expect(authConfigFromEnv({}).mode).toBe('disabled');
  });

  it('refuses an unknown mode rather than guessing', () => {
    expect(() => authConfigFromEnv({ AUTH_MODE: 'off' })).toThrow();
  });

  it('requires every OIDC value in oidc mode', () => {
    const { OIDC_MEMBER_GROUP: _, ...missing } = oidcEnv;
    expect(() => authConfigFromEnv(missing)).toThrow(/OIDC_MEMBER_GROUP/);
  });

  it('derives secure cookies from an https public URL and trims the trailing slash', () => {
    const config = authConfigFromEnv(oidcEnv);
    expect(config.publicUrl).toBe('https://moodboard.example.com');
    expect(config.secureCookies).toBe(true);
    expect(config.oidc?.adminGroup).toBe('Admins');
  });

  it('keeps the emergency admin off unless explicitly enabled with a hash', () => {
    expect(
      authConfigFromEnv({
        ...oidcEnv,
        EMERGENCY_ADMIN_PASSWORD_HASH: 'scrypt$…',
      }).emergencyAdmin,
    ).toBeNull();
    expect(() =>
      authConfigFromEnv({ ...oidcEnv, EMERGENCY_ADMIN_ENABLED: 'true' }),
    ).toThrow(/EMERGENCY_ADMIN_PASSWORD_HASH/);
    expect(
      authConfigFromEnv({
        ...oidcEnv,
        EMERGENCY_ADMIN_ENABLED: 'true',
        EMERGENCY_ADMIN_PASSWORD_HASH: 'h',
      }).emergencyAdmin,
    ).toEqual({ passwordHash: 'h', port: 3001 });
  });
});
