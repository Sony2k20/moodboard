import { databaseConfigFromEnv } from './config';

const KEYS = [
  'DATABASE_URL',
  'uri',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'host',
  'port',
  'dbname',
  'username',
  'password',
];

describe('databaseConfigFromEnv', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    for (const key of KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('prefers DATABASE_URL', () => {
    process.env['DATABASE_URL'] = 'postgresql://a:b@localhost:5432/c';
    process.env['uri'] = 'postgresql://x:y@elsewhere:5432/z';

    expect(databaseConfigFromEnv().url).toBe('postgresql://a:b@localhost:5432/c');
  });

  it("takes CloudNativePG's pre-built uri verbatim", () => {
    // The generated password is 64 arbitrary characters; the operator has already escaped it, so
    // re-assembling the URL ourselves could only make it worse.
    process.env['uri'] =
      'postgresql://moodboard:p%2Fa%3Ass@moodboard-database-rw:5432/moodboard';

    expect(databaseConfigFromEnv().url).toBe(
      'postgresql://moodboard:p%2Fa%3Ass@moodboard-database-rw:5432/moodboard',
    );
  });

  it("assembles a URL from CloudNativePG's individual keys", () => {
    process.env['host'] = 'moodboard-database-rw';
    process.env['port'] = '5432';
    process.env['dbname'] = 'moodboard';
    process.env['username'] = 'moodboard';
    process.env['password'] = 'secret';

    expect(databaseConfigFromEnv().url).toBe(
      'postgresql://moodboard:secret@moodboard-database-rw:5432/moodboard',
    );
  });

  it('escapes a password with URL-significant characters', () => {
    process.env['host'] = 'localhost';
    process.env['dbname'] = 'moodboard';
    process.env['username'] = 'moodboard';
    process.env['password'] = 'p/a:ss@word';

    expect(databaseConfigFromEnv().url).toBe(
      'postgresql://moodboard:p%2Fa%3Ass%40word@localhost:5432/moodboard',
    );
  });

  it('prefers the generic POSTGRES_* names over the CNPG keys', () => {
    process.env['POSTGRES_HOST'] = 'tunnel';
    process.env['POSTGRES_DB'] = 'moodboard';
    process.env['POSTGRES_USER'] = 'moodboard';
    process.env['POSTGRES_PASSWORD'] = 'secret';
    process.env['host'] = 'moodboard-database-rw';

    expect(databaseConfigFromEnv().url).toContain('@tunnel:5432/');
  });

  it('names what is missing instead of connecting to nothing', () => {
    expect(() => databaseConfigFromEnv()).toThrow(/POSTGRES_HOST or host/);
  });
});
