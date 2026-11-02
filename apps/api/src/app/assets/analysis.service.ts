import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { analysisRuns, assets, auditLog, Database } from '@moodboard/db';
import {
  AnalysisRequest,
  AnalysisRequestResult,
  AnalysisState,
  analysisState,
  AnalysisSummary,
  pipelineKindOf,
  PROMPT_VERSION,
} from '@moodboard/shared';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { DATABASE } from '../database.module';
import type { Editor } from './asset-edit.service';
import { PipelineQueue } from './pipeline.queue';

/** `llm.enabled` and `llm.monthlyCostLimitUsd`, as the worker reads them (0015). */
export interface LlmSettings {
  readonly enabled: boolean;
  readonly monthlyLimitUsd: number;
}

export const LLM_SETTINGS = Symbol('LLM_SETTINGS');

const RECENT_FAILURES = 10;

/**
 * Batch re-analysis (0015). Everything shown is derived from `analysis_run`; a request only puts
 * `classify` jobs in the queue. What a re-analysis may overwrite is the database guards' to
 * decide (§5.6), as for every other run — nothing here checks for human values.
 */
@Injectable()
export class AnalysisService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(LLM_SETTINGS) private readonly llm: LlmSettings,
    private readonly queue: PipelineQueue,
  ) {}

  async summary(editor: Editor): Promise<AnalysisSummary> {
    this.requireAdmin(editor);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [standing, latest, [month], [average], failures, queued] = await Promise.all([
      this.standing(),
      // Newest first, so the first row per asset is the run its metadata came from.
      this.db
        .select({
          assetId: analysisRuns.assetId,
          promptVersion: analysisRuns.promptVersion,
          model: analysisRuns.model,
        })
        .from(analysisRuns)
        .innerJoin(assets, eq(assets.id, analysisRuns.assetId))
        .where(and(this.live(), eq(analysisRuns.status, 'succeeded')))
        .orderBy(desc(analysisRuns.createdAt)),
      this.db
        .select({ usd: sql<number>`coalesce(sum(${analysisRuns.costUsd}), 0)` })
        .from(analysisRuns)
        .where(gte(analysisRuns.createdAt, monthStart)),
      this.db
        .select({ usd: sql<number | null>`avg(${analysisRuns.costUsd})` })
        .from(analysisRuns)
        .where(and(eq(analysisRuns.status, 'succeeded'), gte(analysisRuns.createdAt, since))),
      this.db
        .select({
          assetId: analysisRuns.assetId,
          title: assets.title,
          promptVersion: analysisRuns.promptVersion,
          error: analysisRuns.error,
          createdAt: analysisRuns.createdAt,
        })
        .from(analysisRuns)
        .innerJoin(assets, eq(assets.id, analysisRuns.assetId))
        .where(and(this.live(), eq(analysisRuns.status, 'failed')))
        .orderBy(desc(analysisRuns.createdAt))
        .limit(RECENT_FAILURES),
      this.queue.pendingJobs(),
    ]);

    const states: Record<AnalysisState, number> = {
      current: 0,
      outdated: 0,
      unclassified: 0,
      stuck: 0,
    };
    for (const row of standing) {
      states[row.state] += 1;
    }

    const seen = new Set<string>();
    const versions = new Map<string, { promptVersion: number; model: string; assets: number }>();
    for (const run of latest) {
      if (seen.has(run.assetId)) {
        continue;
      }
      seen.add(run.assetId);
      const key = `${run.promptVersion}|${run.model}`;
      const entry = versions.get(key) ?? { promptVersion: run.promptVersion, model: run.model, assets: 0 };
      entry.assets += 1;
      versions.set(key, entry);
    }

    return {
      promptVersion: PROMPT_VERSION,
      enabled: this.llm.enabled,
      states,
      versions: [...versions.values()].sort(
        (a, b) => b.promptVersion - a.promptVersion || b.assets - a.assets,
      ),
      cost: {
        monthUsd: Number(month.usd),
        monthlyLimitUsd: this.llm.monthlyLimitUsd,
        averageRunUsd: average.usd === null ? null : Number(average.usd),
      },
      queued,
      recentFailures: failures.map((f) => ({
        ...f,
        createdAt: f.createdAt.toISOString(),
      })),
    };
  }

  async request(request: AnalysisRequest, editor: Editor): Promise<AnalysisRequestResult> {
    if ('scope' in request) {
      this.requireAdmin(editor);
    }
    if (!this.llm.enabled) {
      throw new ConflictException('Classification is disabled (llm.enabled is false)');
    }

    const targets =
      'scope' in request
        ? (await this.standing()).filter((row) => row.state === request.scope)
        : await this.db
            .select({ id: assets.id, type: assets.type })
            .from(assets)
            .where(and(this.live(), inArray(assets.id, request.ids)));

    let queued = 0;
    const audited: string[] = [];
    for (const { id, type } of targets) {
      if (await this.queue.reanalyse(id, pipelineKindOf(type))) {
        queued += 1;
        audited.push(id);
      }
    }
    if (audited.length > 0) {
      await this.db.insert(auditLog).values(
        audited.map((id) => ({
          userId: editor.id,
          action: 'analysis.requested',
          entity: 'asset',
          entityId: id,
          diff: { scope: 'scope' in request ? request.scope : 'selection' },
        })),
      );
    }
    return { queued };
  }

  /**
   * Every live, ready asset with its state. A few hundred rows; counted here, not in SQL. The
   * subqueries name `asset.id` literally: Drizzle leaves a column in a single-table select list
   * unqualified, and `r.asset_id = "id"` would compare with the run's own id.
   */
  private async standing(): Promise<Array<{ id: string; type: string; state: AnalysisState }>> {
    const rows = await this.db
      .select({
        id: assets.id,
        type: assets.type,
        best: sql<number | null>`(select max(r.prompt_version) from ${analysisRuns} r
          where r.asset_id = asset.id and r.status = 'succeeded')`,
        failed: sql<number>`(select count(*) from ${analysisRuns} r
          where r.asset_id = asset.id and r.status = 'failed'
            and r.prompt_version = ${PROMPT_VERSION})`,
      })
      .from(assets)
      .where(this.live());
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      state: analysisState(row.best === null ? null : Number(row.best), Number(row.failed)),
    }));
  }

  /** What can be classified: not trashed, and through its first pipeline steps. */
  private live() {
    return and(eq(assets.status, 'ready'), isNull(assets.deletedAt));
  }

  private requireAdmin(editor: Editor): void {
    if (editor.role !== 'admin') {
      throw new ForbiddenException('Only admins see and steer the corpus analysis');
    }
  }
}
