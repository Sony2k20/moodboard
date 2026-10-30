import { z } from 'zod';

/**
 * Personal API tokens for MCP clients (0010). A token carries its owner's identity: assets added
 * through it name them as author, and its writes go to the audit log as theirs.
 */

/** `mb_` marks a leaked token as ours in a secret scanner. */
export const API_TOKEN_PREFIX = 'mb_';

export const CreateApiTokenSchema = z
  .object({ name: z.string().trim().min(1).max(100) })
  .strict();

export interface ApiTokenItem {
  readonly id: string;
  readonly name: string;
  /** The first characters, to recognise a token without it. */
  readonly prefix: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

/** The answer to creating a token — the only time the token itself is shown. */
export interface CreatedApiToken {
  readonly item: ApiTokenItem;
  readonly token: string;
}
