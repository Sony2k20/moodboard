import { LOCALES } from '@moodboard/shared';
import { z } from 'zod';

/**
 * Everything authentication reads from the environment, validated once at startup.
 *
 * `AUTH_MODE` is never inferred: a missing value means `disabled`, which refuses every data
 * endpoint, so a forgotten variable fails closed (§9). With `oidc`, a missing issuer, client or
 * group is a startup error rather than a login that fails at the first visitor.
 */
const EnvSchema = z
  .object({
    AUTH_MODE: z.enum(['oidc', 'disabled']).default('disabled'),
    PUBLIC_URL: z.url().optional(),
    OIDC_ISSUER_URL: z.url().optional(),
    OIDC_CLIENT_ID: z.string().min(1).optional(),
    OIDC_CLIENT_SECRET: z.string().min(1).optional(),
    OIDC_ADMIN_GROUP: z.string().min(1).optional(),
    OIDC_MEMBER_GROUP: z.string().min(1).optional(),
    EMERGENCY_ADMIN_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    EMERGENCY_ADMIN_PASSWORD_HASH: z.string().min(1).optional(),
    EMERGENCY_ADMIN_PORT: z.coerce.number().int().positive().default(3001),
    DEFAULT_LOCALE: z.enum(LOCALES).default('en'),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'oidc') {
      for (const key of [
        'PUBLIC_URL',
        'OIDC_ISSUER_URL',
        'OIDC_CLIENT_ID',
        'OIDC_CLIENT_SECRET',
        'OIDC_ADMIN_GROUP',
        'OIDC_MEMBER_GROUP',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when AUTH_MODE=oidc`,
          });
        }
      }
    }
    if (env.EMERGENCY_ADMIN_ENABLED && !env.EMERGENCY_ADMIN_PASSWORD_HASH) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMERGENCY_ADMIN_PASSWORD_HASH'],
        message:
          'EMERGENCY_ADMIN_PASSWORD_HASH is required when EMERGENCY_ADMIN_ENABLED=true',
      });
    }
  });

export interface OidcSettings {
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly adminGroup: string;
  readonly memberGroup: string;
}

export interface AuthConfig {
  readonly mode: 'oidc' | 'disabled';
  /** Origin the browser sees, without a trailing slash. Redirect URIs are built from it. */
  readonly publicUrl: string;
  /** Session cookies are `Secure` and `__Host-` prefixed whenever the public URL is https. */
  readonly secureCookies: boolean;
  readonly oidc: OidcSettings | null;
  readonly emergencyAdmin: {
    readonly passwordHash: string;
    readonly port: number;
  } | null;
  readonly defaultLocale: (typeof LOCALES)[number];
}

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

export function authConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid authentication configuration: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    );
  }
  const e = parsed.data;
  const publicUrl = (e.PUBLIC_URL ?? 'http://localhost:4200').replace(
    /\/+$/,
    '',
  );

  return {
    mode: e.AUTH_MODE,
    publicUrl,
    secureCookies: publicUrl.startsWith('https://'),
    oidc:
      e.AUTH_MODE === 'oidc'
        ? {
            issuerUrl: e.OIDC_ISSUER_URL as string,
            clientId: e.OIDC_CLIENT_ID as string,
            clientSecret: e.OIDC_CLIENT_SECRET as string,
            adminGroup: e.OIDC_ADMIN_GROUP as string,
            memberGroup: e.OIDC_MEMBER_GROUP as string,
          }
        : null,
    emergencyAdmin:
      e.EMERGENCY_ADMIN_ENABLED && e.EMERGENCY_ADMIN_PASSWORD_HASH
        ? {
            passwordHash: e.EMERGENCY_ADMIN_PASSWORD_HASH,
            port: e.EMERGENCY_ADMIN_PORT,
          }
        : null,
    defaultLocale: e.DEFAULT_LOCALE,
  };
}
