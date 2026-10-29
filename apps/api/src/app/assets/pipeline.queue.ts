import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import {
  PIPELINE_QUEUE,
  PipelineJobData,
  pipelineJobId,
  valkeyPrefix,
} from '@moodboard/shared';
import { Queue } from 'bullmq';

/**
 * The api side of the pipeline: it only ever enqueues the first step. A failed enqueue is not
 * fatal to the upload — the asset is in the database as `pending`, and the worker's reconciler
 * picks it up (0004).
 */
@Injectable()
export class PipelineQueue implements OnApplicationShutdown {
  private readonly queue = new Queue<PipelineJobData>(PIPELINE_QUEUE, {
    connection: {
      host: process.env['VALKEY_HOST'] ?? 'localhost',
      port: Number(process.env['VALKEY_PORT'] ?? 6379),
      lazyConnect: true,
    },
    prefix: valkeyPrefix(process.env),
  });

  async startPipeline(assetId: string): Promise<boolean> {
    const add = this.queue.add(
      'normalize',
      { assetId },
      {
        jobId: pipelineJobId(assetId, 'normalize'),
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
    await this.queue.close().catch(() => undefined);
  }
}
