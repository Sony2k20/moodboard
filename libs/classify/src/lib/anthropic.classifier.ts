import Anthropic from '@anthropic-ai/sdk';
import {
  AssetClassifier,
  ClassifyInput,
  ClassifyOutput,
} from './classifier.port';
import { OUTPUT_JSON_SCHEMA, parseAnalysisResult } from './output-schema';
import { PROMPT_VERSION, SYSTEM_PROMPT } from './prompt';

/** USD per million tokens, input / output. The model that served the request is what is billed. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-4-8': { input: 5, output: 25 },
};

/** A refusal that survived the fallback chain. Retrying the same image would refuse again. */
export class ClassificationRefusedError extends Error {
  constructor(
    readonly category: string | null,
    readonly rawResponse: unknown,
  ) {
    super(
      `The model declined to classify this asset${category ? ` (${category})` : ''}`,
    );
  }
}

/** The model answered, but not with something the contract accepts. */
export class InvalidClassificationError extends Error {
  constructor(
    message: string,
    readonly rawResponse: unknown,
  ) {
    super(message);
  }
}

export interface AnthropicClassifierOptions {
  readonly apiKey: string;
  readonly model: string;
}

/**
 * The Anthropic adapter (§7.2, §7.3): native SDK, structured output, low effort, and the
 * server-side refusal fallback — third-party screenshots occasionally trip a safety classifier,
 * and without a fallback the asset would silently stay unclassified (CLAUDE.md).
 */
export class AnthropicClassifier implements AssetClassifier {
  readonly providerId = 'anthropic';
  readonly modelId: string;
  private readonly client: Anthropic;

  constructor(options: AnthropicClassifierOptions) {
    this.modelId = options.model;
    this.client = new Anthropic({ apiKey: options.apiKey });
  }

  async classify(input: ClassifyInput): Promise<ClassifyOutput> {
    const images = input.images.map((image) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: image.mime as
          | 'image/webp'
          | 'image/png'
          | 'image/jpeg'
          | 'image/gif',
        data: Buffer.from(image.data).toString('base64'),
      },
    }));
    const context = [
      input.context?.title && `Title: ${input.context.title}`,
      input.context?.sourceUrl && `Source: ${input.context.sourceUrl}`,
    ]
      .filter(Boolean)
      .join('\n');

    const response = await this.client.beta.messages.create({
      model: this.modelId,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: OUTPUT_JSON_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [
            ...images,
            {
              type: 'text',
              text: `${context ? `${context}\n\n` : ''}Classify this design reference.`,
            },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      throw new ClassificationRefusedError(
        response.stop_details?.category ?? null,
        response,
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw new InvalidClassificationError(
        'The response was cut off at max_tokens',
        response,
      );
    }
    const text = response.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') {
      throw new InvalidClassificationError(
        'The response carried no text block',
        response,
      );
    }

    let result;
    try {
      result = parseAnalysisResult(JSON.parse(text.text));
    } catch (error) {
      throw new InvalidClassificationError(
        `The response violates the contract: ${String(error)}`,
        response,
      );
    }

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const price = PRICES[response.model] ?? PRICES[this.modelId];
    return {
      result,
      promptVersion: PROMPT_VERSION,
      inputTokens,
      outputTokens,
      costUsd: price
        ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000
        : undefined,
      rawResponse: response,
    };
  }
}
