import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { apiTokens, auditLog, Database } from '@moodboard/db';
import { API_TOKEN_PREFIX, ApiTokenItem, CreatedApiToken } from '@moodboard/shared';
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { DATABASE } from '../database.module';
import { CurrentUser, UsersService } from './users.service';

/** `last_used_at` is written at most this often per token, not on every MCP request. */
const TOUCH_INTERVAL_MS = 60_000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Personal API tokens (0010). The token is shown once, at creation; only its SHA-256 is stored.
 * A token is 32 random bytes, so a slow password hash would buy nothing.
 */
@Injectable()
export class ApiTokensService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
  ) {}

  async create(user: CurrentUser, name: string): Promise<CreatedApiToken> {
    const token = API_TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const prefix = token.slice(0, API_TOKEN_PREFIX.length + 6);
    const [row] = await this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(apiTokens)
        .values({ userId: user.id, name, tokenHash: hash(token), prefix })
        .returning();
      await tx.insert(auditLog).values({
        userId: user.id,
        action: 'token.created',
        entity: 'api_token',
        entityId: rows[0].id,
        diff: { name, prefix },
      });
      return rows;
    });
    return { item: toItem(row), token };
  }

  /** A person's active tokens, newest first. */
  async list(user: CurrentUser): Promise<ApiTokenItem[]> {
    const rows = await this.db
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.userId, user.id), isNull(apiTokens.revokedAt)))
      .orderBy(desc(apiTokens.createdAt));
    return rows.map(toItem);
  }

  /** Revocation takes effect with the next request: `authenticate` checks `revoked_at`. */
  async revoke(user: CurrentUser, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const revoked = await tx
        .update(apiTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(apiTokens.id, id), eq(apiTokens.userId, user.id), isNull(apiTokens.revokedAt)),
        )
        .returning({ id: apiTokens.id });
      if (revoked.length === 0) {
        throw new NotFoundException();
      }
      await tx.insert(auditLog).values({
        userId: user.id,
        action: 'token.revoked',
        entity: 'api_token',
        entityId: id,
        diff: {},
      });
    });
  }

  /** The owner of an active token, or `null`. The user is read fresh, so a role change applies. */
  async authenticate(token: string): Promise<CurrentUser | null> {
    if (!token.startsWith(API_TOKEN_PREFIX)) {
      return null;
    }
    const [row] = await this.db
      .select({ id: apiTokens.id, userId: apiTokens.userId })
      .from(apiTokens)
      .where(and(eq(apiTokens.tokenHash, hash(token)), isNull(apiTokens.revokedAt)));
    if (!row) {
      return null;
    }
    const user = await this.users.findById(row.userId);
    if (!user) {
      return null;
    }
    const now = new Date();
    await this.db
      .update(apiTokens)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(apiTokens.id, row.id),
          or(
            isNull(apiTokens.lastUsedAt),
            lt(apiTokens.lastUsedAt, new Date(now.getTime() - TOUCH_INTERVAL_MS)),
          ),
        ),
      );
    return user;
  }
}

function toItem(row: typeof apiTokens.$inferSelect): ApiTokenItem {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}
