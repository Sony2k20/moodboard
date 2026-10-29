import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { valkeyPrefix } from '@moodboard/shared';
import { VALKEY, ValkeyClient } from '../valkey.module';

/**
 * Server-side sessions in Valkey (0003). The cookie carries an opaque random token; Valkey holds
 * only its SHA-256, so a dump of Valkey contains nothing that could be replayed as a cookie.
 *
 * Server-side rather than a signed cookie because Authentik's backchannel logout has to be able
 * to end a session — by `sid`, or by `sub` when the logout token carries no `sid`. Hence the two
 * index sets next to each session.
 */
export interface SessionData {
  readonly userId: string;
  /** OIDC subject; `local:emergency-admin` for the emergency admin. */
  readonly sub: string;
  /** OIDC session id from the ID token, when Authentik sends one. */
  readonly sid?: string;
  /** Kept for `id_token_hint` on logout; absent for the emergency admin. */
  readonly idToken?: string;
  readonly emergency: boolean;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface LoginFlow {
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly returnTo: string;
}

const DAY = 24 * 60 * 60;
export const SESSION_SLIDING_SECONDS = 7 * DAY;
export const SESSION_ABSOLUTE_SECONDS = 30 * DAY;
export const EMERGENCY_SESSION_SECONDS = 12 * 60 * 60;
const LOGIN_FLOW_SECONDS = 10 * 60;

// `mb` in production, `mb-dev` locally, so the two never share keys on one Valkey (0004).
const PREFIX = `${valkeyPrefix(process.env)}:auth:`;
const sessionKey = (tokenHash: string) => `${PREFIX}session:${tokenHash}`;
const sidKey = (sid: string) => `${PREFIX}sid:${sid}`;
const subKey = (sub: string) => `${PREFIX}sub:${sub}`;
const flowKey = (state: string) => `${PREFIX}flow:${state}`;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

@Injectable()
export class SessionStore {
  /** Replaceable in tests; everything time-dependent reads it. */
  now: () => number = Date.now;

  constructor(@Inject(VALKEY) private readonly valkey: ValkeyClient) {}

  /** Returns the cookie token. The token itself is never stored. */
  async create(
    data: Omit<SessionData, 'createdAt' | 'expiresAt'>,
  ): Promise<{ token: string; maxAgeSeconds: number }> {
    const token = randomBytes(32).toString('base64url');
    const key = sessionKey(hashToken(token));
    const createdAt = this.now();
    const absolute = data.emergency
      ? EMERGENCY_SESSION_SECONDS
      : SESSION_ABSOLUTE_SECONDS;
    const session: SessionData = {
      ...data,
      createdAt,
      expiresAt: createdAt + absolute * 1000,
    };
    const ttl = this.ttlFor(session);

    const tx = this.valkey.multi().set(key, JSON.stringify(session), 'EX', ttl);
    for (const indexKey of this.indexKeys(session)) {
      tx.sadd(indexKey, key).expire(indexKey, absolute);
    }
    await tx.exec();
    return { token, maxAgeSeconds: absolute };
  }

  /** Reads the session and slides its expiry, never past the absolute limit. */
  async get(token: string | undefined): Promise<SessionData | null> {
    if (!token) {
      return null;
    }
    const key = sessionKey(hashToken(token));
    const raw = await this.valkey.get(key);
    if (!raw) {
      return null;
    }
    const session = JSON.parse(raw) as SessionData;
    const ttl = this.ttlFor(session);
    if (ttl <= 0) {
      await this.valkey.del(key);
      return null;
    }
    await this.valkey.expire(key, ttl);
    return session;
  }

  async destroy(token: string | undefined): Promise<SessionData | null> {
    if (!token) {
      return null;
    }
    const key = sessionKey(hashToken(token));
    const raw = await this.valkey.get(key);
    await this.valkey.del(key);
    return raw ? (JSON.parse(raw) as SessionData) : null;
  }

  /**
   * Backchannel logout: ends every session of that OIDC session, or of that subject when the
   * logout token carries no `sid`. Returns how many were ended.
   */
  async destroyByLogout(claims: {
    sid?: string;
    sub?: string;
  }): Promise<number> {
    const indexKey = claims.sid
      ? sidKey(claims.sid)
      : claims.sub
        ? subKey(claims.sub)
        : null;
    if (!indexKey) {
      return 0;
    }
    const keys = await this.valkey.smembers(indexKey);
    if (keys.length > 0) {
      await this.valkey.del(...keys);
    }
    await this.valkey.del(indexKey);
    return keys.length;
  }

  async saveLoginFlow(state: string, flow: LoginFlow): Promise<void> {
    await this.valkey.set(
      flowKey(state),
      JSON.stringify(flow),
      'EX',
      LOGIN_FLOW_SECONDS,
    );
  }

  /** One-shot: a state can be redeemed once. */
  async takeLoginFlow(state: string): Promise<LoginFlow | null> {
    const raw = await this.valkey.getdel(flowKey(state));
    return raw ? (JSON.parse(raw) as LoginFlow) : null;
  }

  private ttlFor(session: SessionData): number {
    const remaining = Math.floor((session.expiresAt - this.now()) / 1000);
    const sliding = session.emergency
      ? EMERGENCY_SESSION_SECONDS
      : SESSION_SLIDING_SECONDS;
    return Math.min(remaining, sliding);
  }

  private indexKeys(session: SessionData): string[] {
    if (session.emergency) {
      return [];
    }
    return [subKey(session.sub), ...(session.sid ? [sidKey(session.sid)] : [])];
  }
}
