#!/usr/bin/env node
/**
 * Hashes the emergency admin's password for the `passwordHash` key of its secret (0003).
 *
 * Reads the password from stdin, so it ends up neither in the shell history nor in the process
 * list:
 *
 *   node tools/hash-password.mjs | kubectl -n <namespace> create secret generic \
 *     moodboard-emergency-admin --from-file=passwordHash=/dev/stdin
 *
 * Same format as `apps/api/src/app/auth/password.ts`: `scrypt$N$r$p$<salt>$<hash>`, base64url.
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { stdin, stderr, stdout } from 'node:process';

const N = 2 ** 17;
const r = 8;
const p = 1;

async function readPassword() {
  if (stdin.isTTY) {
    stderr.write('Password (input is echoed; pipe it in to avoid that): ');
  }
  let input = '';
  for await (const chunk of stdin) {
    input += chunk;
    if (stdin.isTTY && input.includes('\n')) {
      break;
    }
  }
  return input.replace(/\r?\n$/, '');
}

const password = await readPassword();
if (password.length < 16) {
  stderr.write('Refusing a password shorter than 16 characters.\n');
  process.exit(1);
}
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64, {
  N,
  r,
  p,
  maxmem: 128 * N * r * 2,
});
stdout.write(
  [
    'scrypt',
    N,
    r,
    p,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$'),
);
