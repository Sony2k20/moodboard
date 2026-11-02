import { PGlite } from '@electric-sql/pglite';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { analysisRuns, assets, auditLog, Database, schema, users } from '@moodboard/db';
import { MAX_FAILED_RUNS, PipelineKind, PROMPT_VERSION } from '@moodboard/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { join } from 'node:path';
import { AnalysisService, LlmSettings } from './analysis.service';
import { PipelineQueue } from './pipeline.queue';

/** Batch re-analysis (0015) against a real Postgres, with a queue that only records. */

const MIGRATIONS = join(__dirname, '../../../../../libs/db/migrations');

let client: PGlite;
let db: Database;
let admin: { id: string; role: 'admin' };
let member: { id: string; role: 'member' };
const queued: Array<{ id: string; pipeline: PipelineKind }> = [];
const queue = {
  reanalyse: async (id: string, pipeline: PipelineKind) => {
    queued.push({ id, pipeline });
    return true;
  },
  pendingJobs: async () => 4,
} as unknown as PipelineQueue;
const llm: LlmSettings = { enabled: true, monthlyLimitUsd: 25 };
let service: AnalysisService;
const ids: Record<'current' | 'outdated' | 'unclassified' | 'stuck' | 'trashed' | 'pending', string> =
  {} as never;

async function asset(type = 'image', extra: Partial<typeof assets.$inferInsert> = {}) {
  const [row] = await db
    .insert(assets)
    .values({ type, title: 'asset', createdBy: admin.id, status: 'ready', ...extra })
    .returning({ id: assets.id });
  return row.id;
}

async function run(assetId: string, promptVersion: number, status: 'succeeded' | 'failed', costUsd = 0.04) {
  await db.insert(analysisRuns).values({
    assetId,
    provider: 'anthropic',
    model: promptVersion === PROMPT_VERSION ? 'claude-opus-5' : 'claude-opus-4-7',
    promptVersion,
    status,
    costUsd: status === 'succeeded' ? costUsd : null,
    error: status === 'failed' ? 'rate limited' : null,
  });
}

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Database;
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  const [a, m] = await db
    .insert(users)
    .values([
      { sub: 'ada', email: 'ada@example.com', displayName: 'Ada', role: 'admin' },
      { sub: 'bob', email: 'bob@example.com', displayName: 'Bob' },
    ])
    .returning({ id: users.id });
  admin = { id: a.id, role: 'admin' };
  member = { id: m.id, role: 'member' };
  service = new AnalysisService(db, llm, queue);

  ids.current = await asset();
  await run(ids.current, PROMPT_VERSION - 1, 'succeeded');
  await run(ids.current, PROMPT_VERSION, 'succeeded', 0.06);

  ids.outdated = await asset('website');
  await run(ids.outdated, PROMPT_VERSION - 1, 'succeeded');
  await run(ids.outdated, PROMPT_VERSION, 'failed');

  ids.unclassified = await asset();

  ids.stuck = await asset();
  for (let i = 0; i < MAX_FAILED_RUNS; i++) {
    await run(ids.stuck, PROMPT_VERSION, 'failed');
  }

  ids.trashed = await asset('image', { deletedAt: new Date() });
  await run(ids.trashed, PROMPT_VERSION - 1, 'succeeded');
  ids.pending = await asset('image', { status: 'pending' });
}, 60_000);

afterAll(() => client.close());

beforeEach(() => {
  queued.length = 0;
});

describe('AnalysisService', () => {
  it('splits the live, ready corpus into the four states', async () => {
    const summary = await service.summary(admin);
    expect(summary.states).toEqual({ current: 1, outdated: 1, unclassified: 1, stuck: 1 });
    expect(summary.promptVersion).toBe(PROMPT_VERSION);
    expect(summary.queued).toBe(4);
  });

  it('groups by the run the metadata came from, not by every run', async () => {
    const { versions } = await service.summary(admin);
    expect(versions).toEqual([
      { promptVersion: PROMPT_VERSION, model: 'claude-opus-5', assets: 1 },
      { promptVersion: PROMPT_VERSION - 1, model: 'claude-opus-4-7', assets: 1 },
    ]);
  });

  it('reports the month’s spend, the average run and the latest failures of live assets', async () => {
    const { cost, recentFailures } = await service.summary(admin);
    expect(cost.monthUsd).toBeCloseTo(0.04 * 3 + 0.06);
    expect(cost.averageRunUsd).toBeCloseTo((0.04 * 3 + 0.06) / 4);
    expect(cost.monthlyLimitUsd).toBe(25);
    expect(recentFailures).toHaveLength(MAX_FAILED_RUNS + 1);
    expect(new Set(recentFailures.map((f) => f.assetId))).toEqual(new Set([ids.outdated, ids.stuck]));
  });

  it('queues a scope with its asset’s pipeline, and audits each', async () => {
    expect(await service.request({ scope: 'outdated' }, admin)).toEqual({ queued: 1 });
    expect(queued).toEqual([{ id: ids.outdated, pipeline: 'website' }]);
    expect(await service.request({ scope: 'stuck' }, admin)).toEqual({ queued: 1 });
    expect(queued[1].id).toBe(ids.stuck);
    const entries = await db
      .select({ entityId: auditLog.entityId, diff: auditLog.diff })
      .from(auditLog)
      .where(eq(auditLog.action, 'analysis.requested'));
    expect(entries).toContainEqual({ entityId: ids.stuck, diff: { scope: 'stuck' } });
  });

  it('lets a member re-run a selection, current assets included, but skips what is not live', async () => {
    const result = await service.request(
      { ids: [ids.current, ids.trashed, ids.pending] },
      member,
    );
    expect(result).toEqual({ queued: 1 });
    expect(queued).toEqual([{ id: ids.current, pipeline: 'image' }]);
  });

  it('keeps the summary and the scopes for admins', async () => {
    await expect(service.summary(member)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.request({ scope: 'stuck' }, member)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses requests while classification is off', async () => {
    const off = new AnalysisService(db, { enabled: false, monthlyLimitUsd: 25 }, queue);
    await expect(off.request({ ids: [ids.current] }, admin)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect((await off.summary(admin)).enabled).toBe(false);
  });
});
