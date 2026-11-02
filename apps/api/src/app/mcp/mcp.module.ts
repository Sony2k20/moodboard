import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { BoardsModule } from '../boards/boards.module';
import { McpController } from './mcp.controller';
import { McpServerFactory } from './mcp.server';

@Module({
  imports: [AssetsModule, BoardsModule],
  controllers: [McpController],
  providers: [McpServerFactory],
})
export class McpModule {}
