import { sql } from 'drizzle-orm';

/**
 * Who is writing, for the origin guards (migration 0006). A `human` row may only be deleted in a
 * transaction that declared `human` (a person editing, through the api) or `purge` (the trash
 * purge). The classify step declares nothing, so a re-analysis can never delete one (§5.6).
 */
export type Actor = 'human' | 'purge';

/** Anything that can run SQL: the database or a transaction of it. */
interface Executor {
  execute(query: ReturnType<typeof sql>): PromiseLike<unknown>;
}

/** Declares the actor for the rest of the current transaction only (`set_config(…, true)`). */
export async function declareActor(tx: Executor, actor: Actor): Promise<void> {
  await tx.execute(sql`select set_config('moodboard.actor', ${actor}, true)`);
}
