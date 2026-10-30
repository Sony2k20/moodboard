import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import {
  CAPTURE_QUEUE,
  firstPipelineStep,
  PIPELINE_QUEUE,
  PipelineJobData,
  pipelineJobId,
  PipelineKind,
  pipelineQueueOf,
  valkeyPrefix,
} from '@moodboard/shared';
import { Queue } from 'bullmq';

/**
 * The api side of the pipeline: it only ever enqueues the first step — `normalize` for an upload,
 * `capture` for a website (0011). A failed enqueue is not fatal: the asset is in the database as
 * `pending`, and the worker's reconciler picks it up (0004).
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
    const step = firstPipelineStep(pipeline);
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
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('enqueue timed out')), 5000).unref(),
    );
    try {
      await Promise.race([add, timeout]);
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
