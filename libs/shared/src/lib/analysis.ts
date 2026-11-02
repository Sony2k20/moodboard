import { z } from 'zod';
import { MAX_BULK_ASSETS } from './asset-edit';

/**
 * Bumped whenever the classification prompt or the vocabulary it renders changes. Every
 * `analysis_run` records it, which is what makes "re-classify everything below version N"
 * possible (§5.5, §7.5). Here rather than in `@moodboard/classify`, so the api can name the
 * current version without importing the provider SDK (0015).
 */
export const PROMPT_VERSION = 5;

/**
 * The reconciler stops retrying an asset after this many failed runs at the current prompt
 * version. The analysis page calls such an asset stuck (0015) — both read the same number.
 */
export const MAX_FAILED_RUNS = 3;

/** `POST /api/analysis/requests` (0015): a selection for anyone, a corpus scope for admins. */
export const AnalysisRequestSchema = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(MAX_BULK_ASSETS) }).strict(),
  z.object({ scope: z.enum(['outdated', 'stuck']) }).strict(),
]);

export type AnalysisRequest = z.infer<typeof AnalysisRequestSchema>;

export interface AnalysisRequestResult {
  /** Assets handed to the queue. Trashed and not yet ready assets are skipped. */
  readonly queued: number;
}

/** Where a live, ready asset stands against the current prompt version (0015). */
export type AnalysisState = 'current' | 'outdated' | 'unclassified' | 'stuck';

export const ANALYSIS_STATES: readonly AnalysisState[] = [
  'current',
  'outdated',
  'unclassified',
  'stuck',
];

/**
 * The state of one asset, from the highest prompt version it was classified at and its failed
 * runs at the current one. Stuck wins over outdated: the reconciler has given up on both kinds,
 * and an old result does not make that less true.
 */
export function analysisState(
  bestSucceededVersion: number | null,
  failedAtCurrent: number,
  current = PROMPT_VERSION,
): AnalysisState {
  if (bestSucceededVersion !== null && bestSucceededVersion >= current) {
    return 'current';
  }
  if (failedAtCurrent >= MAX_FAILED_RUNS) {
    return 'stuck';
  }
  return bestSucceededVersion === null ? 'unclassified' : 'outdated';
}

/** `GET /api/analysis` (0015), admins only. */
export interface AnalysisSummary {
  readonly promptVersion: number;
  /** `llm.enabled`; without it nothing is classified and requests are refused. */
  readonly enabled: boolean;
  readonly states: Readonly<Record<AnalysisState, number>>;
  /** Current and outdated assets by the version and model of their latest successful run. */
  readonly versions: ReadonlyArray<{
    readonly promptVersion: number;
    readonly model: string;
    readonly assets: number;
  }>;
  readonly cost: {
    /** Since the first of this month, UTC — the window the worker's limit counts (§7.4). */
    readonly monthUsd: number;
    readonly monthlyLimitUsd: number;
    /** Average cost of a succeeded run over the last 30 days; `null` without one. */
    readonly averageRunUsd: number | null;
  };
  /** Pipeline jobs waiting or running; `null` when the queue cannot be reached. */
  readonly queued: number | null;
  readonly recentFailures: ReadonlyArray<{
    readonly assetId: string;
    readonly title: string | null;
    readonly promptVersion: number;
    readonly error: string | null;
    readonly createdAt: string;
  }>;
}
