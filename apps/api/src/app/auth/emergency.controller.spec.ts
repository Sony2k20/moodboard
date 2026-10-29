import {
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FakeValkey } from '../testing/fake-valkey';
import { authConfigFromEnv } from './auth.config';
import { EmergencyController, MAX_FAILURES } from './emergency.controller';
import { hashPassword } from './password';
import { SessionStore } from './session.store';
import { UsersService } from './users.service';

describe('EmergencyController', () => {
  const password = 'correct horse battery staple';
  let passwordHash: string;
  let valkey: FakeValkey;
  let users: { ensureEmergencyAdmin: jest.Mock; audit: jest.Mock };
  let res: { cookie: jest.Mock };

  beforeAll(async () => {
    passwordHash = await hashPassword(password);
  });

  beforeEach(() => {
    valkey = new FakeValkey();
    users = {
      ensureEmergencyAdmin: jest.fn(async () => ({
        id: 'admin-id',
        role: 'admin',
      })),
      audit: jest.fn(async () => undefined),
    };
    res = { cookie: jest.fn() };
  });

  function controller(env: Record<string, string> = {}) {
    const config = authConfigFromEnv({
      AUTH_MODE: 'oidc',
      PUBLIC_URL: 'https://moodboard.example.com',
      OIDC_ISSUER_URL: 'https://auth.example.com/application/o/moodboard/',
      OIDC_CLIENT_ID: 'c',
      OIDC_CLIENT_SECRET: 's',
      OIDC_ADMIN_GROUP: 'A',
      OIDC_MEMBER_GROUP: 'U',
      EMERGENCY_ADMIN_ENABLED: 'true',
      EMERGENCY_ADMIN_PASSWORD_HASH: passwordHash,
      ...env,
    });
    return new EmergencyController(
      config,
      valkey.asClient(),
      new SessionStore(valkey.asClient()),
      users as unknown as UsersService,
    );
  }

  const onPort = (port: number) =>
    ({ socket: { localPort: port } }) as unknown as Request;
  const login = (c: EmergencyController, body: unknown, port = 3001) =>
    c.login(
      body as Record<string, unknown>,
      onPort(port),
      res as unknown as Response,
    );

  it('does not exist on the main port, even with the right password', async () => {
    await expect(
      login(controller(), { password }, 3000),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('does not exist when disabled by configuration', async () => {
    await expect(
      login(controller({ EMERGENCY_ADMIN_ENABLED: 'false' }), { password }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('signs in with the right password on the LAN port and audits it', async () => {
    await login(controller(), { password });
    expect(res.cookie).toHaveBeenCalledWith(
      '__Host-mb_session',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, secure: true }),
    );
    expect(users.audit).toHaveBeenCalledWith(
      'auth.emergency_login',
      'admin-id',
    );
  });

  it('refuses a wrong password and audits the attempt', async () => {
    await expect(
      login(controller(), { password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.audit).toHaveBeenCalledWith(
      'auth.emergency_login_failed',
      null,
      { reason: 'password', attempt: 1 },
    );
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it(`locks after ${MAX_FAILURES} failures — even the right password then gets 429`, async () => {
    const c = controller();
    for (let i = 0; i < MAX_FAILURES; i++) {
      await expect(login(c, { password: 'wrong' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    const locked = login(c, { password });
    await expect(locked).rejects.toBeInstanceOf(HttpException);
    await expect(locked).rejects.toMatchObject({ status: 429 });
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
