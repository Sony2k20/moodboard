import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';

/** Boards (0019). Read through the asset search, so a board shows what the overview shows. */
@Module({
  imports: [AssetsModule],
  controllers: [BoardsController],
  providers: [BoardsService],
  // `get_board` and `get_design_tokens` (0019) answer from the same service as the web.
  exports: [BoardsService],
})
export class BoardsModule {}
