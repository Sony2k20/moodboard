import { Module } from '@nestjs/common';
import { AssetSearchService } from './asset-search.service';
import { AssetsController, VocabularyController } from './assets.controller';
import { AssetsService } from './assets.service';
import { FilesController } from './files.controller';
import { PipelineQueue } from './pipeline.queue';

@Module({
  controllers: [AssetsController, VocabularyController, FilesController],
  providers: [AssetsService, AssetSearchService, PipelineQueue],
})
export class AssetsModule {}
