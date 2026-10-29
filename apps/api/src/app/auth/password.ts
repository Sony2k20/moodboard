import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * scrypt from `node:crypto` for the emergency admin's password. One account, one hash in a
 * secret: a native argon2 module would add a build step to the image for no practical gain.
 *
 * Format: `scrypt$N$r$p$<salt base64url>$<hash base64url>`. The parameters travel with the hash,
 * so they can be raised later without invalidating the existing secret.
 * `tools/hash-password.mjs` writes the same format.
 */
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const DEFAULTS = { N: 2 ** 17, r: 8, p: 1 };
const KEY_LENGTH = 64;

function maxmem(N: number, r: number): number {
  return 128 * N * r * 2;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p } = DEFAULTS;
  const hash = await scryptAsync(password, salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem: maxmem(N, r),
  });
  return [
    'scrypt',
    N,
    r,
    p,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

/** `false` for a wrong password and for a malformed hash alike — never throws on bad input. */
export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parts = encoded.trim().split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) {
    return false;
  }
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }
  const actual = await scryptAsync(password, salt, expected.length, {
    N,
    r,
    p,
    maxmem: maxmem(N, r),
  });
  return timingSafeEqual(actual, expected);
}
