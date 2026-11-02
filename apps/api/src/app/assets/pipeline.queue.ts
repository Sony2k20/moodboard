import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import {
  CAPTURE_QUEUE,
  firstPipelineStep,
  PIPELINE_QUEUE,
  PipelineJobData,
  pipelineJobId,
  PipelineKind,
  pipelineQueueOf,
  PipelineStep,
  valkeyPrefix,
} from '@moodboard/shared';
import { Queue } from 'bullmq';

function withTimeout<T>(work: Promise<T>): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('queue timed out')), 5000).unref(),
  );
  return Promise.race([work, timeout]);
}

/**
 * The api side of the pipeline: it enqueues the first step — `normalize` for an upload,
 * `capture` for a website (0011) — and `classify` alone for a re-analysis (0015). A failed
 * enqueue is not fatal: the asset is in the database as `pending`, and the worker's reconciler
 * picks it up (0004).
 */
@Injectable()
export class PipelineQueue implements OnApplicationShutdown {
  private readonly queues = new Map(
    [PIPELINE_QUEUE, CAPTURE_QUEUE].map((name) => [
      name,
      new Queue<PipelineJobData>(name, {
        connection: {
          host: process.env['VALKEY_HOST'] ?? 'localhost',
          port: Number(process.env['VALKEY_PORT'] ?? 6379),
          lazyConnect: true,
        },
        prefix: valkeyPrefix(process.env),
      }),
    ]),
  );

  async startPipeline(assetId: string, pipeline: PipelineKind = 'image'): Promise<boolean> {
    return this.enqueue(assetId, firstPipelineStep(pipeline), pipeline);
  }

  /**
   * A re-analysis (0015): `classify` alone, on the capture and thumbnails already stored. An
   * asset whose classify job is still queued is not queued twice — the job id is the same.
   */
  reanalyse(assetId: string, pipeline: PipelineKind): Promise<boolean> {
    return this.enqueue(assetId, 'classify', pipeline);
  }

  /** Jobs waiting or running in both queues; `null` when Valkey does not answer in time. */
  async pendingJobs(): Promise<number | null> {
    const counts = Promise.all(
      [...this.queues.values()].map((queue) =>
        queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized'),
      ),
    );
    try {
      const all = await withTimeout(counts);
      return all.flatMap((c) => Object.values(c)).reduce((sum, n) => sum + n, 0);
    } catch {
      counts.catch(() => undefined);
      return null;
    }
  }

  private async enqueue(
    assetId: string,
    step: PipelineStep,
    pipeline: PipelineKind,
  ): Promise<boolean> {
    const queue = this.queues.get(pipelineQueueOf(step));
    if (!queue) {
      return false;
    }
    const add = queue.add(
      step,
      { assetId, pipeline },
      {
        jobId: pipelineJobId(assetId, step),
        // Same as the worker's: a website that does not answer gets two more chances (0011).
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    // With Valkey down the client would keep retrying; the upload should not wait for that.
    try {
      await withTimeout(add);
      return true;
    } catch {
      add.catch(() => undefined);
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      [...this.queues.values()].map((queue) => queue.close().catch(() => undefined)),
    );
  }
}
