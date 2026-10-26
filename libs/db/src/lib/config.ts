/**
 * Database connection settings, resolved from the environment.
 *
 * The shape is dictated by CloudNativePG: it creates the application secret itself when it
 * bootstraps the cluster (`cnpg.io/userType=app`), and the key names are the operator's, not
 * ours. Mounting that secret with `envFrom` therefore produces lower-case environment variables
 * — `uri`, `host`, `dbname`, `username`, `password` — and this function reads exactly those, so
 * the chart needs no key-by-key mapping and nothing has to be kept in sync with the operator.
 *
 * Precedence, most specific first:
 *
 *   1. `DATABASE_URL` — one variable, for local development through a tunnel or Compose.
 *   2. `uri` — CNPG's pre-built connection string. Preferred over assembling one, because the
 *      generated password is 64 characters of arbitrary bytes and the operator has already
 *      escaped it correctly.
 *   3. `POSTGRES_*` — the generic names, for a Postgres that is not operated by CNPG.
 *   4. `host` / `port` / `dbname` / `username` / `password` — CNPG's individual keys.
 *
 * Note `username`, not `user`: the secret carries both, identical, and `user` is a historical
 * duplicate. It is also an environment variable the shell already uses on many systems, which is
 * exactly the kind of collision that produces a confusing authentication failure.
 */
export interface DatabaseConfig {
  readonly url: string;
}

const CANDIDATES = {
  host: ['POSTGRES_HOST', 'host'],
  port: ['POSTGRES_PORT', 'port'],
  database: ['POSTGRES_DB', 'dbname'],
  user: ['POSTGRES_USER', 'username'],
  password: ['POSTGRES_PASSWORD', 'password'],
} as const;

function firstSet(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }
  return undefined;
}

function required(part: keyof typeof CANDIDATES): string {
  const value = firstSet(CANDIDATES[part]);
  if (!value) {
    throw new Error(
      `Cannot resolve the database connection: no ${CANDIDATES[part].join(' or ')} in the ` +
        'environment. Set DATABASE_URL, or mount the CloudNativePG application secret ' +
        '(uri, host, port, dbname, username, password).',
    );
  }
  return value;
}

export function databaseConfigFromEnv(): DatabaseConfig {
  const explicitUrl = firstSet(['DATABASE_URL', 'uri']);
  if (explicitUrl) {
    return { url: explicitUrl };
  }

  const host = required('host');
  const port = firstSet(CANDIDATES.port) ?? '5432';
  const database = required('database');
  const user = encodeURIComponent(required('user'));
  const password = encodeURIComponent(required('password'));

  return { url: `postgresql://${user}:${password}@${host}:${port}/${database}` };
}
