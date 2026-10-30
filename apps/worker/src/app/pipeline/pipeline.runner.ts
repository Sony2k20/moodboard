import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  CAPTURE_QUEUE,
  nextPipelineStep,
  PIPELINE_QUEUE,
  PipelineJobData,
  pipelineJobId,
  PipelineKind,
  pipelineQueueOf,
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
import { CaptureError } from '../capture/website-capturer';
import { CaptureStep, FinalCaptureError } from './capture.step';
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

/**
 * One Chromium at a time (0011). Two parallel captures would double the worker's memory peak
 * (§4.6), and image jobs keep their own concurrency next to it.
 */
const CAPTURE_CONCURRENCY = 1;

export function connectionFromEnv(): ConnectionOptions {
  return {
    host: process.env['VALKEY_HOST'] ?? 'localhost',
    port: Number(process.env['VALKEY_PORT'] ?? 6379),
    // Required by BullMQ workers: a blocking connection must not give up after N retries.
    maxRetriesPerRequest: null,
  };
}

/**
 * Consumes the pipeline queues (§7.1). Each step, on success, enqueues the next one; so a failed
 * `classify` leaves thumbnails and colours in place, and the asset usable.
 */
@Injectable()
export class PipelineRunner
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PipelineRunner.name);
  private readonly queues = new Map(
    [PIPELINE_QUEUE, CAPTURE_QUEUE].map((name) => [
      name,
      new Queue<PipelineJobData>(name, {
        connection: connectionFromEnv(),
        prefix: valkeyPrefix(process.env),
      }),
    ]),
  );
  private workers: Worker<PipelineJobData>[] = [];

  constructor(
    private readonly images: ImageSteps,
    private readonly capture: CaptureStep,
    private readonly classify: ClassifyStep,
  ) {}

  onApplicationBootstrap(): void {
    this.workers = [
      // Capped so two heavy jobs do not double the memory peak (§4.6).
      this.consume(PIPELINE_QUEUE, Number(process.env['WORKER_CONCURRENCY'] ?? 2)),
      this.consume(CAPTURE_QUEUE, CAPTURE_CONCURRENCY),
    ];
  }

  private consume(name: string, concurrency: number): Worker<PipelineJobData> {
    const worker = new Worker<PipelineJobData>(name, (job) => this.process(job), {
      connection: connectionFromEnv(),
      prefix: valkeyPrefix(process.env),
      concurrency,
    });
    worker.on('failed', (job, error) => void this.onFailed(job, error));
    worker.on('error', (error) =>
      this.logger.warn(`Queue connection: ${error.message}`),
    );
    return worker;
  }

  async enqueue(
    assetId: string,
    step: PipelineStep,
    pipeline: PipelineKind = 'image',
  ): Promise<void> {
    await this.queues
      .get(pipelineQueueOf(step))
      ?.add(
        step,
        { assetId, pipeline },
        { ...JOB_OPTIONS, jobId: pipelineJobId(assetId, step) },
      );
  }

  private async process(job: Job<PipelineJobData>): Promise<void> {
    const step = job.name as PipelineStep;
    const { assetId } = job.data;
    const pipeline = job.data.pipeline ?? 'image';
    switch (step) {
      case 'normalize':
        await this.images.normalize(assetId);
        break;
      case 'capture':
        await this.capture.run(assetId);
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

    const next = nextPipelineStep(step, pipeline);
    if (next && !(next === 'classify' && !this.classify.enabled)) {
      await this.enqueue(assetId, next, pipeline);
    }
  }

  /**
   * Only the first step fails the asset: a broken upload, or a website that could not be
   * captured — with the reason, so the person sees why (0011). A failed late step leaves it
   * usable (§7.1).
   */
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
    if (final && job.name === 'capture') {
      // A retryable reason that ran out of attempts arrives as a plain CaptureError; anything
      // else (a crashed browser, a full disk) has no reason a person could act on.
      const reason =
        error instanceof FinalCaptureError || error instanceof CaptureError
          ? error.reason
          : null;
      await this.images.markFailed(job.data.assetId, reason);
    }
  }

  /**
   * Lets running jobs finish, but not forever: with Valkey unreachable a graceful close never
   * completes, and the pod would hang until the kubelet kills it. An interrupted job is not lost —
   * the reconciler finds its asset in the database.
   */
  async onApplicationShutdown(): Promise<void> {
    const graceful = (async () => {
      await Promise.all(this.workers.map((worker) => worker.close()));
      await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    })();
    const deadline = new Promise<void>((resolve) =>
      setTimeout(resolve, SHUTDOWN_GRACE_MS).unref(),
    );
    await Promise.race([graceful, deadline]);
    for (const worker of this.workers) {
      await worker.disconnect().catch(() => undefined);
    }
    for (const queue of this.queues.values()) {
      await queue.disconnect().catch(() => undefined);
    }
  }
}
