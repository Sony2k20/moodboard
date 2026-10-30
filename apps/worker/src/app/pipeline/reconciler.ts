import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { PROMPT_VERSION } from '@moodboard/classify';
import { analysisRuns, assets, Database } from '@moodboard/db';
import { firstPipelineStep, pipelineKindOf } from '@moodboard/shared';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { DATABASE } from '../database.module';
import { ClassifyStep } from './classify.step';
import { PipelineRunner } from './pipeline.runner';

const INTERVAL_MS = 10 * 60 * 1000;
/** A pending asset younger than this is most likely still moving through the queue. */
const PENDING_GRACE = '10 minutes';
/** Stop retrying an asset after this many failed runs at the current prompt version. */
const MAX_FAILED_RUNS = 3;
const BATCH = 50;

/**
 * The database is the source of truth, the queue only a schedule (0004). Valkey runs without
 * persistence, so a restart loses whatever was queued; this puts it back. It also classifies
 * assets that came in while the LLM was off or the monthly limit was reached.
 *
 * Re-enqueueing is safe because job ids are deterministic: an asset whose job is still queued or
 * running is not enqueued twice.
 */
@Injectable()
export class Reconciler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(Reconciler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly runner: PipelineRunner,
    private readonly classify: ClassifyStep,
  ) {}

  onApplicationBootstrap(): void {
    const tick = () =>
      this.run().catch((error: unknown) =>
        this.logger.warn(`Reconcile failed: ${String(error)}`),
      );
    void tick();
    this.timer = setInterval(tick, INTERVAL_MS);
  }

  async run(): Promise<{ pending: number; unclassified: number }> {
    const pending = await this.db
      .select({ id: assets.id, type: assets.type })
      .from(assets)
      .where(
        and(
          eq(assets.status, 'pending'),
          isNull(assets.deletedAt),
          lt(
            assets.updatedAt,
            sql`now() - interval '${sql.raw(PENDING_GRACE)}'`,
          ),
        ),
      )
      .limit(BATCH);
    for (const { id, type } of pending) {
      const pipeline = pipelineKindOf(type);
      await this.runner.enqueue(id, firstPipelineStep(pipeline), pipeline);
    }

    let unclassified: Array<{ id: string; type: string }> = [];
    if (this.classify.enabled) {
      unclassified = await this.db
        .select({ id: assets.id, type: assets.type })
        .from(assets)
        .where(
          and(
            eq(assets.status, 'ready'),
            isNull(assets.deletedAt),
            sql`not exists (
              select 1 from ${analysisRuns} r
              where r.asset_id = ${assets.id} and r.status = 'succeeded'
                and r.prompt_version >= ${PROMPT_VERSION})`,
            sql`(select count(*) from ${analysisRuns} r
              where r.asset_id = ${assets.id} and r.status = 'failed'
                and r.prompt_version = ${PROMPT_VERSION}) < ${MAX_FAILED_RUNS}`,
          ),
        )
        .limit(BATCH);
      for (const { id, type } of unclassified) {
        await this.runner.enqueue(id, 'classify', pipelineKindOf(type));
      }
    }

    if (pending.length + unclassified.length > 0) {
      this.logger.log(
        `Re-enqueued ${pending.length} pending and ${unclassified.length} unclassified assets`,
      );
    }
    return { pending: pending.length, unclassified: unclassified.length };
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
