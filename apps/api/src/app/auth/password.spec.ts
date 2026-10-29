import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { hashPassword, verifyPassword } from './password';

describe('password', () => {
  it('verifies the password it hashed and nothing else', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(
      verifyPassword('correct horse battery staple', hash),
    ).resolves.toBe(true);
    await expect(
      verifyPassword('correct horse battery stapl', hash),
    ).resolves.toBe(false);
  });

  it('salts: the same password never hashes the same twice', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it.each([
    '',
    'plain',
    'bcrypt$1$2$3$a$b',
    'scrypt$x$8$1$AAAA$AAAA',
    'scrypt$16$8$1$$AAAA',
  ])(
    'returns false rather than throwing for the malformed hash %p',
    async (hash) => {
      await expect(verifyPassword('anything', hash)).resolves.toBe(false);
    },
  );

  it('accepts what tools/hash-password.mjs writes, including a trailing newline from a secret', async () => {
    const tool = resolve(__dirname, '../../../../../tools/hash-password.mjs');
    const hash = execFileSync(process.execPath, [tool], {
      input: 'a long enough password\n',
    }).toString();
    await expect(
      verifyPassword('a long enough password', `${hash}\n`),
    ).resolves.toBe(true);
  });
});
