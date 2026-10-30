import { Logger, Module } from '@nestjs/common';
import {
  AnthropicClassifier,
  ASSET_CLASSIFIER,
  AssetClassifier,
} from '@moodboard/classify';
import { DEFAULT_TRASH_RETENTION_DAYS } from '@moodboard/shared';
import { DatabaseModule } from './database.module';
import { ClassifyStep, LLM_COST_LIMIT } from './pipeline/classify.step';
import { ImageSteps } from './pipeline/image.steps';
import { PipelineRunner } from './pipeline/pipeline.runner';
import { Reconciler } from './pipeline/reconciler';
import { StorageModule } from './storage.module';
import { Purger, TRASH_RETENTION_DAYS } from './trash/purger';

/**
 * `null` with the LLM switched off (`llm.enabled: false`): uploads still get thumbnails and colours
 * and stay unclassified until it is on — the same path a failed classify job takes (§7.1).
 */
function classifierFromEnv(): AssetClassifier | null {
  if (process.env['LLM_ENABLED'] !== 'true') {
    Logger.log(
      'LLM disabled: assets are processed but not classified',
      'Worker',
    );
    return null;
  }
  const provider = process.env['LLM_PROVIDER'] ?? 'anthropic';
  const apiKey = process.env['LLM_API_KEY'];
  if (provider !== 'anthropic') {
    throw new Error(
      `Unknown LLM_PROVIDER ${provider}; only anthropic has an adapter`,
    );
  }
  if (!apiKey) {
    throw new Error('LLM_ENABLED=true needs LLM_API_KEY');
  }
  return new AnthropicClassifier({
    apiKey,
    model: process.env['LLM_MODEL'] || 'claude-opus-5',
  });
}

@Module({
  imports: [DatabaseModule, StorageModule],
  providers: [
    { provide: ASSET_CLASSIFIER, useFactory: classifierFromEnv },
    {
      provide: LLM_COST_LIMIT,
      useFactory: () => Number(process.env['LLM_MONTHLY_COST_LIMIT_USD'] ?? 25),
    },
    ImageSteps,
    ClassifyStep,
    PipelineRunner,
    Reconciler,
    {
      provide: TRASH_RETENTION_DAYS,
      useFactory: () =>
        Number(
          process.env['TRASH_RETENTION_DAYS'] ?? DEFAULT_TRASH_RETENTION_DAYS,
        ),
    },
    Purger,
  ],
})
export class WorkerModule {}
