import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FakeValkey } from '../testing/fake-valkey';
import { authConfigFromEnv } from './auth.config';
import { AuthGuard, BearerToken, Public } from './auth.guard';
import { ApiTokensService } from './api-tokens.service';
import { SessionStore } from './session.store';
import { CurrentUser, UsersService } from './users.service';

const ada: CurrentUser = {
  id: 'u1',
  email: 'ada@example.com',
  displayName: 'Ada',
  role: 'member',
  locale: 'en',
};

class DataController {
  data() {
    return 'data';
  }
  @Public()
  health() {
    return 'ok';
  }
  @BearerToken()
  mcp() {
    return 'mcp';
  }
}

function context(
  handler: keyof DataController,
  cookies: Record<string, string> = {},
  headers: Record<string, string> = {},
) {
  const req: Record<string, unknown> = { cookies, headers };
  const ctx = {
    getHandler: () => DataController.prototype[handler],
    getClass: () => DataController,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('AuthGuard', () => {
  const oidcEnv = {
    AUTH_MODE: 'oidc',
    PUBLIC_URL: 'https://moodboard.example.com',
    OIDC_ISSUER_URL: 'https://auth.example.com/application/o/moodboard/',
    OIDC_CLIENT_ID: 'c',
    OIDC_CLIENT_SECRET: 's',
    OIDC_ADMIN_GROUP: 'A',
    OIDC_MEMBER_GROUP: 'U',
  };
  let sessions: SessionStore;
  let users: { findById: jest.Mock };
  const tokens = {
    authenticate: jest.fn(async (token: string) => (token === 'mb_good' ? ada : null)),
  };

  function guard(env: Record<string, string>) {
    return new AuthGuard(
      new Reflector(),
      authConfigFromEnv(env),
      sessions,
      users as unknown as UsersService,
      tokens as unknown as ApiTokensService,
    );
  }

  beforeEach(() => {
    sessions = new SessionStore(new FakeValkey().asClient());
    users = {
      findById: jest.fn(async (id: string) => (id === ada.id ? ada : null)),
    };
  });

  it('lets public routes through in every mode', async () => {
    await expect(guard({}).canActivate(context('health').ctx)).resolves.toBe(
      true,
    );
    await expect(
      guard(oidcEnv).canActivate(context('health').ctx),
    ).resolves.toBe(true);
  });

  it('answers 503, never data, when authentication is disabled', async () => {
    const { token } = await sessions.create({
      userId: ada.id,
      sub: 's',
      emergency: false,
    });
    await expect(
      guard({ AUTH_MODE: 'disabled' }).canActivate(
        context('data', { mb_session: token, '__Host-mb_session': token }).ctx,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('answers 401 without a session', async () => {
    await expect(
      guard(oidcEnv).canActivate(context('data').ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('only reads the __Host- cookie over https', async () => {
    const { token } = await sessions.create({
      userId: ada.id,
      sub: 's',
      emergency: false,
    });
    await expect(
      guard(oidcEnv).canActivate(context('data', { mb_session: token }).ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('answers 401 when the session points at a user that no longer exists', async () => {
    const { token } = await sessions.create({
      userId: 'gone',
      sub: 's',
      emergency: false,
    });
    await expect(
      guard(oidcEnv).canActivate(
        context('data', { '__Host-mb_session': token }).ctx,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the current user, read fresh from the database', async () => {
    const { token } = await sessions.create({
      userId: ada.id,
      sub: 's',
      emergency: false,
    });
    const { ctx, req } = context('data', { '__Host-mb_session': token });
    await expect(guard(oidcEnv).canActivate(ctx)).resolves.toBe(true);
    expect(req['user']).toEqual(ada);
    expect(users.findById).toHaveBeenCalledWith(ada.id);
  });

  describe('bearer routes (0010)', () => {
    it('accepts a valid API token and attaches its owner', async () => {
      const { ctx, req } = context('mcp', {}, { authorization: 'Bearer mb_good' });
      await expect(guard(oidcEnv).canActivate(ctx)).resolves.toBe(true);
      expect(req['user']).toEqual(ada);
    });

    it('refuses a missing, unknown or revoked token', async () => {
      const cases: Record<string, string>[] = [
        {},
        { authorization: 'Bearer mb_bad' },
        { authorization: 'Basic x' },
      ];
      for (const headers of cases) {
        await expect(
          guard(oidcEnv).canActivate(context('mcp', {}, headers).ctx),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }
    });

    it('does not accept a session there, and a token does not open other routes', async () => {
      const { token } = await sessions.create({ userId: ada.id, sub: 's', emergency: false });
      await expect(
        guard(oidcEnv).canActivate(context('mcp', { '__Host-mb_session': token }).ctx),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        guard(oidcEnv).canActivate(
          context('data', {}, { authorization: 'Bearer mb_good' }).ctx,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
