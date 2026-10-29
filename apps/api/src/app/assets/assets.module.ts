import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { FilesController } from './files.controller';
import { PipelineQueue } from './pipeline.queue';

@Module({
  controllers: [AssetsController, FilesController],
  providers: [AssetsService, PipelineQueue],
})
export class AssetsModule {}
