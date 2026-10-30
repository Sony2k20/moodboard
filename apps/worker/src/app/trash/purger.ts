import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { assets, auditLog, Database, declareActor } from '@moodboard/db';
import { STORAGE_SERVICE, StorageService } from '@moodboard/shared';
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { DATABASE } from '../database.module';

export const TRASH_RETENTION_DAYS = 'TRASH_RETENTION_DAYS';

const INTERVAL_MS = 6 * 60 * 60 * 1000;
const BATCH = 50;

/**
 * Empties the trash (0006, §9): an asset deleted longer ago than the retention period is removed
 * for good — rows first, then the stored files. A file without its row is an orphan; a row
 * without its files would be a broken asset.
 *
 * The transaction declares the actor `purge`, which is what lets the cascade delete a person's
 * facet values and tags; the guards refuse that to anyone else (migration 0006).
 */
@Injectable()
export class Purger implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(Purger.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    @Inject(TRASH_RETENTION_DAYS) private readonly retentionDays: number,
  ) {}

  onApplicationBootstrap(): void {
    const tick = () =>
      this.run().catch((error: unknown) =>
        this.logger.warn(`Purge failed: ${String(error)}`),
      );
    void tick();
    this.timer = setInterval(tick, INTERVAL_MS);
  }

  async run(): Promise<number> {
    const due = await this.db
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          isNotNull(assets.deletedAt),
          lt(
            assets.deletedAt,
            sql`now() - make_interval(days => ${this.retentionDays})`,
          ),
        ),
      )
      .limit(BATCH);

    for (const { id } of due) {
      await this.db.transaction(async (tx) => {
        await declareActor(tx, 'purge');
        await tx.delete(assets).where(eq(assets.id, id));
        await tx.insert(auditLog).values({
          userId: null,
          action: 'asset.purged',
          entity: 'asset',
          entityId: id,
          diff: { retentionDays: this.retentionDays },
        });
      });
      await this.storage.deleteAsset(id);
    }

    if (due.length > 0) {
      this.logger.log(`Purged ${due.length} assets from the trash`);
    }
    return due.length;
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
