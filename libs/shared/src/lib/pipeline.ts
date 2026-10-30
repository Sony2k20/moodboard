/**
 * The contract between the api, which enqueues, and the worker, which processes (concept §7.1,
 * 0004). Both sides import it from here so a renamed step cannot leave one of them behind.
 *
 * One job per step, job name = step. Each step enqueues the next on success, so a failure in a
 * late step never undoes an early one: an asset whose classification fails keeps its thumbnails
 * and colours.
 *
 * The queue is a schedule, not a record. Valkey runs without persistence, so the database is
 * the source of truth and the worker's reconciler re-enqueues from it.
 */
export const PIPELINE_QUEUE = 'pipeline';

/**
 * `capture` runs in a queue of its own with concurrency 1 (0011): one Chromium at a time, and a
 * minute-long capture never holds up the image jobs behind it.
 */
export const CAPTURE_QUEUE = 'capture';

export const PIPELINE_STEPS = [
  'normalize',
  'capture',
  'thumbnails',
  'colors',
  'classify',
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];

/**
 * Which way an asset goes through the steps. An upload starts with `normalize`; a website has no
 * upload to check — its images come out of `capture`, made by the worker itself (0011).
 */
export type PipelineKind = 'image' | 'website';

const PIPELINES: Record<PipelineKind, readonly PipelineStep[]> = {
  image: ['normalize', 'thumbnails', 'colors', 'classify'],
  website: ['capture', 'thumbnails', 'colors', 'classify'],
};

export interface PipelineJobData {
  readonly assetId: string;
  /** Absent on jobs enqueued before 0011, which were all uploads. */
  readonly pipeline?: PipelineKind;
}

/** The pipeline an asset of this `asset.type` goes through. */
export function pipelineKindOf(type: string): PipelineKind {
  return type === 'website' ? 'website' : 'image';
}

export function firstPipelineStep(kind: PipelineKind): PipelineStep {
  return PIPELINES[kind][0];
}

export function nextPipelineStep(
  step: PipelineStep,
  kind: PipelineKind = 'image',
): PipelineStep | null {
  const steps = PIPELINES[kind];
  const index = steps.indexOf(step);
  return index === -1 ? null : (steps[index + 1] ?? null);
}

export function pipelineQueueOf(step: PipelineStep): string {
  return step === 'capture' ? CAPTURE_QUEUE : PIPELINE_QUEUE;
}

/**
 * Deterministic, so enqueueing the same step for the same asset twice — by the api and by the
 * reconciler, say — results in one job, not two. BullMQ ignores an add whose id already exists.
 */
export function pipelineJobId(assetId: string, step: PipelineStep): string {
  return `${assetId}-${step}`;
}

/**
 * What an upload may be. Checked against the decoded content, never against the file name or
 * `Content-Type` (0004). SVG is deliberately absent: rendering untrusted SVG is a script and XXE
 * surface for no gain in phase 1.
 */
export const UPLOAD_FORMATS = {
  png: { mime: 'image/png', extension: 'png' },
  jpeg: { mime: 'image/jpeg', extension: 'jpg' },
  webp: { mime: 'image/webp', extension: 'webp' },
  gif: { mime: 'image/gif', extension: 'gif' },
} as const;

export type UploadFormat = keyof typeof UPLOAD_FORMATS;

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Thumbnail widths in pixels (0004). Never upscaled: a narrower original stays its own width. */
export const THUMBNAIL_WIDTHS = {
  thumb_sm: 320,
  thumb_md: 800,
  thumb_lg: 1600,
} as const;

/**
 * The prefix for every Valkey key the application writes — queue and sessions alike. Production
 * uses `mb`, local development `mb-dev`, so a local worker never takes a production job (0004).
 * Takes the environment as a parameter: this library is also imported by the browser bundle.
 */
export function valkeyPrefix(env: Record<string, string | undefined>): string {
  return env['VALKEY_PREFIX'] || 'mb';
}
