import { Module } from '@nestjs/common';
import { DEFAULT_TRASH_RETENTION_DAYS } from '@moodboard/shared';
import {
  AssetEditController,
  TRASH_RETENTION_DAYS,
  TrashController,
} from './asset-edit.controller';
import { AssetEditService } from './asset-edit.service';
import { AssetSearchService } from './asset-search.service';
import { AssetsController, VocabularyController } from './assets.controller';
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
  ],
  providers: [
    AssetsService,
    AssetSearchService,
    AssetEditService,
    PipelineQueue,
    {
      provide: TRASH_RETENTION_DAYS,
      useFactory: () =>
        Number(process.env['TRASH_RETENTION_DAYS'] ?? DEFAULT_TRASH_RETENTION_DAYS),
    },
  ],
})
export class AssetsModule {}
