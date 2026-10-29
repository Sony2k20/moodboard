import { Inject, Injectable } from '@nestjs/common';
import { auditLog, Database, users } from '@moodboard/db';
import { Locale, UserRole } from '@moodboard/shared';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../database.module';
import { IdentityClaims } from './identity';

export interface CurrentUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly locale: Locale;
}

/** `sub` of the emergency admin's `user` row. No Authentik subject can take this shape. */
export const EMERGENCY_ADMIN_SUB = 'local:emergency-admin';

/** Audit actions are technical keys, translated at display time only (§13.3). */
export type AuthAuditAction =
  | 'auth.login'
  | 'auth.login_denied'
  | 'auth.logout'
  | 'auth.backchannel_logout'
  | 'auth.emergency_login'
  | 'auth.emergency_login_failed'
  | 'user.locale_changed';

const columns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  role: users.role,
  locale: users.locale,
};

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Creates the `user` row on first login, refreshes e-mail, name and role on every later one —
   * Authentik owns those (§9). The locale is set once and then belongs to the user (§13.2).
   */
  async upsertFromLogin(
    identity: IdentityClaims,
    role: UserRole,
    locale: Locale,
  ): Promise<CurrentUser> {
    const [user] = await this.db
      .insert(users)
      .values({
        sub: identity.sub,
        email: identity.email,
        displayName: identity.displayName,
        role,
        locale,
      })
      .onConflictDoUpdate({
        target: users.sub,
        set: { email: identity.email, displayName: identity.displayName, role },
      })
      .returning(columns);
    return user;
  }

  /** The emergency admin is an ordinary row, so `created_by` and the audit log can point at it. */
  async ensureEmergencyAdmin(locale: Locale): Promise<CurrentUser> {
    const [user] = await this.db
      .insert(users)
      .values({
        sub: EMERGENCY_ADMIN_SUB,
        email: 'emergency-admin@localhost.invalid',
        displayName: 'Emergency admin',
        role: 'admin',
        locale,
      })
      .onConflictDoUpdate({ target: users.sub, set: { role: 'admin' } })
      .returning(columns);
    return user;
  }

  async findById(id: string): Promise<CurrentUser | null> {
    const [user] = await this.db
      .select(columns)
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return user ?? null;
  }

  async setLocale(id: string, locale: Locale): Promise<CurrentUser | null> {
    const [user] = await this.db
      .update(users)
      .set({ locale })
      .where(eq(users.id, id))
      .returning(columns);
    return user ?? null;
  }

  async audit(
    action: AuthAuditAction,
    userId: string | null,
    diff: Record<string, unknown> | null = null,
  ): Promise<void> {
    await this.db
      .insert(auditLog)
      .values({ action, entity: 'user', entityId: userId, userId, diff });
  }
}
