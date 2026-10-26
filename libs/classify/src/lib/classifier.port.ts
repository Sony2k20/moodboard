import { AnalysisResult } from '@moodboard/shared';

/**
 * The classification port (concept §7.2).
 *
 * What is abstracted here is the **result**, not the API. The Zod schema in `@moodboard/shared`
 * is the contract; each adapter uses the native SDK of its provider and is free to exploit its
 * strengths — guaranteed schema-valid JSON, batch processing, prompt caching. A generic
 * multi-provider wrapper was rejected precisely because it would cost exactly those features.
 */

/** One image handed to the model: a screenshot, a thumbnail, or a capture keyframe (§8.2). */
export interface ClassifyImage {
  readonly mime: string;
  readonly data: Uint8Array;
  /** Where in the sequence this frame sits, for keyframes. Absent for single images. */
  readonly frameIndex?: number;
}

export interface ClassifyInput {
  /**
   * One or more images. Several frames are what lets the model fill the `motion` facet — a single
   * still frame cannot describe movement in principle (§8.2).
   */
  readonly images: readonly ClassifyImage[];
  /** Textual context: source URL, title, and the extracted capture technique (§8.2, §5.3). */
  readonly context?: {
    readonly sourceUrl?: string;
    readonly title?: string;
    readonly captureTech?: Record<string, unknown>;
  };
}

export interface ClassifyOutput {
  readonly result: AnalysisResult;
  /** Recorded in `analysis_run` for reproducibility, re-analysis and cost (§5.5). */
  readonly promptVersion: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
  /** The raw provider response, stored as an audit trail. */
  readonly rawResponse: unknown;
}

export interface AssetClassifier {
  readonly providerId: string;
  readonly modelId: string;
  classify(input: ClassifyInput): Promise<ClassifyOutput>;
}

/**
 * DI token. The provider is selected through the `llm.provider` chart value (§4.3), so swapping
 * it is a values change and not a code change.
 */
export const ASSET_CLASSIFIER = 'ASSET_CLASSIFIER';
