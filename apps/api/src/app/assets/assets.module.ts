import { Module } from '@nestjs/common';
import { DEFAULT_TRASH_RETENTION_DAYS } from '@moodboard/shared';
import {
  AssetEditController,
  TRASH_RETENTION_DAYS,
  TrashController,
} from './asset-edit.controller';
import { AssetEditService } from './asset-edit.service';
import { AnalysisController } from './analysis.controller';
import { AnalysisService, LLM_SETTINGS } from './analysis.service';
import { AssetSearchService } from './asset-search.service';
import { AssetsController, VocabularyController } from './assets.controller';
import { VocabularyAdminService } from './vocabulary-admin.service';
import { AssetsService } from './assets.service';
import { FilesController } from './files.controller';
import { PipelineQueue } from './pipeline.queue';

@Module({
  controllers: [
    AssetsController,
    AssetEditController,
    VocabularyController,
    TrashController,
    FilesController,
    AnalysisController,
  ],
  providers: [
    AssetsService,
    AssetSearchService,
    AssetEditService,
    VocabularyAdminService,
    PipelineQueue,
    AnalysisService,
    {
      provide: LLM_SETTINGS,
      useFactory: () => ({
        enabled: process.env['LLM_ENABLED'] === 'true',
        monthlyLimitUsd: Number(process.env['LLM_MONTHLY_COST_LIMIT_USD'] ?? 25),
      }),
    },
    {
      provide: TRASH_RETENTION_DAYS,
      useFactory: () =>
        Number(process.env['TRASH_RETENTION_DAYS'] ?? DEFAULT_TRASH_RETENTION_DAYS),
    },
  ],
  // The MCP server (0010) calls the same services as the web, never its own queries.
  exports: [AssetsService, AssetSearchService],
})
export class AssetsModule {}
