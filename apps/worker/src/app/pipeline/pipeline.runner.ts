import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  nextPipelineStep,
  PIPELINE_QUEUE,
  PipelineJobData,
  pipelineJobId,
  PipelineStep,
  valkeyPrefix,
} from '@moodboard/shared';
import {
  ConnectionOptions,
  Job,
  Queue,
  UnrecoverableError,
  Worker,
} from 'bullmq';
import { ClassifyStep } from './classify.step';
import { ImageSteps } from './image.steps';

/** Below the pod's default 30 s termination grace period. */
const SHUTDOWN_GRACE_MS = 20_000;

/** Three attempts with backoff: covers a rate limit or a flaky network, not a broken file. */
const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  // Removed either way, so the reconciler can enqueue the same job id again later. Failures are
  // recorded where they matter: `asset.status` and `analysis_run`.
  removeOnComplete: true,
  removeOnFail: true,
};

export function connectionFromEnv(): ConnectionOptions {
  return {
    host: process.env['VALKEY_HOST'] ?? 'localhost',
    port: Number(process.env['VALKEY_PORT'] ?? 6379),
    // Required by BullMQ workers: a blocking connection must not give up after N retries.
    maxRetriesPerRequest: null,
  };
}

/**
 * Consumes the pipeline queue (§7.1). Each step, on success, enqueues the next one; so a failed
 * `classify` leaves thumbnails and colours in place, and the asset usable.
 */
@Injectable()
export class PipelineRunner
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PipelineRunner.name);
  readonly queue = new Queue<PipelineJobData>(PIPELINE_QUEUE, {
    connection: connectionFromEnv(),
    prefix: valkeyPrefix(process.env),
  });
  private worker: Worker<PipelineJobData> | null = null;

  constructor(
    private readonly images: ImageSteps,
    private readonly classify: ClassifyStep,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<PipelineJobData>(
      PIPELINE_QUEUE,
      (job) => this.process(job),
      {
        connection: connectionFromEnv(),
        prefix: valkeyPrefix(process.env),
        // Capped so two heavy jobs do not double the memory peak (§4.6).
        concurrency: Number(process.env['WORKER_CONCURRENCY'] ?? 2),
      },
    );
    this.worker.on('failed', (job, error) => void this.onFailed(job, error));
    this.worker.on('error', (error) =>
      this.logger.warn(`Queue connection: ${error.message}`),
    );
  }

  async enqueue(assetId: string, step: PipelineStep): Promise<void> {
    await this.queue.add(
      step,
      { assetId },
      { ...JOB_OPTIONS, jobId: pipelineJobId(assetId, step) },
    );
  }

  private async process(job: Job<PipelineJobData>): Promise<void> {
    const step = job.name as PipelineStep;
    const { assetId } = job.data;
    switch (step) {
      case 'normalize':
        await this.images.normalize(assetId);
        break;
      case 'thumbnails':
        await this.images.thumbnails(assetId);
        break;
      case 'colors':
        await this.images.colors(assetId);
        break;
      case 'classify':
        await this.classify.run(assetId);
        break;
      default:
        throw new UnrecoverableError(`Unknown pipeline step ${String(step)}`);
    }

    const next = nextPipelineStep(step);
    if (next && !(next === 'classify' && !this.classify.enabled)) {
      await this.enqueue(assetId, next);
    }
  }

  /** Only a broken file fails the asset. A failed late step leaves it usable (§7.1). */
  private async onFailed(
    job: Job<PipelineJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) {
      return;
    }
    const final =
      error instanceof UnrecoverableError ||
      job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.warn(
      `${job.name} for ${job.data.assetId} failed${final ? '' : ', will retry'}: ${error.message}`,
    );
    if (final && job.name === 'normalize') {
      await this.images.markFailed(job.data.assetId);
    }
  }

  /**
   * Lets running jobs finish, but not forever: with Valkey unreachable a graceful close never
   * completes, and the pod would hang until the kubelet kills it. An interrupted job is not lost —
   * the reconciler finds its asset in the database.
   */
  async onApplicationShutdown(): Promise<void> {
    const graceful = (async () => {
      await this.worker?.close();
      await this.queue.close();
    })();
    const deadline = new Promise<void>((resolve) =>
      setTimeout(resolve, SHUTDOWN_GRACE_MS).unref(),
    );
    await Promise.race([graceful, deadline]);
    await this.worker?.disconnect().catch(() => undefined);
    await this.queue.disconnect().catch(() => undefined);
  }
}
